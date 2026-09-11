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

require("../main.js");

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

  console.log("\nALL CHECKS PASSED - main process logic is sound.");
}

main().catch((e) => {
  console.error("\n[FAIL] " + e.message);
  process.exit(1);
});
