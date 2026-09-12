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
  identifySpeaker: (audio, mimeType, speakers) =>
    ipcRenderer.invoke("transcribe:who", { audio, mimeType, speakers }),
  speak: (payload) => ipcRenderer.invoke("speak", payload),
  onChatChunk: (cb) => {
    const handler = (_event, delta) => cb(delta);
    ipcRenderer.on("chat:chunk", handler);
    return () => ipcRenderer.removeListener("chat:chunk", handler);
  },
  onUpdateAvailable: (cb) => {
    const handler = (_event, version) => cb(version);
    ipcRenderer.on("update:available", handler);
    return () => ipcRenderer.removeListener("update:available", handler);
  },
  onUpdateDownloaded: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("update:downloaded", handler);
    return () => ipcRenderer.removeListener("update:downloaded", handler);
  },
  installUpdate: () => ipcRenderer.invoke("update:install"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
});
