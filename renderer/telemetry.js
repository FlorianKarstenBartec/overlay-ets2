/**
 * Mappt den FPH-Telemetry-JSON-Feed (gleicher Server wie SpedV).
 */

import { isoForCity } from "./cities.js";

/** FPH liefert speed / cruiseControlSpeed bereits in km/h. */
function toKmh(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.abs(value);
}

export function mapTelemetry(raw) {
  const root = raw?.ets2 ?? raw;
  const game = root?.game ?? {};
  const truck = root?.truck ?? {};
  const job = root?.job ?? {};
  const cargo = job?.cargo ?? {};

  const connected = Boolean(game.connected || game.dataAvailable);
  const dest = (job.destinationCity || "").trim();
  const source = (job.sourceCity || "").trim();
  const freight = (cargo.name || "").trim();
  const freightMassKg =
    Number.isFinite(cargo.totalMass) && cargo.totalMass > 0 ? cargo.totalMass : null;
  const destCompany = (job.destinationCompany || "").trim();
  const hasJob = Boolean(dest || freight || cargo.loaded);
  const destCountryIso = isoForCity(job.destinationCityID, dest);
  const sourceCountryIso = isoForCity(job.sourceCityID, source);

  let restKm = null;
  const navDist = truck.navigationEstimatedDistance;
  if (Number.isFinite(navDist) && navDist > 0) {
    restKm = navDist / 1000;
  } else if (Number.isFinite(cargo.plannedDistanceKM) && cargo.plannedDistanceKM > 0) {
    restKm = cargo.plannedDistanceKM;
  }

  const plannedKm =
    Number.isFinite(cargo.plannedDistanceKM) && cargo.plannedDistanceKM > 0
      ? cargo.plannedDistanceKM
      : null;

  return {
    connected,
    paused: Boolean(game.paused),
    hasJob,
    destinationCity: dest,
    sourceCity: source,
    freight,
    freightMassKg,
    destCompany,
    destCountryIso,
    sourceCountryIso,
    restKm,
    plannedKm,
    speedKmh: toKmh(truck.speed),
    cruiseOn: Boolean(truck.cruiseControlOn),
    cruiseSpeedKmh: toKmh(truck.cruiseControlSpeed),
    odometerKm: Number.isFinite(truck.odometer) ? truck.odometer : null,
    jobKey: `${job.sourceCityID || ""}>${job.destinationCityID || ""}:${cargo.id || freight}`,
  };
}
