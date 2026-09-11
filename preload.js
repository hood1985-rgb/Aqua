/* ============================================================
   Aqua — preload bridge.
   Safely exposes a tiny, explicit API to the renderer. The
   renderer never sees Node, and your API key never reaches it.
   ============================================================ */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aqua", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  clearConfig: () => ipcRenderer.invoke("config:clear"),
  chat: (payload) => ipcRenderer.invoke("chat", payload),
  transcribe: (audio, mimeType) => ipcRenderer.invoke("transcribe", { audio, mimeType }),
  speak: (payload) => ipcRenderer.invoke("speak", payload),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
