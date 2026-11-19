const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

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

const SETTINGS_PATH = path.join(userDataPath, "settings.json");
const DEFAULT_URL = "http://127.0.0.1:25552/api/ets2/telemetry";
const DEFAULT_SEED_KMH = 90;
const MIN_SEED_KMH = 40;
const MAX_SEED_KMH = 130;
const SIZE_ACTIVE = { width: 380, height: 290 };
const SIZE_IDLE = { width: 280, height: 118 };
const SIZE_HINT = { width: 320, height: 130 };
const GAME_PROCESS_NAMES = ["eurotrucks2.exe", "eurotrucks2", "amtrucks.exe", "amtrucks"];

let win = null;
let clockWin = null;
let settingsWin = null;
let tray = null;
let overlayVisible = true;
let tourAutoVisible = true;
let gamePresent = true;
let settings = loadSettingsOrDefaults(false);
let gameRunningCache = { at: 0, value: false };

function clampSeedKmh(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SEED_KMH;
  return Math.min(MAX_SEED_KMH, Math.max(MIN_SEED_KMH, Math.round(n)));
}

function loadSettingsOrDefaults(requireFile) {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return {
      configured: true,
      seedSpeedKmh: clampSeedKmh(raw.seedSpeedKmh),
      openAtLogin: Boolean(raw.openAtLogin),
    };
  } catch {
    if (requireFile) {
      return null;
    }
    const envSeed = process.env.ETS2_SEED_SPEED;
    return {
      configured: false,
      seedSpeedKmh: envSeed != null ? clampSeedKmh(envSeed) : DEFAULT_SEED_KMH,
      openAtLogin: false,
    };
  }
}

function settingsFileExists() {
  try {
    fs.accessSync(SETTINGS_PATH, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function saveSettings(next) {
  const payload = {
    seedSpeedKmh: clampSeedKmh(next.seedSpeedKmh),
    openAtLogin: Boolean(next.openAtLogin),
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(payload, null, 2), "utf8");
  settings = { ...payload, configured: true };
  return settings;
}

function applyOpenAtLogin(enabled) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath,
  });
}

function syncOpenAtLoginFromOs() {
  if (!app.isPackaged) {
    settings.openAtLogin = false;
    return;
  }
  const login = app.getLoginItemSettings({ path: process.execPath });
  settings.openAtLogin = Boolean(login.openAtLogin);
}

function broadcastSettings() {
  if (win && !win.isDestroyed()) {
    win.webContents.send("settings-updated", getPublicSettings());
  }
}

function getPublicSettings() {
  return {
    seedSpeedKmh: settings.seedSpeedKmh,
    openAtLogin: settings.openAtLogin,
    configured: settings.configured,
    canAutoStart: app.isPackaged,
  };
}

function getConfig() {
  return {
    telemetryUrl: process.env.ETS2_TELEMETRY_URL || DEFAULT_URL,
    pollMs: Number(process.env.ETS2_POLL_MS || 150),
    seedSpeedKmh: settings.seedSpeedKmh,
    openAtLogin: settings.openAtLogin,
    configured: settings.configured,
    canAutoStart: app.isPackaged,
  };
}

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

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 420,
    height: 380,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: "Overlay ETS2 – Einstellungen",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWin.once("ready-to-show", () => settingsWin.show());
  settingsWin.on("closed", () => {
    settingsWin = null;
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

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Overlay ein/aus (F9)", click: toggleOverlay },
      { label: "Einstellungen…", click: () => openSettingsWindow() },
      {
        label: "Mit Windows starten",
        type: "checkbox",
        checked: Boolean(settings.openAtLogin),
        enabled: app.isPackaged,
        click: (item) => {
          const enabled = Boolean(item.checked);
          applyOpenAtLogin(enabled);
          saveSettings({ ...settings, openAtLogin: enabled });
          syncOpenAtLoginFromOs();
          rebuildTrayMenu();
          broadcastSettings();
        },
      },
      { type: "separator" },
      { label: "Beenden", click: () => app.quit() },
    ])
  );
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("ETS2 Tour HUD");
  rebuildTrayMenu();
  tray.on("click", toggleOverlay);
}

