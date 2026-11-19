import { createEtaEngine, formatDuration, formatEtaClock, formatRestKm } from "./eta.js";
import { flagImageUrl } from "./cities.js";
import { createDriveTracker } from "./ferry.js";
import { loadRouteState, saveRouteState } from "./routeStore.js";
import { mapTelemetry } from "./telemetry.js";

const els = {
  hud: document.getElementById("hud"),
  activeBlock: document.getElementById("activeBlock"),
  idleTitle: document.getElementById("idleTitle"),
  statusBlock: document.getElementById("statusBlock"),
  statusTitle: document.getElementById("statusTitle"),
  statusDetail: document.getElementById("statusDetail"),
  tour: document.getElementById("tour"),
  company: document.getElementById("company"),
  rest: document.getElementById("rest"),
  dauer: document.getElementById("dauer"),
  eta: document.getElementById("eta"),
  cruise: document.getElementById("cruise"),
  cruiseValue: document.getElementById("cruiseValue"),
  progress: document.getElementById("progress"),
  progressFill: document.getElementById("progressFill"),
  progressTruck: document.getElementById("progressTruck"),
  progressKm: document.getElementById("progressKm"),
  flagStart: document.getElementById("flagStart"),
  flagEnd: document.getElementById("flagEnd"),
  arrival: document.getElementById("arrival"),
  arrivalDest: document.getElementById("arrivalDest"),
  hint: document.getElementById("hint"),
};

let config = {
  telemetryUrl: "http://127.0.0.1:25552/api/ets2/telemetry",
  pollMs: 150,
  seedSpeedKmh: 90,
};

let etaEngine = createEtaEngine(90);
let driveTracker = createDriveTracker();
let lastCruiseKmh = null;
let progressJobKey = null;
let progressTotalKm = null;
let progressLastNavKm = null;
let progressLastOdo = null;
let progressSmoothPct = null;
let arrivalWatchJob = null;
let arrivalArmed = false;
let arrivalActiveJob = null;
let arrivalHideTimer = null;
let hudMode = "active";
let tourAutoVisible = true;
let gamePresent = true;

function setTourAutoVisible(visible) {
  if (visible === tourAutoVisible) return;
  tourAutoVisible = visible;
  window.hudBridge?.setTourAutoVisible?.(visible);
}

function setGamePresent(present) {
  if (present === gamePresent) return;
  gamePresent = present;
  window.hudBridge?.setGamePresent?.(present);
}

function setFlag(imgEl, iso) {
  const url = flagImageUrl(iso);
  if (!url) {
    imgEl.hidden = true;
    imgEl.removeAttribute("src");
    return;
  }
  if (imgEl.getAttribute("src") !== url) {
    imgEl.src = url;
  }
  imgEl.hidden = false;
}

function formatFreightLabel(freight, massKg) {
  if (!freight) return "";
  if (massKg == null || !Number.isFinite(massKg) || massKg <= 0) return freight;
  const tons = Math.round(massKg / 1000);
  return `${freight} (${tons} t)`;
}

function setTourHtml(mapped) {
  if (!mapped.hasJob) {
    els.tour.textContent = "Keine Tour";
    els.company.textContent = "";
    return;
  }

  const dest = mapped.destinationCity || "";
  const freight = formatFreightLabel(mapped.freight, mapped.freightMassKg);
  if (dest && freight) {
    els.tour.textContent = `${dest} · ${freight}`;
  } else {
    els.tour.textContent = dest || freight || "Keine Tour";
  }
  els.company.textContent = mapped.destCompany
    ? `🏭 ${mapped.destCompany}`
    : "";
}

function setHudLayout(mode) {
  const nextMode = mode === "idle" || mode === "hint" ? mode : "active";
  els.hud.classList.toggle("hud--idle", nextMode === "idle");
  els.hud.classList.toggle("hud--hint", nextMode === "hint");
  els.idleTitle.hidden = nextMode !== "idle";
  els.statusBlock.hidden = nextMode !== "hint";
  els.activeBlock.hidden = nextMode !== "active";
  els.progress.hidden = nextMode !== "active";

  if (nextMode !== hudMode) {
    hudMode = nextMode;
    window.hudBridge?.setHudMode?.(nextMode);
  }
}

