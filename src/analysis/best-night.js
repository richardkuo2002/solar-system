// Best Observation Night Finder — v1.11 Event Toolkit. Scans a date range
// night-by-night (not the fixed-intervalHours-across-the-whole-range
// pattern every other event type uses) and scores each night 0-100 from
// three ingredients: how high the target gets during true astronomical
// darkness, how close it is to Earth right now (a circular-orbit distance
// proxy — see scoreNight below), and whether the Moon is up and bright
// enough to interfere. This is a heuristic ranking tool, not a photometric
// prediction — no real magnitude/albedo/sky-brightness model exists in
// this codebase (nor is one added here); see docs/accuracy.md.
//
// Reuses analysis/observer.js#observeAt for every altitude/horizon/
// distance lookup (Sun, target, and Moon alike — observeAt already
// handles all of OBSERVER_TARGETS, Moon included) and analysis/phase.js's
// exported pure primitives (phaseAngleRad, illuminatedFraction) for the
// Moon's brightness, building its position the same ad-hoc
// moonHeliocentricPositionAu + `{ positionAu }` way analysis/eclipse.js's
// moonElongationAtJd already does (phase.js's own targetStateFor isn't
// exported). No new root-finding: the "coarse sampler" here is a plain
// per-night max-altitude scan, not a zero-crossing search.

import { getBodyState, sunBodyState } from '../core/ephemeris.js';
import { julianDateFromDate, moonHeliocentricPositionAu } from '../core/orbital-elements.js';
import { observeAt } from './observer.js';
import { phaseAngleRad, illuminatedFraction } from './phase.js';
import { PLANETS } from '../data/planets.js';
import { MOONS } from '../data/moons.js';

export const BEST_NIGHT_TARGETS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

// Standard astronomical-twilight threshold: the Sun's geometric altitude
// must be at or below this for the sky to be considered truly dark. Not
// configurable — no twilight/darkness concept existed anywhere in this
// codebase before this file.
const NIGHT_SUN_ALT_DEG = -18;
// Below this apparent altitude, "technically above the horizon" doesn't
// mean "worth pointing a telescope at" (murk, obstructions, poor seeing).
const MIN_OBSERVABLE_ALTITUDE_DEG = 15;
// Minutes between samples within one night's noon-to-noon scan window.
// 20min -> 72 samples/night; calibrated in scripts/smoke-test.js's timing
// check against MAX_NIGHTS_TO_SCAN below (v1.8.5 precedent: measure, then
// pick a cap from the measurement, don't guess).
const SAMPLE_INTERVAL_MIN = 20;
const SAMPLE_INTERVAL_DAYS = SAMPLE_INTERVAL_MIN / 1440;
// A range longer than this throws immediately instead of freezing the
// main thread — this event type has no `intervalHours` field for
// lab-panel.js's existing generic MAX_SAMPLES guard to key off, so the
// cap has to live here. Measured ~0.4ms/night on this machine (2000
// nights of Saturn from a real location: 795ms, see
// scripts/smoke-test.js's timing assertion) — 3660 nights (~10 years) is
// a generous range for "find the best night," worst case ~1.5s on a
// single Analyze click, nowhere near v1.8.5's multi-second freeze
// territory.
export const MAX_NIGHTS_TO_SCAN = 3660;

const MIN_REPORT_SCORE = 30;
const MAX_CANDIDATES = 10;

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function validateLatLon(latDeg, lonDeg) {
  if (!(latDeg >= -90 && latDeg <= 90)) throw new Error('latDeg must be in [-90, 90]');
  if (!(lonDeg >= -180 && lonDeg <= 180)) throw new Error('lonDeg must be in [-180, 180]');
}

function validateTarget(target) {
  if (!BEST_NIGHT_TARGETS.includes(target)) {
    throw new Error(`target must be one of ${BEST_NIGHT_TARGETS.join(', ')}`);
  }
}

/**
 * 0-100 score for one already-evaluated candidate moment. Pure — every
 * input is a plain number/boolean, no ephemeris call — so it's directly
 * unit-testable. Weights: altitude dominates (55), then the
 * distance/brightness proxy (25), then Moon-darkness (20). A set Moon
 * gives full darkness credit regardless of phase (it can't wash out
 * anything while below the horizon); a risen Moon's credit shrinks with
 * its illuminated fraction.
 */
export function scoreNight({ peakAltitudeDeg, moonAboveHorizon, moonIlluminatedFraction, distanceAu, minDistanceAu, maxDistanceAu }) {
  const altitudeScore = clamp01(peakAltitudeDeg / 90) * 55;
  const closeness = maxDistanceAu > minDistanceAu
    ? clamp01(1 - (distanceAu - minDistanceAu) / (maxDistanceAu - minDistanceAu))
    : 0;
  const closenessScore = closeness * 25;
  const darkness = moonAboveHorizon ? (1 - clamp01(moonIlluminatedFraction)) : 1;
  const darknessScore = darkness * 20;
  return altitudeScore + closenessScore + darknessScore;
}

