// Mars retrograde-motion analysis — v0.4 "Mars Retrograde Lab". Pure math,
// zero DOM/THREE, Node-testable like core/. See docs/ROADMAP.md's v0.4
// spec for the acceptance criteria this satisfies.

import {
  sampleGeocentricLongitudeSeries, unwrapAnglesRad, centralDiffAngularVelocityRadPerDay,
  geocentricEclipticLongitudeRad, RAD_TO_DEG,
} from './longitude.js';
import { getBodyState } from '../core/ephemeris.js';
import { julianDateFromDate, dateFromJulianDate } from '../core/orbital-elements.js';
import { PLANETS } from '../data/planets.js';

const DEFAULT_TOLERANCE_SECONDS = 60;
const REFINE_HALF_STEP_DAYS = 0.01; // ~14 min — finer than the 6h coarse interval, used
  // to re-derive dλ/dt at each bisection midpoint during stationary-point refinement.
const MAX_BISECTION_ITERATIONS = 60; // generous cap; a 6h bracket converges to 60s well under this

/** dλ/dt < 0 is retrograde (apparent westward drift), > 0 is direct. */
export function classifyMotion(lambdaDotRadPerDay) {
  return lambdaDotRadPerDay < 0 ? 'retrograde' : 'direct';
}

function lambdaAtJd(jd, forceSource) {
  const jsDate = dateFromJulianDate(jd);
  const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource });
  const marsState = getBodyState('mars', jsDate, PLANETS.mars.elements, { forceSource });
  return geocentricEclipticLongitudeRad(marsState, earthState);
}

/** Central-difference dλ/dt at an arbitrary (non-grid) Julian Date. */
function angularVelocityAtJd(jd, halfStepDays, forceSource) {
  const before = lambdaAtJd(jd - halfStepDays, forceSource);
  const after = lambdaAtJd(jd + halfStepDays, forceSource);
  let delta = after - before;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta / (2 * halfStepDays);
}

/**
 * Coarse-scan the already-sampled (timesJd, lambdaDotRadPerDay) series for
 * dλ/dt sign flips, then bisects `evalLambdaDotAt(jd)` (a callback that can
 * re-evaluate dλ/dt at any Julian Date, not just the coarse grid) down to
 * `toleranceSeconds`. Never returns a raw coarse-sample time — every result
 * comes out of the refinement loop.
 */
export function findStationaryPoints(timesJd, lambdaDotRadPerDay, evalLambdaDotAt, {
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
} = {}) {
  const toleranceDays = toleranceSeconds / 86400;
  const results = [];

  for (let i = 0; i < timesJd.length - 1; i += 1) {
    const a = lambdaDotRadPerDay[i];
    const b = lambdaDotRadPerDay[i + 1];
    if (a === 0 || b === 0 || Math.sign(a) === Math.sign(b)) continue; // no sign flip in this bracket

    let lo = timesJd[i];
    let hi = timesJd[i + 1];
    // Bracket direction is trusted from the coarse a/b sign flip — bisection
    // just needs to know which side of the bracket started positive.
    const startingSign = Math.sign(a) || 1;

    let iterations = 0;
    while ((hi - lo) > toleranceDays && iterations < MAX_BISECTION_ITERATIONS) {
      const mid = (lo + hi) / 2;
      const midVal = evalLambdaDotAt(mid);
      if (Math.sign(midVal) === startingSign || Math.sign(midVal) === 0) {
        lo = mid;
      } else {
        hi = mid;
      }
      iterations += 1;
    }

    const epochJd = (lo + hi) / 2;
    const transition = a < 0 ? 'retrograde-to-direct' : 'direct-to-retrograde';
    results.push({ epochJd, method: 'bisection', toleranceSeconds, transition });
  }

  return results;
}

function forceSourceFor(ephemerisSource) {
  if (ephemerisSource === 'kepler') return 'kepler';
  if (ephemerisSource === 'cache') return 'cache';
  return undefined; // 'auto' / 'horizons' -> default cache-or-fetch-in-background behavior
}