/** FPH-JSON ist riesig – nur die HUD-Felder durch IPC schicken */
function slimTelemetry(raw) {
  const root = raw?.ets2 ?? raw ?? {};
  const game = root.game ?? {};
  const truck = root.truck ?? {};
  const job = root.job ?? {};
  const cargo = job.cargo ?? {};
  return {
    ets2: {
      game: {
        connected: game.connected,
        dataAvailable: game.dataAvailable,
        paused: game.paused,
      },
      truck: {
        speed: truck.speed,
        cruiseControlOn: truck.cruiseControlOn,
        cruiseControlSpeed: truck.cruiseControlSpeed,
        odometer: truck.odometer,
        navigationEstimatedDistance: truck.navigationEstimatedDistance,
        engineOn: truck.engineOn,
        electricOn: truck.electricOn,
      },
      job: {
        sourceCity: job.sourceCity,
        sourceCityID: job.sourceCityID,
        destinationCity: job.destinationCity,
        destinationCityID: job.destinationCityID,
        destinationCompany: job.destinationCompany,
        cargo: {
          id: cargo.id,
          name: cargo.name,
          loaded: cargo.loaded,
          totalMass: cargo.totalMass,
          plannedDistanceKM: cargo.plannedDistanceKM,
        },
      },
    },
  };
}

async function fetchTelemetryJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Telemetry HTTP ${res.status}`);
  }
  return slimTelemetry(await res.json());
}

function isGameRunning() {
  const now = Date.now();
  if (now - gameRunningCache.at < 2000) {
    return Promise.resolve(gameRunningCache.value);
  }

  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/FO", "CSV", "/NH"],
      { windowsHide: true, timeout: 3000 },
      (err, stdout) => {
        let running = false;
        if (!err && typeof stdout === "string") {
          const lower = stdout.toLowerCase();
          running = GAME_PROCESS_NAMES.some((name) => lower.includes(name));
        }
        gameRunningCache = { at: Date.now(), value: running };
        resolve(running);
      }
    );
  });
}

app.whenReady().then(() => {
  if (!gotLock) return;

  settings = loadSettingsOrDefaults(false);
  syncOpenAtLoginFromOs();
  if (settings.configured) {
    applyOpenAtLogin(settings.openAtLogin);
  }

  createTourWindow();
  createClockWindow();
  createTray();
  globalShortcut.register("F9", toggleOverlay);

  if (!settingsFileExists()) {
    openSettingsWindow();
  }
});

app.on("second-instance", () => {
  applyTourVisibility();
  applyClockVisibility();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});

ipcMain.handle("get-config", () => getConfig());
ipcMain.handle("get-settings", () => getPublicSettings());

ipcMain.handle("save-settings", (_event, partial = {}) => {
  const next = {
    seedSpeedKmh:
      partial.seedSpeedKmh != null ? partial.seedSpeedKmh : settings.seedSpeedKmh,
    openAtLogin:
      partial.openAtLogin != null ? Boolean(partial.openAtLogin) : settings.openAtLogin,
  };

  if (partial.openAtLogin != null) {
    applyOpenAtLogin(next.openAtLogin);
  }

  const saved = saveSettings(next);
  syncOpenAtLoginFromOs();
  rebuildTrayMenu();
  broadcastSettings();
  return getPublicSettings();
});

ipcMain.handle("is-game-running", async () => isGameRunning());

ipcMain.handle("fetch-telemetry", async (_event, url) => {
  return fetchTelemetryJson(url || DEFAULT_URL);
});

ipcMain.handle("set-hud-mode", (_event, mode) => {
  if (!win || win.isDestroyed()) return;
  const size =
    mode === "idle" ? SIZE_IDLE : mode === "hint" ? SIZE_HINT : SIZE_ACTIVE;
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