function setIdleMode(idle) {
  setHudLayout(idle ? "idle" : "active");
}

function applySeedSpeed(seedSpeedKmh) {
  const next = Number(seedSpeedKmh);
  if (!Number.isFinite(next) || next === config.seedSpeedKmh) return;
  config.seedSpeedKmh = next;
  etaEngine = createEtaEngine(next);
}

function hideArrivalBanner() {
  if (arrivalHideTimer) {
    clearTimeout(arrivalHideTimer);
    arrivalHideTimer = null;
  }
  els.arrival.hidden = true;
}

function showArrival(mapped) {
  if (arrivalActiveJob === mapped.jobKey) return;

  arrivalActiveJob = mapped.jobKey;
  els.arrivalDest.textContent = mapped.destinationCity || "";
  els.arrival.hidden = false;
  els.hud.classList.add("hud--arrived");

  els.arrival.style.animation = "none";
  void els.arrival.offsetWidth;
  els.arrival.style.animation = "";

  if (arrivalHideTimer) clearTimeout(arrivalHideTimer);
  arrivalHideTimer = setTimeout(() => {
    els.arrival.hidden = true;
    arrivalHideTimer = null;
  }, 5000);
}

function updateArrival(mapped, restKm) {
  if (!mapped?.hasJob) {
    hideArrivalBanner();
    els.hud.classList.remove("hud--arrived");
    arrivalWatchJob = null;
    arrivalArmed = false;
    arrivalActiveJob = null;
    setIdleMode(false);
    return false;
  }

  // Neuer Auftrag: Animation erst erlauben, nachdem wir mal >2 km Rest gesehen haben.
  // Sonst feuern Jobannahmen kurz mit restKm≈0 (Navi noch nicht bereit).
  if (mapped.jobKey !== arrivalWatchJob) {
    arrivalWatchJob = mapped.jobKey;
    arrivalArmed = false;
    arrivalActiveJob = null;
    hideArrivalBanner();
    els.hud.classList.remove("hud--arrived");
  }

  if (restKm != null && Number.isFinite(restKm) && restKm > 2) {
    arrivalArmed = true;
  }

  const arrived =
    arrivalArmed && restKm != null && Number.isFinite(restKm) && restKm < 0.5;
  if (arrived) {
    showArrival(mapped);
    setIdleMode(true);
    return true;
  }

  els.hud.classList.remove("hud--arrived");
  setIdleMode(false);
  return false;
}

function resetProgress() {
  progressJobKey = null;
  progressTotalKm = null;
  progressLastNavKm = null;
  progressLastOdo = null;
  progressSmoothPct = null;
  renderProgress(null, null);
}

function smoothProgressPct(targetPct) {
  if (progressSmoothPct == null || !Number.isFinite(progressSmoothPct)) {
    progressSmoothPct = targetPct;
    return targetPct;
  }

  const delta = targetPct - progressSmoothPct;
  // Kleine Navi-Schritte sofort, Teleports (Fähre/Umrechnung) auslaufen lassen
  if (Math.abs(delta) < 0.35) {
    progressSmoothPct = targetPct;
    return targetPct;
  }

  const maxStep = 0.9; // ~6 %/s bei 150 ms Poll
  progressSmoothPct += Math.sign(delta) * Math.min(Math.abs(delta), maxStep);
  return progressSmoothPct;
}

/** Navi-Total für den Balken: Umweg aufblasen, Undo ohne Bewegung wieder schrumpfen. */
function syncProgressTotal(navRestKm, odometerKm) {
  if (progressTotalKm == null || progressLastNavKm == null) {
    progressTotalKm = navRestKm;
    progressLastNavKm = navRestKm;
    progressLastOdo = Number.isFinite(odometerKm) ? odometerKm : null;
    return;
  }

  const navDelta = navRestKm - progressLastNavKm;
  const odoDelta =
    Number.isFinite(odometerKm) && progressLastOdo != null
      ? Math.max(0, odometerKm - progressLastOdo)
      : 0;

  if (navDelta > 1) {
    // Längere Route (Marker) → Total wächst, Fortschritt bleibt
    progressTotalKm += navDelta;
  } else if (navDelta < -1) {
    const drop = -navDelta;
    // Plötzlicher Navi-Drop ohne Bewegung → Marker weg / kürzer geroutet
    if (odoDelta < 0.2 && drop > 5) {
      progressTotalKm = Math.max(navRestKm, progressTotalKm - drop);
    }
  }

  progressTotalKm = Math.max(progressTotalKm, navRestKm);
  progressLastNavKm = navRestKm;
  if (Number.isFinite(odometerKm)) {
    progressLastOdo = odometerKm;
  }
}

