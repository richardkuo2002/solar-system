// Geocentric ecliptic longitude of a target body as seen from an observer
// body, both given as heliocentric AU body-states — pure math, zero DOM/
// THREE, Node-testable like core/. See docs/ROADMAP.md's v0.4 spec for the
// exact geometry this implements.
//
// Deliberately does NOT reuse core/camera-modes.js's geocentric direction
// logic: that operates on already scene-scaled positions with an x/z-plane
// yaw convention — a different angle entirely from the raw-AU x/y-plane
// longitude computed here.

import { sub } from '../core/vector3.js';
import { getBodyState } from '../core/ephemeris.js';
import { julianDateFromDate, dateFromJulianDate } from '../core/orbital-elements.js';
import { PLANETS } from '../data/planets.js';
import { FRAME_ECLIPJ2000 } from '../core/body-state.js';

const RAD_TO_DEG = 180 / Math.PI;
const MS_PER_HOUR = 3600 * 1000;

function assertEclipJ2000(state, label) {
  if (state.frame !== FRAME_ECLIPJ2000) {
    throw new Error(`${label} body-state frame is '${state.frame}', expected '${FRAME_ECLIPJ2000}' — geocentricEclipticLongitudeRad assumes ECLIPJ2000 and does not convert.`);
  }
}

/**
 * λ = atan2(Δy, Δx) of the heliocentric target-minus-observer AU vector.
 * Both states must already be ECLIPJ2000 (every body-state in this
 * codebase is, per docs/accuracy.md — this asserts rather than silently
 * assuming it).
 */
export function geocentricEclipticLongitudeRad(targetState, observerState) {
  assertEclipJ2000(targetState, 'target');
  assertEclipJ2000(observerState, 'observer');
  const rTargetObserver = sub(targetState.positionAu, observerState.positionAu);
  return Math.atan2(rTargetObserver.y, rTargetObserver.x);
}

/**
 * Samples targetKey's geocentric ecliptic longitude, as seen from
 * observerKey, across [startUtc, endUtc] at intervalHours, returning
 * parallel arrays ready for unwrap/velocity/solver use. `forceSource` is
 * forwarded to getBodyState for every sample — see analysis/retrograde.js
 * (and analysis/opposition.js) for why dense scans always force 'kepler'.
 */
export function sampleGeocentricLongitudeSeries(targetKey, observerKey, startUtc, endUtc, intervalHours, { forceSource } = {}) {
  const startMs = new Date(startUtc).getTime();
  const endMs = new Date(endUtc).getTime();
  const stepMs = intervalHours * MS_PER_HOUR;
  if (!(stepMs > 0) || !(endMs > startMs)) {
    throw new Error('sampleGeocentricLongitudeSeries requires endUtc after startUtc and a positive intervalHours');
  }

  const timesJd = [];
  const lambdaRad = [];
  const xAu = []; // (target - observer).x — also handed to the apparent-path chart (visual block 2)
  const yAu = []; // (target - observer).y — so it doesn't need a second sampling pass
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const jsDate = new Date(ms);
    const observerState = getBodyState(observerKey, jsDate, PLANETS[observerKey].elements, { forceSource });
    const targetState = getBodyState(targetKey, jsDate, PLANETS[targetKey].elements, { forceSource });
    const rTargetObserver = sub(targetState.positionAu, observerState.positionAu);
    timesJd.push(julianDateFromDate(jsDate));
    lambdaRad.push(Math.atan2(rTargetObserver.y, rTargetObserver.x));
    xAu.push(rTargetObserver.x);
    yAu.push(rTargetObserver.y);
  }
  return { timesJd, lambdaRad, xAu, yAu };
}

/**
 * Continuous (unwrapped) angle sequence — so a 359°→0° crossing reads as
 * +1° of progress, not a -359° jump. Fixes a bug in the roadmap's own
 * example code (`const out = [values]` pushed the whole input array as
 * element 0; this uses `[values[0]]`, the first *value*).
 */
export function unwrapAnglesRad(values) {
  if (values.length === 0) return [];
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    let delta = values[i] - values[i - 1];
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    out.push(out[i - 1] + delta);
  }
  return out;
}

/**
 * dλ/dt in rad/day via central difference, mirroring orbital-elements.js's
 * elementsVelocity technique. Edges (no neighbor on one side) fall back to
 * a one-sided difference — a documented simplification rather than NaN
 * padding, consistent with how short a fraction of the series they are.
 */
export function centralDiffAngularVelocityRadPerDay(unwrappedAnglesRad, timesJd) {
  const n = unwrappedAnglesRad.length;
  if (n !== timesJd.length) {
    throw new Error('centralDiffAngularVelocityRadPerDay: unwrappedAnglesRad and timesJd must be the same length');
  }
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    if (i === 0) {
      out[i] = (unwrappedAnglesRad[1] - unwrappedAnglesRad[0]) / (timesJd[1] - timesJd[0]);
    } else if (i === n - 1) {
      out[i] = (unwrappedAnglesRad[i] - unwrappedAnglesRad[i - 1]) / (timesJd[i] - timesJd[i - 1]);
    } else {
      out[i] = (unwrappedAnglesRad[i + 1] - unwrappedAnglesRad[i - 1]) / (timesJd[i + 1] - timesJd[i - 1]);
    }
  }
  return out;
}

export { RAD_TO_DEG, dateFromJulianDate };
