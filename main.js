/* ============================================================
   Aqua desktop app — Electron main process.

   - Creates her app window.
   - Stores your OpenAI API key locally (in the app's private
     user-data folder) — it never leaves your PC except to call
     OpenAI directly.
   - Talks to OpenAI: chat completions (her brain) and Whisper
     (her ears). No Python, no external server.
   ============================================================ */

"use strict";

const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");

const DEFAULT_MODEL = "gpt-4o-mini";

/* Auto-updater (optional — lazily loaded so unit tests still run without it). */
let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (e) {
  autoUpdater = null;
}

let mainWindow = null;

function setupAutoUpdater() {
  if (!autoUpdater) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("update-available", (info) => {
      if (mainWindow) mainWindow.webContents.send("update:available", info && info.version);
    });
    autoUpdater.on("update-downloaded", () => {
      if (mainWindow) mainWindow.webContents.send("update:downloaded");
    });
    autoUpdater.checkForUpdates().catch(() => {});
  } catch (e) { /* updates are best-effort */ }
}

/* ---------------- configuration (OpenAI key + model) ---------------- */

function keysPath() {
  return path.join(app.getPath("userData"), "keys.json");
}

function loadConfig() {
  const cfg = { openai_api_key: null, model: DEFAULT_MODEL };
  // environment variable works as a fallback (like the original Aqua)
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) cfg.openai_api_key = envKey;
  try {
    const data = JSON.parse(fs.readFileSync(keysPath(), "utf8"));
    if (data.openai_api_key) cfg.openai_api_key = data.openai_api_key;
    if (data.model) cfg.model = data.model;
  } catch (e) {
    /* no keys file yet — that's fine */
  }
  return cfg;
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(keysPath()), { recursive: true });
  fs.writeFileSync(keysPath(), JSON.stringify(cfg, null, 2), "utf8");
  return cfg;
}

function maskKey(key) {
  if (!key) return "";
  const s = String(key);
  return s.length <= 6 ? "…" : "…" + s.slice(-4);
}

/* ---------------- tiny HTTPS JSON client ---------------- */

function httpsRequest(url, { method = "GET", headers = {}, body = null, timeout = 120000, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload =
      body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          ...headers,
          ...(payload ? { "Content-Length": payload.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            if (binary) return resolve(buf);
            const text = buf.toString("utf8");
            try {
              return resolve(JSON.parse(text));
            } catch (e) {
              return resolve(text);
            }
          }
          const text = buf.toString("utf8");
          let msg = `HTTP ${res.statusCode}: ${text.slice(0, 200)}`;
          try {
            const j = JSON.parse(text);
            if (j && j.error && j.error.message) msg = j.error.message;
          } catch (e) { /* not JSON */ }
          reject(new Error(msg));
        });
      }
    );
    req.setTimeout(timeout, () => req.destroy(new Error("OpenAI request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---------------- OpenAI calls ---------------- */

async function chatWithOpenAI(messages, key, model) {
  const res = await httpsRequest("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: { model: model || DEFAULT_MODEL, messages, temperature: 0.8 },
  });
  const content = res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
  return String(content || "").trim();
}

/* Extract one content delta from a Server-Sent Events line.
   Pure function — exported for unit testing. */
function extractDeltaFromSSELine(line) {
  const s = String(line || "").trim();
  if (!s.startsWith("data:")) return null;
  const data = s.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const j = JSON.parse(data);
    const d = j.choices && j.choices[0] && j.choices[0].delta;
    return d && typeof d.content === "string" && d.content ? d.content : null;
  } catch (e) {
    return null;
  }
}

function streamChat(messages, key, model, onDelta) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(
      JSON.stringify({ model, messages, temperature: 0.8, stream: true })
    );
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Content-Length": payload.length,
        },
      },
      (res) => {
        let buf = "";
        let full = "";
        res.on("data", (chunk) => {
          buf += chunk.toString("utf8");
          let i;
          while ((i = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            const delta = extractDeltaFromSSELine(line);
            if (delta) {
              full += delta;
              try { onDelta(delta); } catch (e) { /* renderer gone */ }
            }
          }
        });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ reply: full.trim() });
          } else {
            reject(new Error("HTTP " + res.statusCode));
          }
        });
      }
    );
    req.setTimeout(120000, () => req.destroy(new Error("OpenAI request timed out")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function multipart(fields, file) {
  const boundary = "----aqua" + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
    )
  );
  parts.push(file.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
}

async function transcribeWithWhisper(audio, mimeType, key) {
  const ext = String(mimeType || "").includes("webm") ? "webm" : "wav";
  const { boundary, body } = multipart(
    { model: "whisper-1", language: "en" },
    { field: "file", filename: `aqua.${ext}`, contentType: mimeType || "audio/webm", data: audio }
  );
  const res = await httpsRequest("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    timeout: 90000,
  });
  return String(res.text || "").trim();
}

/* ---------------- OpenAI speaker diarization ("who's talking?") ---------------- */

const DIARIZE_MODEL = "gpt-4o-transcribe-diarize";

/* Build a multipart body for the diarization endpoint.
   Pure function — exported for unit testing. */
