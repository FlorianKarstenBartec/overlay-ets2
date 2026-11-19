const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hudBridge", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (partial) => ipcRenderer.invoke("save-settings", partial),
  onSettingsUpdated: (handler) => {
    const listener = (_event, settings) => handler(settings);
    ipcRenderer.on("settings-updated", listener);
    return () => ipcRenderer.removeListener("settings-updated", listener);
  },
  isGameRunning: () => ipcRenderer.invoke("is-game-running"),
  fetchTelemetry: (url) => ipcRenderer.invoke("fetch-telemetry", url),
  setHudMode: (mode) => ipcRenderer.invoke("set-hud-mode", mode),
  setTourAutoVisible: (visible) => ipcRenderer.invoke("set-tour-auto-visible", visible),
  setGamePresent: (present) => ipcRenderer.invoke("set-game-present", present),
});
