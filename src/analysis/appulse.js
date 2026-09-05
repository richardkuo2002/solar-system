// Planet-planet visual appulse ("how close do two planets get in Earth's
// sky") — v1.4 Event Toolkit. Zero new solver: the angular-separation
// primitive already exists as elongation.js's elongationRad (structurally
// general, just re-exported here under an honest name via
// angularSeparationAtObserver), and the minimum-finding technique is
// exactly eclipse.js's refineLocalSolarEclipseEpoch pattern (sample
// d(separation)/dt, feed findStationaryPoints, keep the 'minimum'
// results) run over the user's full date range instead of a short
// refinement window. Geocentric, not topocentric — an appulse is "how
// close in Earth's sky," not tied to one observer's horizon, matching how
// eclipse.js's syzygy step is geocentric before any per-observer
// refinement. Pure math, zero DOM/THREE, Node-testable like core/. See
// docs/accuracy.md's "Planetary Appulses (v1.4)" section.

import { getBodyState } from '../core/ephemeris.js';
import { julianDateFromDate, dateFromJulianDate } from '../core/orbital-elements.js';
import { PLANETS, PLANET_ORDER } from '../data/planets.js';
import { angularSeparationAtObserver } from './elongation.js';
import { findStationaryPoints } from './retrograde.js';
import { RAD_TO_DEG } from './longitude.js';

export const APPULSE_TARGETS = PLANET_ORDER.filter((k) => k !== 'earth');

const DEFAULT_TOLERANCE_SECONDS = 60;
const REFINE_HALF_STEP_DAYS = 0.25; // safe for the fastest possible pair (Mercury/Venus involved) — same half-step elongation-events.js uses for inner-planet dynamics; slower outer-outer pairs are just oversampled, which is harmless.

function validateAppulseTargets(planetA, planetB) {
  if (!APPULSE_TARGETS.includes(planetA)) throw new Error(`planetA must be one of ${APPULSE_TARGETS.join(', ')}`);
  if (!APPULSE_TARGETS.includes(planetB)) throw new Error(`planetB must be one of ${APPULSE_TARGETS.join(', ')}`);
  if (planetA === planetB) throw new Error('planetA and planetB must be different planets');
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

function separationDegAtJd(planetA, planetB, jd) {
  const jsDate = dateFromJulianDate(jd);
  const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource: 'kepler' });
  const stateA = getBodyState(planetA, jsDate, PLANETS[planetA].elements, { forceSource: 'kepler' });
  const stateB = getBodyState(planetB, jsDate, PLANETS[planetB].elements, { forceSource: 'kepler' });
  return angularSeparationAtObserver(stateA, earthState, stateB) * RAD_TO_DEG;
}

function separationDerivativeAtJd(planetA, planetB, jd, halfStepDays) {
  const before = separationDegAtJd(planetA, planetB, jd - halfStepDays);
  const after = separationDegAtJd(planetA, planetB, jd + halfStepDays);
  return (after - before) / (2 * halfStepDays);
}

/**
 * Planet-planet appulses across [startUtc, endUtc]: one event per local
 * minimum of geocentric angular separation between planetA and planetB
 * (their closest approach in Earth's sky), regardless of how close —
 * same "report every crossing, let the number speak for itself" approach
 * analyzeInnerConjunction already uses, not an arbitrary "counts as an
 * appulse" threshold.
 */
export function analyzeAppulse({ planetA, planetB, startUtc, endUtc, intervalHours = 24, ephemerisSource = 'kepler' }) {
  validateAppulseTargets(planetA, planetB);
  const { startMs, endMs, stepMs } = validateRange(startUtc, endUtc, intervalHours);

  const timesJd = [];
  const separationDegValues = [];
  const separationDot = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const jd = julianDateFromDate(new Date(ms));
    timesJd.push(jd);
    separationDegValues.push(separationDegAtJd(planetA, planetB, jd));
    separationDot.push(separationDerivativeAtJd(planetA, planetB, jd, REFINE_HALF_STEP_DAYS));
  }
  if (timesJd.length < 3) {
    throw new Error('analyzeAppulse: date range too short to sample — need at least 3 points');
  }

  const evalFn = (jd) => separationDerivativeAtJd(planetA, planetB, jd, REFINE_HALF_STEP_DAYS);
  const extrema = findStationaryPoints(timesJd, separationDot, evalFn, {
    toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
    labelFor: (sign) => (sign < 0 ? 'minimum' : 'maximum'),
  });

  const events = extrema
    .filter((e) => e.transition === 'minimum')
    .sort((a, b) => a.epochJd - b.epochJd)
    .map((pt) => ({
      event: 'appulse',
      epochJd: pt.epochJd,
      epochUtc: dateFromJulianDate(pt.epochJd).toISOString(),
      separationDeg: separationDegAtJd(planetA, planetB, pt.epochJd),
      method: pt.method,
      toleranceSeconds: pt.toleranceSeconds,
    }));

  const midJsDate = new Date((startMs + endMs) / 2);
  const displaySource = getBodyState(planetB, midJsDate, PLANETS[planetB].elements, {
    forceSource: ephemerisSource === 'kepler' || ephemerisSource === 'cache' ? ephemerisSource : undefined,
  }).source;

  return {
    id: `${planetA}-${planetB}-appulse-${startUtc.slice(0, 4)}`,
    type: 'appulse',
    target: planetB, // resultTarget for app.js's line-of-sight overlay can only carry one body — see docs/accuracy.md
    observer: { type: 'geocenter', bodyId: 'earth' },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN', source: displaySource },
    input: { startUtc, endUtc, intervalHours, planetA, planetB },
    result: { events },
    solver: {
      method: 'bisection',
      toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
      status: events.length ? 'success' : 'no-events-in-range',
    },
    series: { timesJd, valueDeg: separationDegValues },
  };
}