function classify(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

/** Earth-target distance bounds (AU) from semi-major axes — a
 *  circular-orbit approximation, not each planet's real eccentric-orbit
 *  min/max (see docs/accuracy.md). Static per target, computed once. */
function distanceBoundsAu(target) {
  const aTarget = PLANETS[target].elements.a[0];
  const aEarth = PLANETS.earth.elements.a[0];
  return { minDistanceAu: Math.abs(aTarget - aEarth), maxDistanceAu: aTarget + aEarth };
}

/** Moon illuminated fraction at `jsDate`, reusing phase.js's pure
 *  primitives on an ad-hoc `{ positionAu }` object — the same idiom
 *  eclipse.js's moonElongationAtJd already uses, since phase.js's own
 *  Moon-state helper isn't exported. */
function moonIlluminatedFractionAt(jsDate, earthPositionAu, sunState) {
  const jd = julianDateFromDate(jsDate);
  const moonPositionAu = moonHeliocentricPositionAu(MOONS.moon, earthPositionAu, jd);
  return illuminatedFraction(phaseAngleRad({ positionAu: moonPositionAu }, { positionAu: earthPositionAu }, sunState));
}

/** Scans one UTC noon-to-noon window (guaranteed to contain any local
 *  midnight regardless of longitude — this app has no timezone lookup
 *  anywhere, lat/lon + UTC only, same convention analysis/observer.js
 *  uses) for the target's best moment: max apparent altitude among
 *  astronomically-dark samples. Returns `null` if the target never clears
 *  MIN_OBSERVABLE_ALTITUDE_DEG during real darkness that night (including
 *  "no dark samples at all," e.g. high-latitude summer). */
function bestMomentInNight(nightStartMs, target, latDeg, lonDeg, elevationM) {
  let best = null;
  const stepMs = SAMPLE_INTERVAL_DAYS * 86400000;
  for (let ms = nightStartMs; ms < nightStartMs + 86400000; ms += stepMs) {
    const jsDate = new Date(ms);
    const sunObs = observeAt({ target: 'sun', jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
    if (sunObs.altDeg > NIGHT_SUN_ALT_DEG) continue; // not astronomically dark yet/anymore
    const targetObs = observeAt({ target, jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
    if (!best || targetObs.apparentAltDeg > best.apparentAltDeg) {
      best = { jsDate, apparentAltDeg: targetObs.apparentAltDeg, distanceAu: targetObs.distanceAu };
    }
  }
  if (!best || best.apparentAltDeg < MIN_OBSERVABLE_ALTITUDE_DEG) return null;
  return best;
}

/**
 * Best-observation-night ranking for `target` from a specific observer
 * location across [startUtc, endUtc): one score per calendar night (0 for
 * nights the target never clears MIN_OBSERVABLE_ALTITUDE_DEG during real
 * darkness), with the top MAX_CANDIDATES nights above MIN_REPORT_SCORE
 * reported as ranked events.
 */
export function analyzeBestObservationNight({ target, startUtc, endUtc, latDeg, lonDeg, elevationM = 0 }) {
  validateTarget(target);
  validateLatLon(latDeg, lonDeg);
  const startMs = Date.UTC(new Date(startUtc).getUTCFullYear(), new Date(startUtc).getUTCMonth(), new Date(startUtc).getUTCDate(), 12);
  const endMs = new Date(endUtc).getTime();
  if (!(endMs > startMs)) throw new Error('analyzeBestObservationNight requires endUtc after startUtc');

  const nightCount = Math.ceil((endMs - startMs) / 86400000);
  if (nightCount > MAX_NIGHTS_TO_SCAN) {
    throw new Error(`date range too long (~${nightCount} nights, max ${MAX_NIGHTS_TO_SCAN}) — shorten the range.`);
  }

  const { minDistanceAu, maxDistanceAu } = distanceBoundsAu(target);
  const timesJd = [];
  const valueDeg = []; // score 0-100, not degrees — reuses the shared timeline chart's y-axis field name
  const candidates = [];

  for (let ms = startMs; ms < endMs; ms += 86400000) {
    const moment = bestMomentInNight(ms, target, latDeg, lonDeg, elevationM);
    const jd = julianDateFromDate(moment ? moment.jsDate : new Date(ms));
    if (!moment) {
      timesJd.push(jd);
      valueDeg.push(0);
      continue;
    }

    const earthState = getBodyState('earth', moment.jsDate, PLANETS.earth.elements, { forceSource: 'kepler' });
    const sunState = sunBodyState(moment.jsDate);
    const moonObs = observeAt({ target: 'moon', jsDate: moment.jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
    const moonIlluminated = moonIlluminatedFractionAt(moment.jsDate, earthState.positionAu, sunState);

    const score = scoreNight({
      peakAltitudeDeg: moment.apparentAltDeg,
      moonAboveHorizon: moonObs.aboveHorizon,
      moonIlluminatedFraction: moonIlluminated,
      distanceAu: moment.distanceAu,
      minDistanceAu,
      maxDistanceAu,
    });

    timesJd.push(jd);
    valueDeg.push(score);

    if (score >= MIN_REPORT_SCORE) {
      candidates.push({
        event: 'best-observation-night',
        epochJd: jd,
        epochUtc: moment.jsDate.toISOString(),
        score,
        classification: classify(score),
        peakAltitudeDeg: moment.apparentAltDeg,
        moonAboveHorizon: moonObs.aboveHorizon,
        moonIlluminatedFraction: moonIlluminated,
        distanceAu: moment.distanceAu,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const events = candidates.slice(0, MAX_CANDIDATES).map((c, i) => ({ ...c, rank: i + 1 }));

  const midJsDate = new Date((startMs + endMs) / 2);
  const displaySource = getBodyState('earth', midJsDate, PLANETS.earth.elements, { forceSource: 'kepler' }).source;

  return {
    id: `best-night-${target}-${startUtc.slice(0, 4)}`,
    type: 'best-observation-night',
    target,
    observer: { type: 'topocentric', bodyId: 'earth', latDeg, lonDeg, elevationM },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN', source: displaySource },
    input: { startUtc, endUtc, latDeg, lonDeg, elevationM },
    result: { events },
    solver: {
      method: 'nightly-scan',
      status: events.length ? 'success' : 'no-events-in-range',
    },
    series: { timesJd, valueDeg },
  };
}
