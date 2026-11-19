const seedInput = document.getElementById("seedSpeed");
const openAtLoginInput = document.getElementById("openAtLogin");
const autoStartHint = document.getElementById("autoStartHint");
const errorEl = document.getElementById("error");
const saveBtn = document.getElementById("save");
const cancelBtn = document.getElementById("cancel");

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function clampSeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(130, Math.max(40, Math.round(n)));
}

async function load() {
  const settings = (await window.hudBridge?.getSettings?.()) || {};
  seedInput.value = String(settings.seedSpeedKmh ?? 90);
  openAtLoginInput.checked = Boolean(settings.openAtLogin);
  const canAutoStart = Boolean(settings.canAutoStart);
  openAtLoginInput.disabled = !canAutoStart;
  autoStartHint.hidden = canAutoStart;
}

async function save() {
  const seed = clampSeed(seedInput.value);
  if (seed == null) {
    showError("Bitte eine Zahl zwischen 40 und 130 eingeben.");
    return;
  }

  showError("");
  saveBtn.disabled = true;
  try {
    await window.hudBridge.saveSettings({
      seedSpeedKmh: seed,
      openAtLogin: openAtLoginInput.checked,
    });
    window.close();
  } catch {
    showError("Speichern fehlgeschlagen.");
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener("click", save);
cancelBtn.addEventListener("click", () => window.close());
seedInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") save();
});

load();
