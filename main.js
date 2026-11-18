const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");

// Eigener Cache-Ordner → keine Zugriffskonflikte mit parallelen Electron-Starts
const userDataPath = path.join(app.getPath("appData"), "overlay-ets2");
fs.mkdirSync(userDataPath, { recursive: true });
app.setPath("userData", userDataPath);
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disk-cache-size", "1");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let win = null;
let clockWin = null;
let tray = null;
let overlayVisible = true;
let tourAutoVisible = true;
let gamePresent = true;

const DEFAULT_URL = "http://127.0.0.1:25552/api/ets2/telemetry";
const SIZE_ACTIVE = { width: 380, height: 290 };
const SIZE_IDLE = { width: 280, height: 118 };

function createTourWindow() {
  win = new BrowserWindow({
    width: SIZE_ACTIVE.width,
    height: SIZE_ACTIVE.height,
    x: 24,
    y: 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => win.showInactive());
  win.on("closed", () => {
    win = null;
  });
}

function createClockWindow() {
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;
  const clockW = 64;
  const clockH = 26;

  clockWin = new BrowserWindow({
    width: clockW,
    height: clockH,
    x: width - clockW - 24,
    y: 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  clockWin.setAlwaysOnTop(true, "screen-saver");
  clockWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  clockWin.setIgnoreMouseEvents(true, { forward: true });
  clockWin.loadFile(path.join(__dirname, "renderer", "clock.html"));
  clockWin.once("ready-to-show", () => clockWin.showInactive());
  clockWin.on("closed", () => {
    clockWin = null;
  });
}

function applyTourVisibility() {
  if (!win || win.isDestroyed()) return;
  if (overlayVisible && tourAutoVisible && gamePresent) win.showInactive();
  else win.hide();
}

function applyClockVisibility() {
  if (!clockWin || clockWin.isDestroyed()) return;
  if (overlayVisible && gamePresent) clockWin.showInactive();
  else clockWin.hide();
}

function toggleOverlay() {
  overlayVisible = !overlayVisible;
  applyTourVisibility();
  applyClockVisibility();
}

function createTrayIcon() {
  const truckPath = path.join(__dirname, "renderer", "truck.png");
  const iconPath = path.join(__dirname, "icon.png");
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(truckPath);
  }
  if (image.isEmpty()) {
    return nativeImage.createEmpty();
  }
  // Windows-Tray: kleines Quadrat, LKW bleibt erkennbar
  return image.resize({ width: 16, height: 16, quality: "best" });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("ETS2 Tour HUD");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Overlay ein/aus (F9)", click: toggleOverlay },
      { type: "separator" },
      { label: "Beenden", click: () => app.quit() },
    ])
  );
  tray.on("click", toggleOverlay);
}

async function fetchTelemetryJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Telemetry HTTP ${res.status}`);
  }
  return res.json();
}

app.whenReady().then(() => {
  if (!gotLock) return;
  createTourWindow();
  createClockWindow();
  createTray();
  globalShortcut.register("F9", toggleOverlay);
});

app.on("second-instance", () => {
  applyTourVisibility();
  applyClockVisibility();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});

ipcMain.handle("get-config", () => ({
  telemetryUrl: process.env.ETS2_TELEMETRY_URL || DEFAULT_URL,
  pollMs: Number(process.env.ETS2_POLL_MS || 150),
  seedSpeedKmh: Number(process.env.ETS2_SEED_SPEED || 95),
}));

ipcMain.handle("fetch-telemetry", async (_event, url) => {
  return fetchTelemetryJson(url || DEFAULT_URL);
});

ipcMain.handle("set-hud-mode", (_event, mode) => {
  if (!win || win.isDestroyed()) return;
  const size = mode === "idle" ? SIZE_IDLE : SIZE_ACTIVE;
  const [x, y] = win.getPosition();
  win.setBounds({ x, y, width: size.width, height: size.height }, false);
});

ipcMain.handle("set-tour-auto-visible", (_event, visible) => {
  tourAutoVisible = Boolean(visible);
  applyTourVisibility();
});

ipcMain.handle("set-game-present", (_event, present) => {
  gamePresent = Boolean(present);
  applyTourVisibility();
  applyClockVisibility();
});