function eventAt(epochJd, transition, forceSource) {
  const lambdaRad = lambdaAtJd(epochJd, forceSource);
  const lambdaDotRadPerDay = angularVelocityAtJd(epochJd, REFINE_HALF_STEP_DAYS, forceSource);
  return {
    event: transition === 'direct-to-retrograde' ? 'stationary-direct-to-retrograde' : 'stationary-retrograde-to-direct',
    epochJd,
    epochUtc: dateFromJulianDate(epochJd).toISOString(),
    lambdaDeg: lambdaRad * RAD_TO_DEG,
    lambdaDotDegPerDay: lambdaDotRadPerDay * RAD_TO_DEG,
  };
}

/**
 * Orchestrator: samples Mars's geocentric longitude across the requested
 * range, finds the two stationary points bracketing a retrograde interval,
 * and assembles the roadmap's result shape (with `source: 'horizons-live'`
 * replaced by whatever this codebase actually produces — see
 * docs/accuracy.md, that value is structurally unreachable here).
 *
 * The dense coarse scan + every bisection refinement always force
 * `ephemerisSource: 'kepler'` internally, regardless of the `ephemerisSource`
 * argument — a multi-month range at 6h resolution is hundreds of
 * body-state calls, and letting that fire a Horizons background fetch per
 * call would be an unwanted, unbounded side effect (see plan doc / README
 * limitations). `ephemerisSource` only selects the source used for one
 * extra Earth/Mars lookup that populates the result's top-level `source`
 * display metadata.
 */
export function analyzeMarsRetrograde({ startUtc, endUtc, intervalHours = 6, ephemerisSource = 'kepler' }) {
  const { timesJd, lambdaRad } = sampleGeocentricLongitudeSeries(startUtc, endUtc, intervalHours, { forceSource: 'kepler' });
  if (timesJd.length < 3) {
    throw new Error('analyzeMarsRetrograde: date range too short to sample — need at least 3 points');
  }

  const lambdaUnwrapped = unwrapAnglesRad(lambdaRad);
  const lambdaDotRadPerDay = centralDiffAngularVelocityRadPerDay(lambdaUnwrapped, timesJd);
  const evalLambdaDotAt = (jd) => angularVelocityAtJd(jd, REFINE_HALF_STEP_DAYS, 'kepler');
  const stationary = findStationaryPoints(timesJd, lambdaDotRadPerDay, evalLambdaDotAt);

  const base = {
    type: 'retrograde-interval',
    target: 'mars',
    observer: 'earth-geocenter',
    frame: 'GEOCENTRIC_ECLIPJ2000',
    samples: { intervalHours, count: timesJd.length },
    solver: { method: 'bisection', toleranceSeconds: DEFAULT_TOLERANCE_SECONDS },
    opposition: null, // not computed this version — see v0.5 (Event Toolkit)
  };

  // Display-only source lookup (see the dense-scan mitigation note above) —
  // uses the requested source, not the forced-Kepler one driving the math.
  const midJsDate = new Date((new Date(startUtc).getTime() + new Date(endUtc).getTime()) / 2);
  const displayMarsState = getBodyState('mars', midJsDate, PLANETS.mars.elements, { forceSource: forceSourceFor(ephemerisSource) });

  if (stationary.length < 2) {
    return {
      ...base,
      source: displayMarsState.source,
      start: null,
      end: null,
      note: 'No stationary points found in range — this window likely contains no Mars retrograde interval.',
    };
  }

  const sorted = [...stationary].sort((x, y) => x.epochJd - y.epochJd);
  const [firstPoint, secondPoint] = sorted;

  return {
    ...base,
    source: displayMarsState.source,
    start: eventAt(firstPoint.epochJd, firstPoint.transition, 'kepler'),
    end: eventAt(secondPoint.epochJd, secondPoint.transition, 'kepler'),
  };
}
