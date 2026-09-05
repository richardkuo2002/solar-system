// Moon-planet conjunction — v1.7 Event Toolkit. "How close does a planet
// get to the Moon in the sky, from a specific place" — the general
// phenomenon that analysis/occultation.js's disk-overlap classification
// is the special case of. Modeled on occultation.js (topocentric), NOT
// appulse.js (geocentric): the Moon's own parallax (~1deg) is larger than
// the separations this event type reports, so a geocentric Moon-planet
// separation can differ by a degree or more from what any actual observer
// sees — appulse.js's geocentric math would misreport this. Reuses
// observer.js's observeAt for both bodies, eclipse.js's exported
// angularSeparationDeg for their RA/Dec separation, and retrograde.js's
// findStationaryPoints for the minimum-finding — zero new position or
// solver plumbing. Pure math, zero DOM/THREE, Node-testable like core/.

import { dateFromJulianDate, julianDateFromDate } from '../core/orbital-elements.js';
import { PLANETS } from '../data/planets.js';
import { MOONS } from '../data/moons.js';
import { apparentAngularRadiusRad } from '../core/scale.js';
import { angularSeparationDeg } from './eclipse.js';
import { observeAt, OBSERVER_TARGETS } from './observer.js';
import { findStationaryPoints } from './retrograde.js';
import { RAD_TO_DEG } from './longitude.js';
import { KM_PER_AU } from '../core/units.js';
import { getBodyState } from '../core/ephemeris.js';

// Same target list and "planets only, not stars" reasoning as
// analysis/occultation.js's OCCULTATION_TARGETS.
export const MOON_CONJUNCTION_TARGETS = OBSERVER_TARGETS.filter((t) => t !== 'sun' && t !== 'moon');

const DEFAULT_TOLERANCE_SECONDS = 60;
// Same half-step as occultation.js/eclipse.js — the Moon moves ~0.5deg/hour,
// far faster than any planet's own motion, and both problems are "an
// extremum of the Moon's angular relationship to something."
const REFINE_HALF_STEP_DAYS = 0.05;

function validateTarget(target) {
  if (!MOON_CONJUNCTION_TARGETS.includes(target)) {
    throw new Error(`target must be one of ${MOON_CONJUNCTION_TARGETS.join(', ')}`);
  }
}

function validateLatLon(latDeg, lonDeg) {
  if (!(latDeg >= -90 && latDeg <= 90)) throw new Error('latDeg must be in [-90, 90]');
  if (!(lonDeg >= -180 && lonDeg <= 180)) throw new Error('lonDeg must be in [-180, 180]');
}

function validateRange(startUtc, endUtc, intervalHours) {
  const startMs = new Date(startUtc).getTime();
  const endMs = new Date(endUtc).getTime();
  const stepMs = intervalHours * 3600 * 1000;
  if (!(stepMs > 0) || !(endMs > startMs)) {
    throw new Error('requires endUtc after startUtc and a positive intervalHours');
  }
  return { startMs, endMs, stepMs };
}

