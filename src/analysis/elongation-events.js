// Inner-planet elongation events (Mercury, Venus) — v0.5 Event Toolkit,
// step 2. Same "feed a different series into findStationaryPoints" trick
// as opposition.js: greatest elongation is an extremum of *signed*
// elongation (feed its derivative, same mechanism opposition.js uses),
// and inferior/superior conjunction is a zero-crossing of the raw signed
// elongation values themselves (no derivative step at all — the other
// generic use findStationaryPoints was built for). Zero new root-finding
// code. Pure math, zero DOM/THREE, Node-testable like core/.

import { getBodyState, sunBodyState } from '../core/ephemeris.js';
import { julianDateFromDate, dateFromJulianDate } from '../core/orbital-elements.js';
import { PLANETS } from '../data/planets.js';
import { sub, length } from '../core/vector3.js';
import { signedElongationRad } from './elongation.js';
import { findStationaryPoints } from './retrograde.js';
import { RAD_TO_DEG } from './longitude.js';

export const INNER_TARGETS = ['mercury', 'venus'];

const DEFAULT_TOLERANCE_SECONDS = 60;
const REFINE_HALF_STEP_DAYS = 0.25; // Mercury's ~116-day synodic period is
  // much shorter than Jupiter/Saturn's — finer than opposition.js's 0.5d.

function signedElongationAtJd(targetKey, jd, forceSource) {
  const jsDate = dateFromJulianDate(jd);
  const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource });
  const targetState = getBodyState(targetKey, jsDate, PLANETS[targetKey].elements, { forceSource });
  const sunState = sunBodyState(jsDate);
  return signedElongationRad(targetState, earthState, sunState);
}

/** Central-difference d(signed elongation)/dt. No wrap correction needed —
 *  signed elongation is bounded, never crosses a ±π seam. */
function signedElongationDerivativeAtJd(targetKey, jd, halfStepDays, forceSource) {
  const before = signedElongationAtJd(targetKey, jd - halfStepDays, forceSource);
  const after = signedElongationAtJd(targetKey, jd + halfStepDays, forceSource);
  return (after - before) / (2 * halfStepDays);
}

function forceSourceFor(ephemerisSource) {
  if (ephemerisSource === 'kepler') return 'kepler';
  if (ephemerisSource === 'cache') return 'cache';
  return undefined; // 'auto' / 'horizons' -> default cache-or-fetch-in-background behavior
}

function validateInnerTarget(target) {
  if (!INNER_TARGETS.includes(target)) {
    throw new Error(`target must be one of ${INNER_TARGETS.join(', ')}`);
  }
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

// + -> - (signed elongation was rising, now falling) = local max = greatest
// eastern elongation. - -> + (was falling, now rising) = local min =
// greatest western elongation.
function elongationExtremumLabelFor(sign) {
  return sign > 0 ? 'greatest-eastern-elongation' : 'greatest-western-elongation';
}

/**
 * Finds greatest-eastern/western-elongation events for an inner planet
 * across [startUtc, endUtc]. Same dense-scan-forces-Kepler guardrail as
 * analysis/opposition.js — `ephemerisSource` only selects the source for
 * one extra display-metadata lookup.
 */
export function analyzeGreatestElongation({ target, startUtc, endUtc, intervalHours = 12, ephemerisSource = 'kepler' }) {
  validateInnerTarget(target);
  const { startMs, endMs, stepMs } = validateRange(startUtc, endUtc, intervalHours);

  const timesJd = [];
  const signedElongationRadValues = [];
  const signedElongationDot = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const jd = julianDateFromDate(new Date(ms));
    timesJd.push(jd);
    signedElongationRadValues.push(signedElongationAtJd(target, jd, 'kepler'));
    signedElongationDot.push(signedElongationDerivativeAtJd(target, jd, REFINE_HALF_STEP_DAYS, 'kepler'));
  }
  if (timesJd.length < 3) {
    throw new Error('analyzeGreatestElongation: date range too short to sample — need at least 3 points');
  }

  const evalFn = (jd) => signedElongationDerivativeAtJd(target, jd, REFINE_HALF_STEP_DAYS, 'kepler');
  const stationary = findStationaryPoints(timesJd, signedElongationDot, evalFn, {
    toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
    labelFor: elongationExtremumLabelFor,
  });

  const events = stationary
    .sort((a, b) => a.epochJd - b.epochJd)
    .map((pt) => ({
      event: pt.transition, // 'greatest-eastern-elongation' | 'greatest-western-elongation'
      epochJd: pt.epochJd,
      epochUtc: dateFromJulianDate(pt.epochJd).toISOString(),
      signedElongationDeg: signedElongationAtJd(target, pt.epochJd, 'kepler') * RAD_TO_DEG,
      method: pt.method,
      toleranceSeconds: pt.toleranceSeconds,
    }));

  const midJsDate = new Date((startMs + endMs) / 2);
  const displayState = getBodyState(target, midJsDate, PLANETS[target].elements, { forceSource: forceSourceFor(ephemerisSource) });

  return {
    id: `${target}-greatest-elongation-${startUtc.slice(0, 4)}`,
    type: 'greatest-elongation',
    target,
    observer: { type: 'geocenter', bodyId: 'earth' },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN', source: displayState.source },
    input: { startUtc, endUtc, intervalHours },
    result: { events },
    solver: {
      method: 'bisection',
      toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
      status: events.length ? 'success' : 'no-events-in-range',
    },
    series: { timesJd, valueDeg: signedElongationRadValues.map((v) => v * RAD_TO_DEG) },
  };
}