function renderProgress(mapped, navRestKm) {
  if (!mapped?.hasJob || navRestKm == null || !Number.isFinite(navRestKm)) {
    els.progress.classList.add("progress--empty");
    els.progressKm.textContent = "0 / -- km";
    els.progressFill.style.width = "0%";
    els.progressTruck.style.left = "0%";
    els.progressTruck.style.transform = "translate(0, -50%)";
    els.flagStart.hidden = true;
    els.flagEnd.hidden = true;
    return;
  }

  if (mapped.jobKey !== progressJobKey) {
    progressJobKey = mapped.jobKey;
    progressSmoothPct = null;
    progressLastNavKm = null;
    progressLastOdo = null;
    const saved = loadRouteState();
    if (
      saved?.jobKey === mapped.jobKey &&
      Number.isFinite(saved.navTotalKm) &&
      Number.isFinite(saved.lastNavKm)
    ) {
      progressTotalKm = saved.navTotalKm;
      progressLastNavKm = saved.lastNavKm;
      progressLastOdo = Number.isFinite(saved.lastOdo) ? saved.lastOdo : null;
      // Sofort korrigieren falls gespeichertes Total durch Undo-Bug aufgeblasen war
      syncProgressTotal(navRestKm, mapped.odometerKm);
    } else {
      progressTotalKm = navRestKm;
      progressLastNavKm = navRestKm;
      progressLastOdo = Number.isFinite(mapped.odometerKm) ? mapped.odometerKm : null;
    }
  } else {
    syncProgressTotal(navRestKm, mapped.odometerKm);
  }

  const total = Math.max(1, progressTotalKm);
  const done = Math.max(0, Math.min(total, total - navRestKm));
  // Rest-Zahl und Balken-Rest identisch = aktuelles Navi
  const restKm = Math.max(0, total - done);
  const targetPct = Math.max(0, Math.min(100, (done / total) * 100));
  const pct = smoothProgressPct(targetPct);

  const prev = loadRouteState() || {};
  saveRouteState({
    ...prev,
    jobKey: mapped.jobKey,
    navTotalKm: progressTotalKm,
    lastNavKm: progressLastNavKm,
    lastOdo: progressLastOdo,
    savedAt: Date.now(),
  });

  els.progress.classList.remove("progress--empty");
  els.progressKm.textContent = `${Math.round(done)} / ${Math.round(total)} km`;
  // Nahe 100%: ohne Smooth-Lag an den rechten Rand
  const showPct = targetPct >= 99.5 ? 100 : pct;
  els.progressFill.style.width = `${showPct}%`;
  // Gleiche Quelle wie Balken-Rest (total - done == Navi)
  els.rest.textContent = formatRestKm(restKm);
  positionTruck(showPct);
  setFlag(els.flagStart, mapped.sourceCountryIso);
  setFlag(els.flagEnd, mapped.destCountryIso);
}

function positionTruck(pct) {
  const track = els.progressFill.parentElement;
  const trackW = Math.max(track?.getBoundingClientRect().width || 0, 1);
  const truckW = Math.max(
    els.progressTruck.getBoundingClientRect().width || 0,
    els.progressTruck.offsetWidth || 0,
    34
  );
  const halfPct = (truckW / 2 / trackW) * 100;

  if (pct >= 100 - halfPct) {
    // Rechte Kante exakt am Balkenende
    els.progressTruck.style.left = "100%";
    els.progressTruck.style.transform = "translate(-100%, -50%)";
  } else if (pct <= halfPct) {
    els.progressTruck.style.left = "0%";
    els.progressTruck.style.transform = "translate(0, -50%)";
  } else {
    els.progressTruck.style.left = `${pct}%`;
    els.progressTruck.style.transform = "translate(-50%, -50%)";
  }
}