function topocentricMoonTargetSeparationDeg(jd, target, latDeg, lonDeg, elevationM) {
  const jsDate = dateFromJulianDate(jd);
  const moonObs = observeAt({ target: 'moon', jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
  const targetObs = observeAt({ target, jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
  return angularSeparationDeg(moonObs.raDeg, moonObs.decDeg, targetObs.raDeg, targetObs.decDeg);
}

function separationDerivativeAtJd(jd, target, latDeg, lonDeg, elevationM, halfStepDays) {
  const before = topocentricMoonTargetSeparationDeg(jd - halfStepDays, target, latDeg, lonDeg, elevationM);
  const after = topocentricMoonTargetSeparationDeg(jd + halfStepDays, target, latDeg, lonDeg, elevationM);
  return (after - before) / (2 * halfStepDays);
}

/**
 * Conjunction circumstances at `epochJd` — the separation itself, plus
 * whether the two disks actually overlap (i.e. this closest approach is
 * also a lunar occultation — see analysis/occultation.js for the full
 * per-observer classification of that case).
 */
function conjunctionAt(epochJd, target, latDeg, lonDeg, elevationM) {
  const jsDate = dateFromJulianDate(epochJd);
  const moonObs = observeAt({ target: 'moon', jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
  const targetObs = observeAt({ target, jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });

  const moonAngularRadiusDeg = apparentAngularRadiusRad(MOONS.moon.radiusKm, moonObs.distanceAu * KM_PER_AU) * RAD_TO_DEG;
  const targetAngularRadiusDeg = apparentAngularRadiusRad(PLANETS[target].radiusKm, targetObs.distanceAu * KM_PER_AU) * RAD_TO_DEG;
  const separationDeg = angularSeparationDeg(moonObs.raDeg, moonObs.decDeg, targetObs.raDeg, targetObs.decDeg);

  return {
    separationDeg,
    aboveHorizon: moonObs.aboveHorizon && targetObs.aboveHorizon,
    wouldOccult: moonObs.aboveHorizon && separationDeg < moonAngularRadiusDeg + targetAngularRadiusDeg,
  };
}

/**
 * Moon-planet conjunctions across [startUtc, endUtc] as seen from one
 * observer: one event per lunar month where the Moon and `target` reach
 * their closest topocentric angular separation — reported regardless of
 * how close (same "report every crossing" approach as appulse.js), not
 * gated on any occultation threshold.
 */
export function analyzeMoonConjunction({
  target, startUtc, endUtc, latDeg, lonDeg, elevationM = 0, intervalHours = 24, ephemerisSource = 'kepler',
}) {
  validateTarget(target);
  validateLatLon(latDeg, lonDeg);
  const { startMs, endMs, stepMs } = validateRange(startUtc, endUtc, intervalHours);

  const timesJd = [];
  const separationDegValues = [];
  const separationDot = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const jd = julianDateFromDate(new Date(ms));
    timesJd.push(jd);
    separationDegValues.push(topocentricMoonTargetSeparationDeg(jd, target, latDeg, lonDeg, elevationM));
    separationDot.push(separationDerivativeAtJd(jd, target, latDeg, lonDeg, elevationM, REFINE_HALF_STEP_DAYS));
  }
  if (timesJd.length < 3) {
    throw new Error('analyzeMoonConjunction: date range too short to sample — need at least 3 points');
  }

  const evalFn = (jd) => separationDerivativeAtJd(jd, target, latDeg, lonDeg, elevationM, REFINE_HALF_STEP_DAYS);
  const extrema = findStationaryPoints(timesJd, separationDot, evalFn, {
    toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
    labelFor: (sign) => (sign < 0 ? 'minimum' : 'maximum'),
  }).filter((e) => e.transition === 'minimum').sort((a, b) => a.epochJd - b.epochJd);

  const events = extrema.map((pt) => {
    const { separationDeg, aboveHorizon, wouldOccult } = conjunctionAt(pt.epochJd, target, latDeg, lonDeg, elevationM);
    return {
      event: 'moon-conjunction',
      epochJd: pt.epochJd,
      epochUtc: dateFromJulianDate(pt.epochJd).toISOString(),
      separationDeg,
      aboveHorizon,
      wouldOccult,
      method: pt.method,
      toleranceSeconds: pt.toleranceSeconds,
    };
  });

  const midJsDate = new Date((startMs + endMs) / 2);
  const displaySource = getBodyState(target, midJsDate, PLANETS[target].elements, {
    forceSource: ephemerisSource === 'kepler' || ephemerisSource === 'cache' ? ephemerisSource : undefined,
  }).source;

  return {
    id: `moon-conjunction-${target}-${startUtc.slice(0, 4)}`,
    type: 'moon-conjunction',
    target,
    observer: { type: 'topocentric', bodyId: 'earth', latDeg, lonDeg, elevationM },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN', source: displaySource },
    input: { startUtc, endUtc, intervalHours, latDeg, lonDeg, elevationM },
    result: { events },
    solver: {
      method: 'bisection',
      toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
      status: events.length ? 'success' : 'no-events-in-range',
    },
    series: { timesJd, valueDeg: separationDegValues },
  };
}
