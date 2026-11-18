/**
 * ETA über Realzeit-Durchsatz:
 *   Restdauer = Fahr-Rest-km / (Spiel-km pro Realzeit-Stunde)
 *
 * Basis fest: ~1000 Spiel-km ≈ 60 Real-Minuten.
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

export function createEtaEngine(_seedSpeedKmh = 95) {
  let tripKm = 0;
  let tripSec = 0;
  let lastOdometer = null;
  let lastTickMs = null;
  let smoothedRemainSec = null;
  let jobKey = null;

  function reset(nextJobKey) {
    tripKm = 0;
    tripSec = 0;
    lastOdometer = null;
    lastTickMs = null;
    smoothedRemainSec = null;
    jobKey = nextJobKey;
  }

  function update(sample, nowMs = Date.now()) {
    const key = sample.jobKey || "";
    if (key !== jobKey) {
      reset(key);
    }

    if (!sample.hasJob || sample.restKm == null || !Number.isFinite(sample.restKm)) {
      smoothedRemainSec = null;
      return {
        hasJob: false,
        restKm: null,
        remainSec: null,
        etaMs: null,
        kmPerRealHour: CAL_KM_PER_REAL_HOUR,
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

    // Immer Kalibrier-Basis — kein Sofort-Umschalten auf 60/95 km/h
    let kmPerRealHour = CAL_KM_PER_REAL_HOUR;

    const measured =
      tripSec >= MIN_TRIP_SEC && tripKm >= MIN_TRIP_KM
        ? (tripKm / tripSec) * 3600
        : null;

    if (measured != null) {
      const blend = Math.min(MAX_BLEND, 1 - Math.pow(0.5, tripKm / HALF_LIFE_KM));
      const lo = CAL_KM_PER_REAL_HOUR * 0.75;
      const hi = CAL_KM_PER_REAL_HOUR * 1.25;
      const clamped = Math.min(hi, Math.max(lo, measured));
      kmPerRealHour = CAL_KM_PER_REAL_HOUR * (1 - blend) + clamped * blend;
    }

    const targetRemainSec = (sample.restKm / kmPerRealHour) * 3600;

    if (!moving) {
      if (smoothedRemainSec == null) {
        smoothedRemainSec = targetRemainSec;
      }
    } else if (smoothedRemainSec == null) {
      smoothedRemainSec = targetRemainSec;
    } else {
      const diff = targetRemainSec - smoothedRemainSec;
      const step = Math.min(Math.abs(diff), MAX_REMAIN_STEP_SEC * Math.max(dtSec, 0.5));
      smoothedRemainSec += Math.sign(diff) * step;
    }

    const remainSec = Math.max(0, smoothedRemainSec);
    return {
      hasJob: true,
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