/** Inferior (target between Earth and Sun) vs. superior (target beyond the
 *  Sun) — classified from Earth-distance at the crossing epoch, not from
 *  the crossing direction (a signed-elongation zero-crossing alone can't
 *  tell the two apart). */
function classifyConjunction(targetKey, epochJd) {
  const jsDate = dateFromJulianDate(epochJd);
  const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource: 'kepler' });
  const targetState = getBodyState(targetKey, jsDate, PLANETS[targetKey].elements, { forceSource: 'kepler' });
  const sunState = sunBodyState(jsDate);
  const targetDistAu = length(sub(targetState.positionAu, earthState.positionAu));
  const sunDistAu = length(sub(sunState.positionAu, earthState.positionAu));
  return targetDistAu < sunDistAu ? 'inferior-conjunction' : 'superior-conjunction';
}

/**
 * Finds inferior/superior conjunction events for an inner planet across
 * [startUtc, endUtc]. Feeds `findStationaryPoints` the raw signed-
 * elongation VALUES directly (not a derivative) — zero-crossings, two per
 * synodic cycle. Same dense-scan-forces-Kepler guardrail as
 * analyzeGreatestElongation.
 */
export function analyzeInnerConjunction({ target, startUtc, endUtc, intervalHours = 12, ephemerisSource = 'kepler' }) {
  validateInnerTarget(target);
  const { startMs, endMs, stepMs } = validateRange(startUtc, endUtc, intervalHours);

  const timesJd = [];
  const signedElongationRadValues = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const jd = julianDateFromDate(new Date(ms));
    timesJd.push(jd);
    signedElongationRadValues.push(signedElongationAtJd(target, jd, 'kepler'));
  }
  if (timesJd.length < 3) {
    throw new Error('analyzeInnerConjunction: date range too short to sample — need at least 3 points');
  }

  const evalFn = (jd) => signedElongationAtJd(target, jd, 'kepler');
  // Default labelFor is unused here — classification comes from
  // classifyConjunction (geometry), not the crossing direction.
  const stationary = findStationaryPoints(timesJd, signedElongationRadValues, evalFn, {
    toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
  });

  const events = stationary
    .sort((a, b) => a.epochJd - b.epochJd)
    .map((pt) => ({
      event: classifyConjunction(target, pt.epochJd), // 'inferior-conjunction' | 'superior-conjunction'
      epochJd: pt.epochJd,
      epochUtc: dateFromJulianDate(pt.epochJd).toISOString(),
      signedElongationDeg: signedElongationAtJd(target, pt.epochJd, 'kepler') * RAD_TO_DEG,
      method: pt.method,
      toleranceSeconds: pt.toleranceSeconds,
    }));

  const midJsDate = new Date((startMs + endMs) / 2);
  const displayState = getBodyState(target, midJsDate, PLANETS[target].elements, { forceSource: forceSourceFor(ephemerisSource) });

  return {
    id: `${target}-inner-conjunction-${startUtc.slice(0, 4)}`,
    type: 'inner-conjunction',
    target,
    observer: { type: 'geocenter', bodyId: 'earth' },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN', source: displayState.source },
    input: { startUtc, endUtc, intervalHours },
    result: { events },
    solver: {
      method: 'bisection',
      toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
      status: events.length ? 'success' : 'no-events-in-range',
    },
    series: { timesJd, valueDeg: signedElongationRadValues.map((v) => v * RAD_TO_DEG) },
  };
}
