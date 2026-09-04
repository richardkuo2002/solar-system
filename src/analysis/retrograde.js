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

// Default label matches v0.4's original retrograde-only vocabulary — kept
// as the default so analyzeMarsRetrograde (which doesn't pass `labelFor`)
// is unaffected. Other event types (opposition/conjunction, greatest
// elongation, ...) pass their own `labelFor` rather than string-matching
// on retrograde vocabulary after the fact — see src/analysis/opposition.js
// and elongation-events.js.
const DEFAULT_LABEL_FOR = (sign) => (sign > 0 ? 'direct-to-retrograde' : 'retrograde-to-direct');

/**
 * Coarse-scan the already-sampled (timesJd, valuesAtSamples) series for
 * sign flips, then bisects `evalFnAtJd(jd)` (a callback that can
 * re-evaluate the same quantity at any Julian Date, not just the coarse
 * grid) down to `toleranceSeconds`. Never returns a raw coarse-sample
 * time — every result comes out of the refinement loop.
 *
 * Generic zero-crossing finder — built for retrograde's dλ/dt, but equally
 * usable for any series: feed it elongation's derivative to find
 * opposition/conjunction extrema, or raw signed elongation to find
 * conjunction zero-crossings directly. `labelFor(signOfBracketStart)`
 * lets each caller supply its own event vocabulary instead of inheriting
 * retrograde's.
 */
export function findStationaryPoints(timesJd, valuesAtSamples, evalFnAtJd, {
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  labelFor = DEFAULT_LABEL_FOR,
} = {}) {
  const toleranceDays = toleranceSeconds / 86400;
  const results = [];

  for (let i = 0; i < timesJd.length - 1; i += 1) {
    const a = valuesAtSamples[i];
    const b = valuesAtSamples[i + 1];
    if (a === 0 || b === 0 || Math.sign(a) === Math.sign(b)) continue; // no sign flip in this bracket

    let lo = timesJd[i];
    let hi = timesJd[i + 1];
    // Bracket direction is trusted from the coarse a/b sign flip — bisection
    // just needs to know which side of the bracket started positive.
    const startingSign = Math.sign(a) || 1;

    let iterations = 0;
    while ((hi - lo) > toleranceDays && iterations < MAX_BISECTION_ITERATIONS) {
      const mid = (lo + hi) / 2;
      const midVal = evalFnAtJd(mid);
      if (Math.sign(midVal) === startingSign || Math.sign(midVal) === 0) {
        lo = mid;
      } else {
        hi = mid;
      }
      iterations += 1;
    }

    const epochJd = (lo + hi) / 2;
    const transition = labelFor(startingSign);
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
  const series = sampleGeocentricLongitudeSeries('mars', 'earth', startUtc, endUtc, intervalHours, { forceSource: 'kepler' });
  const { timesJd, lambdaRad } = series;
  if (timesJd.length < 3) {
    throw new Error('analyzeMarsRetrograde: date range too short to sample — need at least 3 points');
  }

  const lambdaUnwrapped = unwrapAnglesRad(lambdaRad);
  const lambdaDotRadPerDay = centralDiffAngularVelocityRadPerDay(lambdaUnwrapped, timesJd);
  const evalLambdaDotAt = (jd) => angularVelocityAtJd(jd, REFINE_HALF_STEP_DAYS, 'kepler');
  const stationary = findStationaryPoints(timesJd, lambdaDotRadPerDay, evalLambdaDotAt);
  // Pre-unwrapped, degree-valued series for the chart layer — same
  // `valueDeg` field name analysis/opposition.js's series uses, so
  // render/event-charts.js and the lab-panel builder stay event-type-agnostic.
  const chartSeries = { ...series, valueDeg: lambdaUnwrapped.map((v) => v * RAD_TO_DEG) };

  const base = {
    // id/input added for v0.5's export.js — additive only, doesn't touch
    // any of this result's existing fields/shape (observer stays the
    // string 'earth-geocenter', frame/source stay top-level, not nested
    // under `reference`) so v0.4's own tests and panel formatter are
    // unaffected. export.js reads both this legacy shape and the newer
    // nested one via small accessor helpers rather than forcing a shape
    // migration here.
    id: `mars-retrograde-${startUtc.slice(0, 4)}`,
    type: 'retrograde-interval',
    target: 'mars',
    observer: 'earth-geocenter',
    frame: 'GEOCENTRIC_ECLIPJ2000',
    input: { startUtc, endUtc, intervalHours },
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
      series: chartSeries,
    };
  }

  const sorted = [...stationary].sort((x, y) => x.epochJd - y.epochJd);
  const [firstPoint, secondPoint] = sorted;

  return {
    ...base,
    source: displayMarsState.source,
    start: eventAt(firstPoint.epochJd, firstPoint.transition, 'kepler'),
    end: eventAt(secondPoint.epochJd, secondPoint.transition, 'kepler'),
    series: chartSeries,
  };
}