function setOffline() {
  els.hud.classList.add("hud--offline");
  els.hud.classList.remove("hud--ok", "hud--arrived", "hud--idle", "hud--hint");
  els.statusBlock.hidden = true;
  els.idleTitle.hidden = true;
  resetProgress();
  hideArrivalBanner();
  setTourAutoVisible(true);
  setGamePresent(false);
}

async function setTelemetryMissing() {
  const gameRunning = Boolean(await window.hudBridge?.isGameRunning?.());
  if (!gameRunning) {
    setOffline();
    return;
  }

  els.hud.classList.add("hud--ok");
  els.hud.classList.remove("hud--offline", "hud--arrived");
  els.statusTitle.textContent = "Keine Telemetry";
  els.statusDetail.textContent = "FPH/SpedV starten";
  resetProgress();
  hideArrivalBanner();
  setHudLayout("hint");
  setTourAutoVisible(true);
  setGamePresent(true);
}

function renderCruise(mapped) {
  if (mapped.cruiseSpeedKmh >= 5) {
    lastCruiseKmh = Math.round(mapped.cruiseSpeedKmh);
  }

  els.cruise.classList.remove("cruise--none", "cruise--off", "cruise--on");

  if (mapped.cruiseOn && lastCruiseKmh != null) {
    els.cruise.classList.add("cruise--on");
    els.cruiseValue.textContent = `${lastCruiseKmh} km/h`;
    return;
  }

  if (!mapped.cruiseOn && lastCruiseKmh != null) {
    els.cruise.classList.add("cruise--off");
    els.cruiseValue.textContent = `${lastCruiseKmh} km/h`;
    return;
  }

  els.cruise.classList.add("cruise--none");
  els.cruiseValue.textContent = "-";
}

async function render(mapped, eta, route = {}) {
  if (!mapped.connected) {
    await setTelemetryMissing();
    return;
  }

  setGamePresent(true);
  els.hud.classList.remove("hud--offline", "hud--hint");
  els.hud.classList.add("hud--ok");
  els.statusBlock.hidden = true;

  if (!eta.hasJob) {
    setIdleMode(true);
    renderCruise(mapped);
    resetProgress();
    driveTracker.reset();
    hideArrivalBanner();
    els.hud.classList.remove("hud--arrived");
    // Pause ohne Auftrag → Overlay links aus, Uhr bleibt
    setTourAutoVisible(!mapped.paused);
    return;
  }

  // Ziel-erreicht über Navi-Rest
  const arrived = updateArrival(mapped, route.navRestKm);
  renderCruise(mapped);

  if (arrived) {
    setTourAutoVisible(!mapped.paused);
    return;
  }

  setTourAutoVisible(true);
  setTourHtml(mapped);
  // Dauer/Ankunft = Navi (minus echte Fähre); Rest setzt renderProgress (gleicher Wert wie Balken)
  els.dauer.textContent = formatDuration(eta.remainSec);
  els.eta.textContent = formatEtaClock(eta.etaMs);
  renderProgress(mapped, route.navRestKm);
}

async function tick() {
  try {
    const raw = await window.hudBridge.fetchTelemetry(config.telemetryUrl);
    const mapped = mapTelemetry(raw);
    if (lastCruiseKmh != null && !mapped.cruiseSpeedKmh) {
      mapped.cruiseSpeedKmh = lastCruiseKmh;
    }
    const route = driveTracker.update(mapped, mapped.restKm);
    // Dauer/Ankunft am Navi; Fähre nur wenn Tracker eine echte erkannt hat
    const eta = etaEngine.update({
      ...mapped,
      restKm: route.etaRestKm ?? route.navRestKm,
    });
    await render(mapped, eta, route);
  } catch {
    await setTelemetryMissing();
  }
}

async function boot() {
  if (window.hudBridge?.getConfig) {
    config = { ...config, ...(await window.hudBridge.getConfig()) };
  }
  etaEngine = createEtaEngine(config.seedSpeedKmh || 90);
  driveTracker = createDriveTracker();
  els.hint.textContent = "F9 ein/aus";
  window.hudBridge?.onSettingsUpdated?.((next) => {
    applySeedSpeed(next.seedSpeedKmh);
  });
  await tick();
  setInterval(tick, config.pollMs);
}

boot();
