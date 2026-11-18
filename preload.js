const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hudBridge", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  fetchTelemetry: (url) => ipcRenderer.invoke("fetch-telemetry", url),
  setHudMode: (mode) => ipcRenderer.invoke("set-hud-mode", mode),
  setTourAutoVisible: (visible) => ipcRenderer.invoke("set-tour-auto-visible", visible),
  setGamePresent: (present) => ipcRenderer.invoke("set-game-present", present),
});
