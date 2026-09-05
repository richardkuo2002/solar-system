// Lunar occultation of a planet — v1.4 Event Toolkit. Site-specific, like a
// solar eclipse (the Moon's ~2deg parallax shift across Earth means "does
// the Moon actually cover this point" only makes sense for one observer),
// so this reuses observer.js's observeAt directly for both the Moon and
// the target, and eclipse.js's exported angularSeparationDeg for their
// separation — zero new distance/position plumbing (observeAt already
// returns topocentric RA/Dec and distanceAu for any target). The minimum-
// finding technique is the same "sample d(separation)/dt, feed
// findStationaryPoints" trick used everywhere else in this codebase. Pure
// math, zero DOM/THREE, Node-testable like core/. Scope: planets only, not
// stars (see docs/accuracy.md's "Lunar Occultations (v1.4)" section for
// why, and for the precision ceiling — the Moon's ~10" lunar-theory error
// makes limb-grazing occultations unresolvable).

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

export const OCCULTATION_TARGETS = OBSERVER_TARGETS.filter((t) => t !== 'sun' && t !== 'moon');

const DEFAULT_TOLERANCE_SECONDS = 60;
// The Moon moves ~0.5deg/hour — the same order of angular speed eclipse.js's
// syzygy-finder half-step (0.05d, ~72min) is tuned for, since both problems
// are "an extremum of the Moon's angular relationship to something."
const REFINE_HALF_STEP_DAYS = 0.05;

function validateOccultationTarget(target) {
  if (!OCCULTATION_TARGETS.includes(target)) {
    throw new Error(`target must be one of ${OCCULTATION_TARGETS.join(', ')}`);
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
 * Occultation circumstances for one observer at `epochJd` — topocentric
 * Moon/target positions and their apparent angular radii determine
 * none/grazing/total. The Moon's disk is always far larger than any
 * planet's, so this mirrors eclipse.js's solarEclipseAt total/partial
 * branch (with 'total' meaning "planet fully hidden," the near-always
 * case whenever the disks overlap at all) — 'annular' is unreachable here.
 */
function occultationAt(epochJd, target, latDeg, lonDeg, elevationM) {
  const jsDate = dateFromJulianDate(epochJd);
  const moonObs = observeAt({ target: 'moon', jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
  const targetObs = observeAt({ target, jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });

  const moonDistanceKm = moonObs.distanceAu * KM_PER_AU;
  const targetDistanceKm = targetObs.distanceAu * KM_PER_AU;
  const moonAngularRadiusDeg = apparentAngularRadiusRad(MOONS.moon.radiusKm, moonDistanceKm) * RAD_TO_DEG;
  const targetAngularRadiusDeg = apparentAngularRadiusRad(PLANETS[target].radiusKm, targetDistanceKm) * RAD_TO_DEG;
  const separationDeg = angularSeparationDeg(moonObs.raDeg, moonObs.decDeg, targetObs.raDeg, targetObs.decDeg);

  const sumRadiiDeg = moonAngularRadiusDeg + targetAngularRadiusDeg;
  const diffRadiiDeg = moonAngularRadiusDeg - targetAngularRadiusDeg; // always positive: the Moon's disk is always far larger

  let classification;
  if (!moonObs.aboveHorizon) {
    classification = 'none'; // Moon below the horizon — nothing observable here regardless of geometry
  } else if (separationDeg >= sumRadiiDeg) {
    classification = 'none';
  } else if (separationDeg <= diffRadiiDeg) {
    classification = 'total'; // target's disk fully hidden behind the Moon
  } else {
    classification = 'grazing'; // target only partly hidden, near the Moon's limb
  }

  const magnitude = classification === 'none'
    ? 0
    : Math.max(0, (sumRadiiDeg - separationDeg) / (2 * moonAngularRadiusDeg));

  return { classification, magnitude, separationDeg };
}

/**
 * Lunar occultations of `target` across [startUtc, endUtc] as seen from
 * one observer: one event per lunar month where this location sees the
 * Moon pass close enough to the target for at least a grazing
 * occultation. Most months produce no result — occultation visibility is
 * a narrow footprint on Earth's surface, same reasoning as solar eclipses.
 */
export function analyzeLunarOccultation({
  target, startUtc, endUtc, latDeg, lonDeg, elevationM = 0, intervalHours = 24, ephemerisSource = 'kepler',
}) {
  validateOccultationTarget(target);
  validateLatLon(latDeg, lonDeg);
  const { startMs, endMs, stepMs } = validateRange(startUtc, endUtc, intervalHours);

  const timesJd = [];
  const separationDot = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const jd = julianDateFromDate(new Date(ms));
    timesJd.push(jd);
    separationDot.push(separationDerivativeAtJd(jd, target, latDeg, lonDeg, elevationM, REFINE_HALF_STEP_DAYS));
  }
  if (timesJd.length < 3) {
    throw new Error('analyzeLunarOccultation: date range too short to sample — need at least 3 points');
  }

  const evalFn = (jd) => separationDerivativeAtJd(jd, target, latDeg, lonDeg, elevationM, REFINE_HALF_STEP_DAYS);
  const extrema = findStationaryPoints(timesJd, separationDot, evalFn, {
    toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
    labelFor: (sign) => (sign < 0 ? 'minimum' : 'maximum'),
  }).filter((e) => e.transition === 'minimum').sort((a, b) => a.epochJd - b.epochJd);

  const events = extrema.map((pt) => {
    const { classification, magnitude, separationDeg } = occultationAt(pt.epochJd, target, latDeg, lonDeg, elevationM);
    return {
      event: 'lunar-occultation',
      epochJd: pt.epochJd,
      epochUtc: dateFromJulianDate(pt.epochJd).toISOString(),
      classification,
      magnitude,
      separationDeg,
      method: pt.method,
      toleranceSeconds: pt.toleranceSeconds,
    };
  });

  const midJsDate = new Date((startMs + endMs) / 2);
  const displaySource = getBodyState(target, midJsDate, PLANETS[target].elements, {
    forceSource: ephemerisSource === 'kepler' || ephemerisSource === 'cache' ? ephemerisSource : undefined,
  }).source;

  const visibleEvents = events.filter((e) => e.classification !== 'none');

  return {
    id: `lunar-occultation-${target}-${startUtc.slice(0, 4)}`,
    type: 'lunar-occultation',
    target,
    observer: { type: 'topocentric', bodyId: 'earth', latDeg, lonDeg, elevationM },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN', source: displaySource },
    input: { startUtc, endUtc, intervalHours, latDeg, lonDeg, elevationM },
    result: { events: visibleEvents },
    solver: {
      method: 'bisection',
      toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
      status: visibleEvents.length ? 'success' : 'no-events-in-range',
    },
    series: {
      timesJd: events.map((e) => e.epochJd),
      valueDeg: events.map((e) => e.separationDeg),
    },
  };
}
