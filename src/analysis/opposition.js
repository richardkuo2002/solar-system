// Opposition/conjunction analysis for outer planets (Mars, Jupiter,
// Saturn) — v0.5 Event Toolkit, step 1. Reuses retrograde.js's
// findStationaryPoints unmodified beyond its labelFor option: elongation
// (Sun-Earth-planet angle) oscillates smoothly between 0deg (conjunction)
// and 180deg (opposition) over the synodic period, so opposition/
// conjunction are just sign flips of d(elongation)/dt — exactly the same
// zero-crossing mechanism retrograde used for dλ/dt. Zero new root-finding
// code. Pure math, zero DOM/THREE, Node-testable like core/.

import { getBodyState, sunBodyState } from '../core/ephemeris.js';
import { julianDateFromDate, dateFromJulianDate } from '../core/orbital-elements.js';
import { PLANETS } from '../data/planets.js';
import { elongationRad } from './elongation.js';
import { findStationaryPoints } from './retrograde.js';
import { sampleGeocentricLongitudeSeries, RAD_TO_DEG } from './longitude.js';

export const OUTER_TARGETS = ['mars', 'jupiter', 'saturn'];

const DEFAULT_TOLERANCE_SECONDS = 60;
const REFINE_HALF_STEP_DAYS = 0.5; // outer-planet elongation changes slowly
  // (synodic periods of 1.1-2.0 years) — coarser than retrograde's 0.01d,
  // still far finer than the sampling interval.

function elongationAtJd(targetKey, jd, forceSource) {
  const jsDate = dateFromJulianDate(jd);
  const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource });
  const targetState = getBodyState(targetKey, jsDate, PLANETS[targetKey].elements, { forceSource });
  const sunState = sunBodyState(jsDate);
  return elongationRad(targetState, earthState, sunState);
}

/** Central-difference d(elongation)/dt at an arbitrary Julian Date. No
 *  wrap correction needed — elongation is bounded [0,π], never crosses a
 *  ±π seam the way longitude does. */
function elongationDerivativeAtJd(targetKey, jd, halfStepDays, forceSource) {
  const before = elongationAtJd(targetKey, jd - halfStepDays, forceSource);
  const after = elongationAtJd(targetKey, jd + halfStepDays, forceSource);
  return (after - before) / (2 * halfStepDays);
}

function forceSourceFor(ephemerisSource) {
  if (ephemerisSource === 'kepler') return 'kepler';
  if (ephemerisSource === 'cache') return 'cache';
  return undefined; // 'auto' / 'horizons' -> default cache-or-fetch-in-background behavior
}

// + -> - (elongation was rising toward 180deg, now falling) = local max = opposition.
// - -> + (elongation was falling toward 0deg, now rising) = local min = conjunction.
function labelFor(sign) {
  return sign > 0 ? 'opposition' : 'conjunction';
}

/**
 * Finds opposition/conjunction events for an outer planet across
 * [startUtc, endUtc]. The dense coarse scan + every bisection refinement
 * always force 'kepler' internally, regardless of `ephemerisSource` —
 * synodic-period scans sample even MORE densely than Mars retrograde did,
 * so letting each of those hundreds of calls fire a background Horizons
 * fetch would be worse here than it was for retrograde (same guardrail as
 * analysis/retrograde.js). `ephemerisSource` only selects the source for
 * one extra display-metadata lookup.
 */
export function analyzeOppositionConjunction({ target, startUtc, endUtc, intervalHours = 24, ephemerisSource = 'kepler' }) {
  if (!OUTER_TARGETS.includes(target)) {
    throw new Error(`analyzeOppositionConjunction: target must be one of ${OUTER_TARGETS.join(', ')}`);
  }
  const startMs = new Date(startUtc).getTime();
  const endMs = new Date(endUtc).getTime();
  const stepMs = intervalHours * 3600 * 1000;
  if (!(stepMs > 0) || !(endMs > startMs)) {
    throw new Error('analyzeOppositionConjunction requires endUtc after startUtc and a positive intervalHours');
  }

  const timesJd = [];
  const elongationRadValues = [];
  const elongationDot = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const jd = julianDateFromDate(new Date(ms));
    timesJd.push(jd);
    elongationRadValues.push(elongationAtJd(target, jd, 'kepler'));
    elongationDot.push(elongationDerivativeAtJd(target, jd, REFINE_HALF_STEP_DAYS, 'kepler'));
  }
  if (timesJd.length < 3) {
    throw new Error('analyzeOppositionConjunction: date range too short to sample — need at least 3 points');
  }

  const evalFn = (jd) => elongationDerivativeAtJd(target, jd, REFINE_HALF_STEP_DAYS, 'kepler');
  const stationary = findStationaryPoints(timesJd, elongationDot, evalFn, {
    toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
    labelFor,
  });

  const events = stationary
    .sort((a, b) => a.epochJd - b.epochJd)
    .map((pt) => ({
      event: pt.transition, // 'opposition' | 'conjunction'
      epochJd: pt.epochJd,
      epochUtc: dateFromJulianDate(pt.epochJd).toISOString(),
      elongationDeg: elongationAtJd(target, pt.epochJd, 'kepler') * RAD_TO_DEG,
      method: pt.method,
      toleranceSeconds: pt.toleranceSeconds,
    }));

  const midJsDate = new Date((startMs + endMs) / 2);
  const displayState = getBodyState(target, midJsDate, PLANETS[target].elements, { forceSource: forceSourceFor(ephemerisSource) });

  // xAu/yAu for the apparent-path chart, folded into series here (avoids
  // v0.4's double-sample mistake of computing this separately at the
  // call site).
  const pathSeries = sampleGeocentricLongitudeSeries(target, 'earth', startUtc, endUtc, intervalHours, { forceSource: 'kepler' });

  return {
    id: `${target}-opposition-conjunction-${startUtc.slice(0, 4)}`,
    type: 'opposition-conjunction',
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
    series: {
      timesJd,
      valueDeg: elongationRadValues.map((v) => v * RAD_TO_DEG),
      xAu: pathSeries.xAu,
      yAu: pathSeries.yAu,
    },
  };
}
