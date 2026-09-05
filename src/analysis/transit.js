// Transit of Mercury/Venus across the Sun's disk — v1.4 Event Toolkit.
// ~85% reuse of analysis/eclipse.js's solar-eclipse machinery: a transit is
// the same "occulting disk crosses the Sun's disk, as seen from a specific
// observer" geometry, just with a planet instead of the Moon as the
// occulter. The trigger epoch is different (inferior conjunction, not new
// moon — reuses analysis/elongation-events.js's existing conjunction
// finder rather than re-deriving it) but the disk-overlap classification
// and per-observer local-minimum refinement are eclipse.js's exact
// patterns, copied and renamed. Pure math, zero DOM/THREE, Node-testable
// like core/. See docs/accuracy.md's "Transits (v1.4)" section for the
// exact scope of every simplification made here.

import { getBodyState } from '../core/ephemeris.js';
import { dateFromJulianDate } from '../core/orbital-elements.js';
import { PLANETS, SUN } from '../data/planets.js';
import { apparentAngularRadiusRad } from '../core/scale.js';
import { angularSeparationDeg } from './eclipse.js';
import { analyzeInnerConjunction, INNER_TARGETS } from './elongation-events.js';
import { findStationaryPoints } from './retrograde.js';
import { RAD_TO_DEG } from './longitude.js';
import { KM_PER_AU } from '../core/units.js';
import { observeAt } from './observer.js';

const DEFAULT_TOLERANCE_SECONDS = 60;

function validateTransitTarget(target) {
  if (!INNER_TARGETS.includes(target)) {
    throw new Error(`target must be one of ${INNER_TARGETS.join(', ')}`);
  }
}

function validateLatLon(latDeg, lonDeg) {
  if (!(latDeg >= -90 && latDeg <= 90)) throw new Error('latDeg must be in [-90, 90]');
  if (!(lonDeg >= -180 && lonDeg <= 180)) throw new Error('lonDeg must be in [-180, 180]');
}