function buildDiarizeMultipart(audio, mimeType, speakers, boundary) {
  const ext = String(mimeType || "").includes("webm") ? "webm" : "wav";
  boundary = boundary || "----aqua" + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const chunks = [];
  const field = (name, value) =>
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  field("model", DIARIZE_MODEL);
  field("response_format", "diarized_json");
  for (const s of (speakers || []).slice(0, 4)) {
    if (!s || !s.name || !s.ref) continue;
    field("known_speaker_names[]", s.name);
    field("known_speaker_references[]", `data:${s.refMime || "audio/webm"};base64,${s.ref}`);
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="aqua.${ext}"\r\nContent-Type: ${mimeType || "audio/webm"}\r\n\r\n`
    )
  );
  chunks.push(Buffer.isBuffer(audio) ? audio : Buffer.from(audio));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

/* Turn a diarized_json response into { text, speaker }.
   Pure function — exported for unit testing. */
function parseDiarized(res) {
  const segments = (res && res.segments) || [];
  const text = segments
    .map((s) => (s && s.text ? String(s.text).trim() : ""))
    .filter(Boolean)
    .join(" ");
  // Pick the label attached to the most speech — that's the person talking.
  const counts = {};
  let best = null;
  let bestN = 0;
  for (const seg of segments) {
    const who = seg && seg.speaker ? String(seg.speaker).trim() : "";
    if (!who) continue;
    counts[who] = (counts[who] || 0) + 1;
    if (counts[who] > bestN) { bestN = counts[who]; best = who; }
  }
  let speaker = best || null;
  // Anonymous labels like "speaker_1" mean "somebody I don't know" — no match.
  if (speaker && /^(speaker|spk)[_\s-]?\d*$/i.test(speaker)) speaker = null;
  return { text, speaker };
}

async function transcribeWithDiarize(audio, mimeType, speakers, key) {
  const { boundary, body } = buildDiarizeMultipart(audio, mimeType, speakers);
  const res = await httpsRequest("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
    timeout: 90000,
  });
  return parseDiarized(res);
}

async function synthesizeSpeech(text, voice, speed, key, model) {
  /* OpenAI's neural text-to-speech — far more human than the system voices. */
  return httpsRequest("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: {
      model: model || "tts-1",
      voice: voice || "nova",
      input: text,
      response_format: "mp3",
      speed: Number(speed) || 1,
    },
    timeout: 60000,
    binary: true,
  });
}

/* ---------------- IPC handlers (renderer <-> main) ---------------- */

function registerIpc() {
  ipcMain.handle("config:get", () => {
    const cfg = loadConfig();
    return { hasKey: !!cfg.openai_api_key, model: cfg.model, keyHint: maskKey(cfg.openai_api_key) };
  });

  ipcMain.handle("config:save", (event, { openai_api_key, model }) => {
    const cfg = loadConfig();
    if (typeof openai_api_key === "string" && openai_api_key.trim()) {
      cfg.openai_api_key = openai_api_key.trim();
    }
    if (typeof model === "string" && model.trim()) cfg.model = model.trim();
    writeConfig(cfg);
    return { hasKey: !!cfg.openai_api_key, model: cfg.model, keyHint: maskKey(cfg.openai_api_key) };
  });

  ipcMain.handle("config:clear", () => {
    const cfg = loadConfig();
    cfg.openai_api_key = null;
    writeConfig(cfg);
    return { hasKey: false, model: cfg.model };
  });

  ipcMain.handle("chat", async (event, { messages, model, stream }) => {
    const cfg = loadConfig();
    if (!cfg.openai_api_key) throw new Error("no-key");
    const m = model || cfg.model;
    if (stream) {
      const { reply } = await streamChat(messages, cfg.openai_api_key, m, (delta) =>
        event.sender.send("chat:chunk", delta)
      );
      return { reply };
    }
    const reply = await chatWithOpenAI(messages, cfg.openai_api_key, m);
    return { reply };
  });

  ipcMain.handle("transcribe", async (event, { audio, mimeType }) => {
    const cfg = loadConfig();
    if (!cfg.openai_api_key) throw new Error("no-key");
    const buf = Buffer.from(audio);   // audio is an ArrayBuffer from the renderer
    const text = await transcribeWithWhisper(buf, mimeType, cfg.openai_api_key);
    return { text };
  });

  ipcMain.handle("transcribe:who", async (event, { audio, mimeType, speakers }) => {
    const cfg = loadConfig();
    if (!cfg.openai_api_key) throw new Error("no-key");
    const buf = Buffer.from(audio);
    const { text, speaker } = await transcribeWithDiarize(buf, mimeType, speakers, cfg.openai_api_key);
    return { text, speaker };
  });

  ipcMain.handle("speak", async (event, { text, voice, speed, model }) => {
    const cfg = loadConfig();
    if (!cfg.openai_api_key) throw new Error("no-key");
    const buf = await synthesizeSpeech(text, voice, speed, cfg.openai_api_key, model);
    return { audio: buf.toString("base64"), mime: "audio/mpeg" };
  });

  ipcMain.handle("update:install", () => {
    if (autoUpdater) autoUpdater.quitAndInstall();
    return true;
  });

  ipcMain.handle("open-external", (event, url) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) shell.openExternal(url);
    return true;
  });
}

/* ---------------- window ---------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: "#04101d",
    icon: path.join(__dirname, "icons", "icon-512.png"),
    autoHideMenuBar: true,
    title: "Aqua — your cyber-buddy",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // open external links (e.g. "get an API key") in the real browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* ---------------- lifecycle ---------------- */

app.whenReady().then(() => {
  // Let the renderer use the microphone (and nothing else).
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media");
  });

  registerIpc();
  createWindow();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* Export the SSE parser for unit tests (harmless when run by Electron). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractDeltaFromSSELine, buildDiarizeMultipart, parseDiarized };
}
