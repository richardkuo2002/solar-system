// Phase angle / illuminated fraction (Moon, Mercury, Venus, Mars) — v0.5
// Event Toolkit, step 3. A different shape of problem from steps 1-2: a
// single-epoch evaluation, not an interval search, so no findStationaryPoints
// solver involved — just the Sun-target-observer angle and the roadmap's
// `k = (1 + cos(alpha)) / 2` formula. Pure math, zero DOM/THREE,
// Node-testable like core/.

import { sub, dot, length } from '../core/vector3.js';
import { getBodyState, sunBodyState } from '../core/ephemeris.js';
import { julianDateFromDate, moonHeliocentricPositionAu } from '../core/orbital-elements.js';
import { createBodyState } from '../core/body-state.js';
import { PLANETS } from '../data/planets.js';
import { MOONS } from '../data/moons.js';
import { RAD_TO_DEG } from './longitude.js';

export const PHASE_TARGETS = ['moon', 'mercury', 'venus', 'mars'];

function clampCos(v) {
  return Math.min(1, Math.max(-1, v));
}

/** Phase angle alpha — Sun-target-observer angle, vertex at the TARGET.
 *  0 = fully lit (observer between target and Sun, "full"); pi = fully
 *  dark ("new"). Radians, [0, pi]. */
export function phaseAngleRad(targetState, observerState, sunState) {
  const targetToSun = sub(sunState.positionAu, targetState.positionAu);
  const targetToObserver = sub(observerState.positionAu, targetState.positionAu);
  return Math.acos(clampCos(dot(targetToSun, targetToObserver) / (length(targetToSun) * length(targetToObserver))));
}

/** k = (1 + cos(alpha)) / 2, per the roadmap's formula verbatim. */
export function illuminatedFraction(phaseAngleRadValue) {
  return (1 + Math.cos(phaseAngleRadValue)) / 2;
}

// The Moon has no `elements`/Horizons entry (see docs/accuracy.md) — its
// body-state is synthesized here from the same moonHeliocentricPositionAu
// approximation the shared groundwork added, not from getBodyState.
function targetStateFor(targetKey, jsDate, forceSource) {
  if (targetKey === 'moon') {
    const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource: 'kepler' });
    const currentJD = julianDateFromDate(jsDate);
    const positionAu = moonHeliocentricPositionAu(MOONS.moon, earthState.positionAu, currentJD);
    return createBodyState({
      bodyId: 'moon', epochJd: currentJD, epochUtc: jsDate.toISOString(),
      source: 'kepler', sourceDetail: 'Meeus lunar theory (Ch.47 truncated series) — see docs/accuracy.md',
      quality: 'approximate', positionAu, velocityAuPerDay: { x: 0, y: 0, z: 0 },
      validity: { startUtc: null, endUtc: null, note: 'Approximate — see docs/accuracy.md' },
    });
  }
  return getBodyState(targetKey, jsDate, PLANETS[targetKey].elements, { forceSource });
}

function forceSourceFor(ephemerisSource) {
  if (ephemerisSource === 'kepler') return 'kepler';
  if (ephemerisSource === 'cache') return 'cache';
  return undefined; // 'auto' / 'horizons' -> default cache-or-fetch-in-background behavior
}

function validatePhaseTarget(target) {
  if (!PHASE_TARGETS.includes(target)) {
    throw new Error(`target must be one of ${PHASE_TARGETS.join(', ')}`);
  }
}

/**
 * Single-epoch phase angle / illuminated fraction for `target` as seen from
 * Earth at `atUtc`. No interval search, so the solver is honestly reported
 * as `method: 'direct'` rather than inventing a fake bisection tolerance
 * for something that doesn't iterate.
 */
export function analyzePhaseIllumination({ target, atUtc, ephemerisSource = 'kepler' }) {
  validatePhaseTarget(target);
  const jsDate = new Date(atUtc);
  if (Number.isNaN(jsDate.getTime())) {
    throw new Error('analyzePhaseIllumination: atUtc is not a valid date');
  }

  const forceSource = forceSourceFor(ephemerisSource);
  const targetState = targetStateFor(target, jsDate, forceSource);
  const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource: target === 'moon' ? 'kepler' : forceSource });
  const sunState = sunBodyState(jsDate);

  const phaseRad = phaseAngleRad(targetState, earthState, sunState);
  const fraction = illuminatedFraction(phaseRad);

  return {
    id: `${target}-phase-illumination-${atUtc.slice(0, 10)}`,
    type: 'phase-illumination',
    target,
    observer: { type: 'geocenter', bodyId: 'earth' },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN', source: targetState.source },
    input: { atUtc },
    epochJd: julianDateFromDate(jsDate), // convenience for chart marker placement, not part of the reproducibility contract
    result: { phaseAngleDeg: phaseRad * RAD_TO_DEG, illuminatedFraction: fraction },
    solver: { method: 'direct', toleranceSeconds: 0, status: 'success' },
  };
}

/**
 * A short illuminated-fraction-vs-time strip for the phase/illumination
 * panel's chart — a loop of single-epoch evaluations, no solver.
 */
export function samplePhaseSeries(target, startUtc, endUtc, intervalHours, { ephemerisSource = 'kepler' } = {}) {
  validatePhaseTarget(target);
  const startMs = new Date(startUtc).getTime();
  const endMs = new Date(endUtc).getTime();
  const stepMs = intervalHours * 3600 * 1000;
  if (!(stepMs > 0) || !(endMs > startMs)) {
    throw new Error('samplePhaseSeries requires endUtc after startUtc and a positive intervalHours');
  }

  const forceSource = forceSourceFor(ephemerisSource);
  const timesJd = [];
  const valueDeg = []; // illuminated fraction * 100, so the shared timeline chart's y-axis reads as a percentage
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const jsDate = new Date(ms);
    const targetState = targetStateFor(target, jsDate, forceSource);
    const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource: target === 'moon' ? 'kepler' : forceSource });
    const sunState = sunBodyState(jsDate);
    timesJd.push(julianDateFromDate(jsDate));
    valueDeg.push(illuminatedFraction(phaseAngleRad(targetState, earthState, sunState)) * 100);
  }
  return { timesJd, valueDeg };
}