function topocentricSunTargetSeparationDeg(jd, target, latDeg, lonDeg, elevationM) {
  const jsDate = dateFromJulianDate(jd);
  const sunObs = observeAt({ target: 'sun', jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
  const targetObs = observeAt({ target, jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
  return angularSeparationDeg(sunObs.raDeg, sunObs.decDeg, targetObs.raDeg, targetObs.decDeg);
}

function separationDerivativeAtJd(jd, target, latDeg, lonDeg, elevationM, halfStepDays) {
  const before = topocentricSunTargetSeparationDeg(jd - halfStepDays, target, latDeg, lonDeg, elevationM);
  const after = topocentricSunTargetSeparationDeg(jd + halfStepDays, target, latDeg, lonDeg, elevationM);
  return (after - before) / (2 * halfStepDays);
}

// A transit runs longer than a lunar eclipse's few hours (Mercury/Venus
// move far slower against the Sun than the Moon does), so this window is
// wider than eclipse.js's LOCAL_REFINE_WINDOW_HOURS=3.
const LOCAL_REFINE_WINDOW_HOURS = 5;
const LOCAL_REFINE_STEP_HOURS = 0.25;
const LOCAL_REFINE_HALF_STEP_DAYS = 1 / 1440; // 1 minute

/** Refines a geocentric inferior-conjunction instant to this observer's own
 *  moment of least Sun-target apparent separation — identical technique to
 *  eclipse.js's refineLocalSolarEclipseEpoch (one more application of
 *  findStationaryPoints' generic extremum-finding). */
function refineLocalTransitEpoch(geocentricJd, target, latDeg, lonDeg, elevationM) {
  const windowDays = LOCAL_REFINE_WINDOW_HOURS / 24;
  const stepDays = LOCAL_REFINE_STEP_HOURS / 24;
  const timesJd = [];
  const derivs = [];
  for (let jd = geocentricJd - windowDays; jd <= geocentricJd + windowDays; jd += stepDays) {
    timesJd.push(jd);
    derivs.push(separationDerivativeAtJd(jd, target, latDeg, lonDeg, elevationM, LOCAL_REFINE_HALF_STEP_DAYS));
  }
  const evalFn = (jd) => separationDerivativeAtJd(jd, target, latDeg, lonDeg, elevationM, LOCAL_REFINE_HALF_STEP_DAYS);
  const extrema = findStationaryPoints(timesJd, derivs, evalFn, {
    toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
    labelFor: (sign) => (sign < 0 ? 'minimum' : 'maximum'),
  });
  const minimum = extrema.find((e) => e.transition === 'minimum');
  return minimum ? minimum.epochJd : geocentricJd;
}

/**
 * Transit circumstances for one observer at `epochJd` — topocentric Sun/
 * target positions (reusing analysis/observer.js's observeAt) and their
 * apparent angular radii determine none/grazing/transit. Same simplifying
 * assumptions solar eclipses already carry (spherical bodies, no
 * atmospheric refraction, no Besselian elements) — see docs/accuracy.md.
 * A planet's disk is always far smaller than the Sun's, so this is
 * eclipse.js's solarEclipseAt annular/partial branch, renamed: 'total' is
 * unreachable here.
 */
function transitAt(epochJd, target, latDeg, lonDeg, elevationM) {
  const jsDate = dateFromJulianDate(epochJd);
  const sunObs = observeAt({ target: 'sun', jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
  const targetObs = observeAt({ target, jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });

  const sunDistanceKm = sunObs.distanceAu * KM_PER_AU;
  const targetDistanceKm = targetObs.distanceAu * KM_PER_AU;
  const sunAngularRadiusDeg = apparentAngularRadiusRad(SUN.radiusKm, sunDistanceKm) * RAD_TO_DEG;
  const targetAngularRadiusDeg = apparentAngularRadiusRad(PLANETS[target].radiusKm, targetDistanceKm) * RAD_TO_DEG;
  const separationDeg = angularSeparationDeg(sunObs.raDeg, sunObs.decDeg, targetObs.raDeg, targetObs.decDeg);

  const sumRadiiDeg = sunAngularRadiusDeg + targetAngularRadiusDeg;
  const diffRadiiDeg = sunAngularRadiusDeg - targetAngularRadiusDeg; // always positive: the Sun's disk is always far larger

  let classification;
  if (!sunObs.aboveHorizon) {
    classification = 'none'; // Sun below the horizon — nothing observable here regardless of geometry
  } else if (separationDeg >= sumRadiiDeg) {
    classification = 'none';
  } else if (separationDeg <= diffRadiiDeg) {
    classification = 'transit'; // target's disk fully within the Sun's
  } else {
    classification = 'grazing'; // target's disk only partly overlaps the Sun's limb
  }

  const magnitude = classification === 'none'
    ? 0
    : Math.max(0, (sumRadiiDeg - separationDeg) / (2 * sunAngularRadiusDeg));

  return { classification, magnitude, separationDeg };
}

/**
 * Transits of Mercury or Venus across [startUtc, endUtc] as seen from one
 * observer: one event per inferior conjunction in range where this
 * location sees at least a grazing transit (Sun above the horizon and
 * disks overlapping). Most inferior conjunctions produce no transit —
 * Mercury/Venus's orbits are inclined a few degrees to the ecliptic, so
 * the planet usually passes above or below the Sun's disk as seen from
 * Earth. That's correct, matching how most new moons don't eclipse.
 */
export function analyzeTransit({
  target, startUtc, endUtc, latDeg, lonDeg, elevationM = 0, intervalHours = 24, ephemerisSource = 'kepler',
}) {
  validateTransitTarget(target);
  validateLatLon(latDeg, lonDeg);

  const conjunctions = analyzeInnerConjunction({ target, startUtc, endUtc, intervalHours, ephemerisSource })
    .result.events.filter((e) => e.event === 'inferior-conjunction');

  const refined = conjunctions.map((c) => ({
    ...c,
    epochJd: refineLocalTransitEpoch(c.epochJd, target, latDeg, lonDeg, elevationM),
  }));

  const events = refined.map((c) => {
    const { classification, magnitude, separationDeg } = transitAt(c.epochJd, target, latDeg, lonDeg, elevationM);
    return {
      event: 'transit',
      epochJd: c.epochJd,
      epochUtc: dateFromJulianDate(c.epochJd).toISOString(),
      classification,
      magnitude,
      separationDeg,
      method: c.method,
      toleranceSeconds: c.toleranceSeconds,
    };
  }).filter((e) => e.classification !== 'none');

  const midJsDate = new Date((new Date(startUtc).getTime() + new Date(endUtc).getTime()) / 2);
  const displaySource = getBodyState(target, midJsDate, PLANETS[target].elements, {
    forceSource: ephemerisSource === 'kepler' || ephemerisSource === 'cache' ? ephemerisSource : undefined,
  }).source;

  return {
    id: `${target}-transit-${startUtc.slice(0, 4)}`,
    type: 'transit',
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
    series: {
      timesJd: refined.map((c) => c.epochJd),
      valueDeg: refined.map((c) => transitAt(c.epochJd, target, latDeg, lonDeg, elevationM).separationDeg),
    },
  };
}
