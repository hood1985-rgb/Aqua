#!/usr/bin/env node
/* Tests Aqua's Electron main-process logic (config storage + key handling)
   by mocking the 'electron' module. No network, no GUI needed.

   Run:  node tests/main.test.js
*/

"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const Module = require("module");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aqua-main-"));

const handlers = {};
const electronMock = {
  app: {
    getPath: () => path.join(tmp, "userData"),
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {
    constructor() {
      this.webContents = { setWindowOpenHandler: () => {} };
    }
    setMenuBarVisibility() {}
    loadFile() {}
    on() {}
  },
  ipcMain: {
    handle(name, fn) { handlers[name] = fn; },
  },
  session: { defaultSession: { setPermissionRequestHandler: () => {} } },
  shell: { openExternal: () => Promise.resolve() },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronMock;
  return origLoad.apply(this, arguments);
};

const mainExports = require("../main.js");

async function main() {
  await new Promise((r) => setImmediate(r)); // let whenReady().then register handlers

  if (typeof handlers["config:get"] !== "function") throw new Error("IPC handlers not registered");

  // 1) no key yet
  const cfg0 = await handlers["config:get"]();
  if (cfg0.hasKey) throw new Error("expected no key on a fresh install");
  if (cfg0.model !== "gpt-4o-mini") throw new Error("unexpected default model: " + cfg0.model);
  console.log("[ok] fresh config has no key, default model:", cfg0.model);

  // 2) chat without a key must throw
  try {
    await handlers["chat"]({}, { messages: [] });
    throw new Error("chat should have thrown without a key");
  } catch (e) {
    console.log("[ok] chat without key correctly refused:", e.message);
  }

  // speak (OpenAI TTS) without a key must also throw
  try {
    await handlers["speak"]({}, { text: "hi", voice: "nova", speed: 1 });
    throw new Error("speak should have thrown without a key");
  } catch (e) {
    console.log("[ok] speak without key correctly refused:", e.message);
  }

  // 3) save a key, then read it back
  const saved = await handlers["config:save"]({}, { openai_api_key: "sk-test-1234567890", model: "gpt-4o" });
  if (!saved.hasKey) throw new Error("key did not save");
  if (!saved.keyHint.endsWith("7890")) throw new Error("keyHint wrong: " + saved.keyHint);
  if (saved.model !== "gpt-4o") throw new Error("model did not save");
  console.log("[ok] key saved, hint:", saved.keyHint, "| model:", saved.model);

  const onDisk = fs.readFileSync(path.join(tmp, "userData", "keys.json"), "utf8");
  if (!onDisk.includes("sk-test-1234567890")) throw new Error("keys.json missing the key");
  console.log("[ok] keys.json written to userData");

  const cfg1 = await handlers["config:get"]();
  if (!cfg1.hasKey || cfg1.model !== "gpt-4o") throw new Error("config:get after save is wrong");
  console.log("[ok] config:get reflects the saved key/model");

  // 4) clear the key
  const cleared = await handlers["config:clear"]();
  if (cleared.hasKey) throw new Error("clear failed");
  const cfg2 = await handlers["config:get"]();
  if (cfg2.hasKey) throw new Error("key still present after clear");
  console.log("[ok] key cleared");

  // 5) SSE streaming parser
  const { extractDeltaFromSSELine, buildDiarizeMultipart, parseDiarized, sanitizePhotoName } = mainExports;
  if (extractDeltaFromSSELine('data: {"choices":[{"delta":{"content":"Hi"}}]}') !== "Hi") {
    throw new Error("SSE content delta not extracted");
  }
  if (extractDeltaFromSSELine("data: [DONE]") !== null) throw new Error("[DONE] should be null");
  if (extractDeltaFromSSELine("") !== null) throw new Error("empty line should be null");
  if (extractDeltaFromSSELine("event: ping") !== null) throw new Error("non-data line should be null");
  if (extractDeltaFromSSELine('data: {"choices":[{"delta":{}}]}') !== null) throw new Error("empty delta should be null");
  console.log("[ok] SSE streaming parser");

  // 6) speaker-diarization multipart builder
  const { boundary, body } = buildDiarizeMultipart(
    Buffer.from("AUDIOBYTES"),
    "audio/webm",
    [
      { name: "Robert", ref: "QUJD", refMime: "audio/webm" },
      { name: "Sam", ref: "REVG" },               // refMime defaults to webm
      { name: "NoRef", ref: "" },                  // skipped
    ],
    "BOUNDARY"
  );
  const bodyStr = body.toString("utf8");
  if (boundary !== "BOUNDARY") throw new Error("custom boundary not respected");
  if (!bodyStr.includes('name="model"\r\n\r\ngpt-4o-transcribe-diarize')) throw new Error("missing diarize model field");
  if (!bodyStr.includes('name="response_format"\r\n\r\ndiarized_json')) throw new Error("missing response_format field");
  if (!bodyStr.includes('name="known_speaker_names[]"\r\n\r\nRobert')) throw new Error("missing Robert name field");
  if (!bodyStr.includes('name="known_speaker_names[]"\r\n\r\nSam')) throw new Error("missing Sam name field");
  if (!bodyStr.includes("data:audio/webm;base64,QUJD")) throw new Error("missing Robert reference data URL");
  if (!bodyStr.includes("data:audio/webm;base64,REVG")) throw new Error("Sam reference should default to webm data URL");
  if (bodyStr.includes("NoRef")) throw new Error("speaker without a ref should be skipped");
  if (!bodyStr.includes("AUDIOBYTES")) throw new Error("audio file part missing");
  console.log("[ok] diarization multipart builder");

  // 7) diarized_json parser
  const parsed = parseDiarized({
    segments: [
      { speaker: "Robert", text: "Hey Aqua," },
      { speaker: "Robert", text: "check the pH." },
      { speaker: "speaker_1", text: "noise" },
    ],
  });
  if (parsed.text !== "Hey Aqua, check the pH. noise") throw new Error("diarized text join wrong: " + parsed.text);
  if (parsed.speaker !== "Robert") throw new Error("majority speaker should be Robert");
  const anon = parseDiarized({ segments: [{ speaker: "speaker_0", text: "hi" }] });
  if (anon.speaker !== null) throw new Error("anonymous speaker_0 should map to null (no match)");
  if (anon.text !== "hi") throw new Error("anonymous text should still come through");
  const empty = parseDiarized({ segments: [] });
  if (empty.text !== "" || empty.speaker !== null) throw new Error("empty segments should give empty text + null speaker");
  console.log("[ok] diarized_json parser");

  // 8) photo filename sanitizer: no slashes, no escaping the photos folder
  if (sanitizePhotoName("Smith Pool BEFORE.jpg") !== "smith-pool-before.jpg") throw new Error("photo name should slugify");
  const evil = sanitizePhotoName("..\\..\\secret.txt");
  if (evil.includes("/") || evil.includes("\\") || evil === "..") throw new Error("evil name escaped: " + evil);
  if (sanitizePhotoName("..") !== "photo.jpg") throw new Error("bare .. should fall back");
  if (sanitizePhotoName("").length === 0) throw new Error("empty name needs a fallback");
  // photo + sync IPC must be registered (lazy server: nothing binds at require time)
  for (const ch of ["photo:save", "photo:get", "photo:list", "photo:delete", "sync:start", "sync:push"]) {
    if (typeof handlers[ch] !== "function") throw new Error("missing IPC channel " + ch);
  }
  // sync:push with no phone yet returns an empty op list (and would start the server in Electron)
  const push = await handlers["sync:push"]({}, { tasks: [] });
  if (!push || !Array.isArray(push.ops) || push.ops.length !== 0) throw new Error("sync:push should return empty ops");
  console.log("[ok] photo names + photo/sync IPC");

  console.log("\nALL CHECKS PASSED - main process logic is sound.");
}

main().catch((e) => {
  console.error("\n[FAIL] " + e.message);
  process.exit(1);
});
