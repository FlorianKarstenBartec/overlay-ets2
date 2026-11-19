/**
 * ETA über Realzeit-Durchsatz:
 *   Restdauer = Fahr-Rest-km / (Spiel-km pro Realzeit-Stunde)
 *
 * Basis fest: 1000 Spiel-km ≈ 60 Real-Minuten (Settings-km/h vorerst ignoriert).
 * Momentane Stadt-/Autobahn-Geschwindigkeit darf die ETA nicht hart umwerfen —
 * Tour-Durchschnitt wird erst nach längerer Strecke langsam eingemischt.
 *
 * Stillstand: Restdauer bleibt, ETA wandert mit.
 */

const MOVE_THRESHOLD_KMH = 5;
const HALF_LIFE_KM = 450;
const MAX_BLEND = 0.35;
const MAX_REMAIN_STEP_SEC = 2.5;
const MIN_TRIP_KM = 40;
const MIN_TRIP_SEC = 8 * 60;

// 1000 km / 60 min Realzeit
const CAL_KM_PER_REAL_HOUR = 1000;

export function createEtaEngine(_seedSpeedKmh = 90) {
  // seedSpeed vorerst ungenutzt – feste Kalibrierung 1000 km / Realstunde
  const baseKmPerRealHour = CAL_KM_PER_REAL_HOUR;
  let tripKm = 0;
  let tripSec = 0;
  let lastOdometer = null;
  let lastTickMs = null;
  let lastRestKm = null;
  let smoothedRemainSec = null;
  let jobKey = null;
  // Navi am Jobstart oft ~0 km – erst ab stabilem Rest rechnen; danach auch <2 km ok (Ankunft)
  let sawStableRest = false;

  function reset(nextJobKey) {
    tripKm = 0;
    tripSec = 0;
    lastOdometer = null;
    lastTickMs = null;
    lastRestKm = null;
    smoothedRemainSec = null;
    sawStableRest = false;
    jobKey = nextJobKey;
  }

  function update(sample, nowMs = Date.now()) {
    const key = sample.jobKey || "";
    if (key !== jobKey) {
      reset(key);
    }

    if (!sample.hasJob) {
      smoothedRemainSec = null;
      lastRestKm = null;
      sawStableRest = false;
      return {
        hasJob: false,
        restReady: false,
        restKm: null,
        remainSec: null,
        etaMs: null,
        kmPerRealHour: baseKmPerRealHour,
        stopped: true,
      };
    }

    const restOk =
      sample.restKm != null && Number.isFinite(sample.restKm) && sample.restKm >= 0;
    if (restOk && sample.restKm >= 2) {
      sawStableRest = true;
    }

    // Auftrag schon da, Navi/Rest oft erst verzögert → HUD trotzdem als Tour zeigen
    if (!restOk || (!sawStableRest && sample.restKm < 2)) {
      smoothedRemainSec = null;
      lastRestKm = null;
      return {
        hasJob: true,
        restReady: false,
        restKm: null,
        remainSec: null,
        etaMs: null,
        kmPerRealHour: baseKmPerRealHour,
        stopped: true,
      };
    }

    const speedKmh = Number.isFinite(sample.speedKmh) ? Math.max(0, sample.speedKmh) : 0;
    const moving = speedKmh >= MOVE_THRESHOLD_KMH;
    const dtSec =
      lastTickMs != null ? Math.min(5, Math.max(0, (nowMs - lastTickMs) / 1000)) : 0;

    let dkm = 0;
    if (lastOdometer != null && Number.isFinite(sample.odometerKm)) {
      const delta = sample.odometerKm - lastOdometer;
      if (delta > 0 && delta < 5) dkm = delta;
    }
    if (Number.isFinite(sample.odometerKm)) {
      lastOdometer = sample.odometerKm;
    }

    if (moving && dtSec > 0) {
      tripKm += dkm;
      tripSec += dtSec;
    }
    lastTickMs = nowMs;

    let kmPerRealHour = baseKmPerRealHour;

    const measured =
      tripSec >= MIN_TRIP_SEC && tripKm >= MIN_TRIP_KM
        ? (tripKm / tripSec) * 3600
        : null;

    if (measured != null) {
      const blend = Math.min(MAX_BLEND, 1 - Math.pow(0.5, tripKm / HALF_LIFE_KM));
      const lo = baseKmPerRealHour * 0.75;
      const hi = baseKmPerRealHour * 1.25;
      const clamped = Math.min(hi, Math.max(lo, measured));
      kmPerRealHour = baseKmPerRealHour * (1 - blend) + clamped * blend;
    }

    const targetRemainSec = (sample.restKm / kmPerRealHour) * 3600;
    // Navi springt nach Jobstart von wenigen km auf die volle Strecke
    const restJump =
      lastRestKm != null ? sample.restKm - lastRestKm : Number.POSITIVE_INFINITY;
    lastRestKm = sample.restKm;

    if (smoothedRemainSec == null || restJump > 25 || restJump < -80) {
      smoothedRemainSec = targetRemainSec;
    } else if (moving) {
      const diff = targetRemainSec - smoothedRemainSec;
      const step = Math.min(Math.abs(diff), MAX_REMAIN_STEP_SEC * Math.max(dtSec, 0.5));
      smoothedRemainSec += Math.sign(diff) * step;
    }
    // Stillstand: Restdauer halten, Ankunft wandert mit (smoothedRemainSec unverändert)

    const remainSec = Math.max(0, smoothedRemainSec);
    return {
      hasJob: true,
      restReady: true,
      restKm: sample.restKm,
      remainSec,
      etaMs: nowMs + remainSec * 1000,
      kmPerRealHour,
      stopped: !moving,
    };
  }

  return { update, reset };
}

export function formatDuration(totalSec) {
  if (totalSec == null || !Number.isFinite(totalSec)) return "--:--";
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatEtaClock(etaMs) {
  if (etaMs == null || !Number.isFinite(etaMs)) return "--:--";
  const d = new Date(etaMs);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function formatRestKm(km) {
  if (km == null || !Number.isFinite(km)) return "--";
  return String(Math.round(km));
}
