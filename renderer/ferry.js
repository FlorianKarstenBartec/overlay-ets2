/**
 * Rest-Anzeige = immer aktueller Navi-Rest.
 * Dauer/Ankunft: Navi minus Fähre, aber nur wenn am Tourstart Navi klar ≫ Plan.
 * Umwege / falsch abbiegen dürfen Rest nie „einfrieren“.
 */

import { clearRouteState, loadRouteState, saveRouteState } from "./routeStore.js";

const FERRY_MIN_EXTRA_KM = 40;
const NAV_STABLE_TICKS = 6;
const NAV_STABLE_SLACK_KM = 25;

export function createDriveTracker() {
  let jobKey = null;
  let plannedKm = null;
  let startOdo = null;
  let ferryKm = 0;
  let ferryLocked = false;
  let baselineNav = null;
  let pendingNav = null;
  let stableTicks = 0;

  function persist(extra = {}) {
    if (!jobKey) return;
    const prev = loadRouteState() || {};
    saveRouteState({
      ...prev,
      jobKey,
      plannedKm,
      startOdo,
      ferryKm,
      ferryLocked,
      baselineNav,
      ferryVersion: 3,
      ...extra,
      savedAt: Date.now(),
    });
  }

  function reset() {
    jobKey = null;
    plannedKm = null;
    startOdo = null;
    ferryKm = 0;
    ferryLocked = false;
    baselineNav = null;
    pendingNav = null;
    stableTicks = 0;
    clearRouteState();
  }

  function isValidFerry(navKm, planKm, ferry) {
    return (
      Number.isFinite(navKm) &&
      Number.isFinite(planKm) &&
      Number.isFinite(ferry) &&
      ferry >= FERRY_MIN_EXTRA_KM &&
      navKm > planKm + FERRY_MIN_EXTRA_KM
    );
  }

  function lockFerryFromBaseline(navKm) {
    baselineNav = navKm;
    if (isValidFerry(navKm, plannedKm, navKm - plannedKm)) {
      ferryKm = Math.round(navKm - plannedKm);
    } else {
      ferryKm = 0;
    }
    ferryLocked = true;
  }

  function update(mapped, navRestKm) {
    if (!mapped?.hasJob) {
      reset();
      return {
        navRestKm: null,
        // Anzeige-Rest (immer Navi)
        displayRestKm: null,
        // Für Dauer/Ankunft (Navi minus echte Fähre)
        etaRestKm: null,
        ferryKm: 0,
        plannedKm: null,
      };
    }

    if (mapped.jobKey !== jobKey) {
      jobKey = mapped.jobKey;
      plannedKm = Number.isFinite(mapped.plannedKm) ? mapped.plannedKm : null;
      ferryKm = 0;
      ferryLocked = false;
      baselineNav = null;
      pendingNav = null;
      stableTicks = 0;
      startOdo = null;

      const saved = loadRouteState();
      if (saved?.jobKey === jobKey && saved.ferryVersion === 3) {
        if (
          Number.isFinite(saved.startOdo) &&
          Number.isFinite(mapped.odometerKm) &&
          mapped.odometerKm >= saved.startOdo
        ) {
          startOdo = saved.startOdo;
        }
        if (Number.isFinite(saved.plannedKm) && plannedKm == null) {
          plannedKm = saved.plannedKm;
        }
        if (
          saved.ferryLocked &&
          Number.isFinite(saved.baselineNav) &&
          isValidFerry(saved.baselineNav, plannedKm ?? saved.plannedKm, saved.ferryKm)
        ) {
          baselineNav = saved.baselineNav;
          ferryKm = saved.ferryKm;
          ferryLocked = true;
        }
      }

      if (startOdo == null && Number.isFinite(mapped.odometerKm)) {
        startOdo = mapped.odometerKm;
      }
    }

    if (plannedKm == null && Number.isFinite(mapped.plannedKm)) {
      plannedKm = mapped.plannedKm;
    }
    if (startOdo == null && Number.isFinite(mapped.odometerKm)) {
      startOdo = mapped.odometerKm;
    }

    if (!ferryLocked && Number.isFinite(navRestKm) && navRestKm > 50) {
      if (pendingNav == null || Math.abs(navRestKm - pendingNav) > NAV_STABLE_SLACK_KM) {
        pendingNav = navRestKm;
        stableTicks = 0;
      } else {
        stableTicks += 1;
        pendingNav = navRestKm;
        if (stableTicks >= NAV_STABLE_TICKS) {
          lockFerryFromBaseline(pendingNav);
        }
      }
    }

    const activeFerry = ferryLocked ? ferryKm : 0;
    const etaRestKm =
      navRestKm == null ? null : Math.max(0, navRestKm - activeFerry);

    const prev = loadRouteState() || {};
    persist({
      navTotalKm: Number.isFinite(navRestKm)
        ? Math.max(prev.navTotalKm || 0, navRestKm)
        : prev.navTotalKm ?? null,
    });

    return {
      navRestKm,
      displayRestKm: navRestKm,
      etaRestKm,
      ferryKm: activeFerry,
      plannedKm,
    };
  }

  return { update, reset, persist };
}
