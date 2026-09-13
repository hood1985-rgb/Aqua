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
const os = require("os");

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
    if (data.sync_pin) cfg.sync_pin = String(data.sync_pin);
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

/* ---------------- pool photos (before/after log) ---------------- */

/* Data URLs bigger than this get rejected (~150 KB files after base64). */
const PHOTO_LIMIT = 200 * 1024;

function photosDir() {
  return path.join(app.getPath("userData"), "photos");
}

/* Keep filenames boring: lowercase alnum, dash, underscore, dot. No
   slashes ever, so callers can't escape the photos folder.
   Pure function — exported for unit testing. */
function sanitizePhotoName(name) {
  const clean = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!clean || clean === "." || clean === "..") return "photo.jpg";
  return clean.slice(0, 80);
}

function savePhotoFile(customer, label, dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw new Error("bad-photo");
  if (m[2].length > PHOTO_LIMIT) throw new Error("photo-too-big");
  const dir = photosDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = sanitizePhotoName(
    (customer || "pool") + "-" + (label || "photo") + "-" + stamp + "-" +
    Math.floor(Math.random() * 1e6) + ".jpg"
  );
  fs.writeFileSync(path.join(dir, file), Buffer.from(m[2], "base64"));
  return file;
}

function listPhotoFiles() {
  try {
    return fs.readdirSync(photosDir()).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  } catch (e) {
    return [];
  }
}

/* ---------------- phone sync (same-WiFi truck companion) ---------------- */

const SYNC_PORT = 8138;
let syncServer = null;
let syncSnapshot = { tasks: [], route: [], routeDone: [], customers: [] };
let syncInbox = [];
let syncPin = null;

/* The PIN lives in keys.json next to the API key — generated once, then
   reused every launch so the phone stays paired. */
function getSyncPin() {
  if (syncPin) return syncPin;
  try {
    const data = JSON.parse(fs.readFileSync(keysPath(), "utf8"));
    if (data.sync_pin) {
      syncPin = String(data.sync_pin);
      return syncPin;
    }
  } catch (e) { /* no keys file yet */ }
  const { makePin } = require("./phone-sync.js");
  syncPin = makePin();
  try {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(keysPath(), "utf8")); } catch (e2) { /* fresh file */ }
    cfg.sync_pin = syncPin;
    writeConfig(cfg);
  } catch (e) { /* PIN still works for this run */ }
  return syncPin;
}

/* http://<this-pc>:8138 links for every LAN adapter, for the Truck view. */
function lanUrls(port) {
  const nets = os.networkInterfaces ? os.networkInterfaces() : {};
  const urls = [];
  for (const list of Object.values(nets)) {
    for (const nic of list || []) {
      if (nic.family === "IPv4" && !nic.internal) urls.push("http://" + nic.address + ":" + port);
    }
  }
  return urls;
}

/* Lazy on purpose: binding a port at require-time would break unit tests,
   so the server only starts the first time the renderer asks for sync. */
function ensureSyncServer() {
  if (syncServer) return syncServer;
  const { createSyncServer } = require("./phone-sync.js");
  let page = "";
  try {
    page = fs.readFileSync(path.join(__dirname, "phone.html"), "utf8");
  } catch (e) {
    page = "<html><body>Aqua phone sync is running.</body></html>";
  }
  syncServer = createSyncServer({
    page,
    pin: getSyncPin(),
    getSnapshot: () => syncSnapshot,
    onOp: (op) => {
      syncInbox.push(op);
      return { queued: true };
    },
  });
  // A taken port shouldn't crash the app (or a test run): sync just won't start.
  syncServer.on("error", () => {});
  syncServer.listen(SYNC_PORT, "0.0.0.0");
  // Don't pin the process open: Electron stays alive anyway, and unit
  // tests that poke sync:push should still be able to exit cleanly.
  if (typeof syncServer.unref === "function") syncServer.unref();
  return syncServer;
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
  /* Prefer OpenAI's newer, more accurate transcription model, with a
     vocabulary hint so pool-shop lingo comes through right. Falls back to
     whisper-1 (the original) if the newer model isn't available on the key. */
  const ext = String(mimeType || "").includes("webm") ? "webm" : "wav";
  const prompt =
    "Hood's Pool Service, pool, chlorine, pH, alkalinity, calcium hardness, " +
    "cyanuric acid, stabilizer, shock, backwash, filter, skimmer, cartridge, " +
    "salt cell, pump, gallons, Dallas, Texas, y'all, fixin' to";

  const once = async (model) => {
    const { boundary, body } = multipart(
      { model, language: "en", prompt },
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
  };

  try {
    return await once("gpt-4o-mini-transcribe");
  } catch (e) {
    return await once("whisper-1");
  }
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

  ipcMain.handle("photo:save", (event, { customer, label, dataUrl }) => {
    return { file: savePhotoFile(customer, label, dataUrl) };
  });

  ipcMain.handle("photo:get", (event, file) => {
    const safe = sanitizePhotoName(file);
    if (!/\.(jpe?g|png|webp)$/i.test(safe)) throw new Error("bad-photo");
    const buf = fs.readFileSync(path.join(photosDir(), safe));
    const lower = safe.toLowerCase();
    const ext = lower.endsWith(".png") ? "png" : lower.endsWith(".webp") ? "webp" : "jpeg";
    return { dataUrl: "data:image/" + ext + ";base64," + buf.toString("base64") };
  });

  ipcMain.handle("photo:list", () => ({ files: listPhotoFiles() }));

  ipcMain.handle("photo:delete", (event, file) => {
    const safe = sanitizePhotoName(file);
    if (!/\.(jpe?g|png|webp)$/i.test(safe)) throw new Error("bad-photo");
    try {
      fs.unlinkSync(path.join(photosDir(), safe));
    } catch (e) { /* already gone */ }
    return true;
  });

  ipcMain.handle("sync:start", () => {
    ensureSyncServer();
    return { port: SYNC_PORT, urls: lanUrls(SYNC_PORT), pin: getSyncPin() };
  });

  ipcMain.handle("sync:push", (event, snapshot) => {
    ensureSyncServer();
    if (snapshot && typeof snapshot === "object") syncSnapshot = snapshot;
    const ops = syncInbox;
    syncInbox = [];
    return { ops };
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

/* Export the pure helpers for unit tests (harmless when run by Electron). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractDeltaFromSSELine, buildDiarizeMultipart, parseDiarized, sanitizePhotoName };
}
