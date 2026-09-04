// Observer Mode analysis — v0.6. Topocentric RA/Dec, Alt/Az, above/below-
// horizon, and rise/transit/set for a user-specified lat/lon/elevation and
// a UTC instant. Imitates analysis/phase.js's single-epoch structure fused
// with analysis/opposition.js's dense-scan structure: rise/set/transit
// need ZERO new root-finding code — findStationaryPoints (already generic,
// see analysis/retrograde.js) is fed raw altitude values for rise/set
// zero-crossings and altitude's derivative for transit, the same
// "feed a different series into the same solver" trick v0.5 used four
// times over. Pure math, zero DOM/THREE, Node-testable like core/. See
// docs/accuracy.md's "Observer Mode (v0.6)" section for the exact scope
// of every approximation made here.

import { sub, length } from '../core/vector3.js';
import { getBodyState, sunBodyState } from '../core/ephemeris.js';
import { julianDateFromDate, dateFromJulianDate, moonHeliocentricPositionAu } from '../core/orbital-elements.js';
import { createBodyState } from '../core/body-state.js';
import { PLANETS } from '../data/planets.js';
import { MOONS } from '../data/moons.js';
import { findStationaryPoints } from './retrograde.js';
import {
  lstDeg, eclipticToEquatorial, raDecFromEquatorial,
  observerGeocentricPositionAu, hourAngleDeg, altAzFromDecHa,
} from '../core/topocentric.js';

export const OBSERVER_TARGETS = [
  'sun', 'moon', 'mercury', 'venus', 'mars',
  'jupiter', 'saturn', 'uranus', 'neptune',
]; // Earth excluded (it's the observer); dwarf planets/comets excluded,
   // same precedent as analysis/phase.js's PHASE_TARGETS.

const RISE_SET_TOLERANCE_SECONDS = 60;
const COARSE_SAMPLE_INTERVAL_MIN = 10;         // 145 samples / UTC day
const TRANSIT_DERIV_HALF_STEP_DAYS = 1 / 1440; // 1 minute

function validateTarget(target) {
  if (!OBSERVER_TARGETS.includes(target)) {
    throw new Error(`target must be one of ${OBSERVER_TARGETS.join(', ')}`);
  }
}

function validateLatLon(latDeg, lonDeg) {
  if (!(latDeg >= -90 && latDeg <= 90)) throw new Error('latDeg must be in [-90, 90]');
  if (!(lonDeg >= -180 && lonDeg <= 180)) throw new Error('lonDeg must be in [-180, 180]');
}

// The Moon has no elements/Horizons entry (see docs/accuracy.md) — its
// body-state is synthesized via moonHeliocentricPositionAu, same pattern
// analysis/phase.js's targetStateFor already established. Duplicated here
// rather than extracted into a shared helper, matching this codebase's
// existing precedent (forceSourceFor-style small per-file duplication).
function targetHeliocentricStateFor(targetKey, jsDate, forceSource) {
  if (targetKey === 'moon') {
    const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource: 'kepler' });
    const currentJD = julianDateFromDate(jsDate);
    const positionAu = moonHeliocentricPositionAu(MOONS.moon, earthState.positionAu, currentJD);
    return createBodyState({
      bodyId: 'moon', epochJd: currentJD, epochUtc: jsDate.toISOString(),
      source: 'kepler', sourceDetail: 'circular-orbit approximation, no inclination/eccentricity — see docs/accuracy.md',
      quality: 'approximate', positionAu, velocityAuPerDay: { x: 0, y: 0, z: 0 },
      validity: { startUtc: null, endUtc: null, note: 'Approximate — see docs/accuracy.md' },
    });
  }
  return getBodyState(targetKey, jsDate, PLANETS[targetKey].elements, { forceSource });
}

/** Geocentric-equatorial position (AU) of `target` as seen from Earth's
 *  center, before topocentric correction. */
function geocentricEquatorialAu(target, jsDate, forceSource) {
  const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource });
  const targetState = target === 'sun' ? sunBodyState(jsDate) : targetHeliocentricStateFor(target, jsDate, forceSource);
  return eclipticToEquatorial(sub(targetState.positionAu, earthState.positionAu));
}

/**
 * Single-instant observation: RA/Dec, Alt/Az, above/below horizon,
 * topocentric distance. The topocentric correction itself is exactly the
 * roadmap's "start from geocentric position, then subtract the observer's
 * position relative to Earth's center" — `sub(geoEqAu, observerAu)` below.
 */
export function observeAt({ target, jsDate, latDeg, lonDeg, elevationM = 0, forceSource = 'kepler' }) {
  const jd = julianDateFromDate(jsDate);
  const geoEqAu = geocentricEquatorialAu(target, jsDate, forceSource);
  const lst = lstDeg(jd, lonDeg);
  const observerAu = observerGeocentricPositionAu({ latDeg, elevationM }, lst);
  const topoAu = sub(geoEqAu, observerAu);
  const { raDeg, decDeg } = raDecFromEquatorial(topoAu);
  const haDeg = hourAngleDeg(lst, raDeg);
  const { altDeg, azDeg } = altAzFromDecHa({ decDeg, latDeg, haDeg });
  return { jd, raDeg, decDeg, altDeg, azDeg, aboveHorizon: altDeg > 0, distanceAu: length(topoAu) };
}

function altDegAtJd(jd, target, latDeg, lonDeg, elevationM, forceSource) {
  return observeAt({ target, jsDate: dateFromJulianDate(jd), latDeg, lonDeg, elevationM, forceSource }).altDeg;
}

function altDerivativeAtJd(jd, target, latDeg, lonDeg, elevationM, forceSource) {
  const before = altDegAtJd(jd - TRANSIT_DERIV_HALF_STEP_DAYS, target, latDeg, lonDeg, elevationM, forceSource);
  const after = altDegAtJd(jd + TRANSIT_DERIV_HALF_STEP_DAYS, target, latDeg, lonDeg, elevationM, forceSource);
  return (after - before) / (2 * TRANSIT_DERIV_HALF_STEP_DAYS);
}

// raw altDeg zero-crossing: sign<0 (was below, now above) = rise; sign>0 (was above, now below) = set.
const riseSetLabelFor = (sign) => (sign < 0 ? 'rise' : 'set');
// altDeg-derivative sign flip: +-> - (local max) = transit (upper culmination); -> + (local min) = lower transit.
const transitLabelFor = (sign) => (sign > 0 ? 'transit' : 'lower-transit');

/**
 * Full Observer Mode analysis: instantaneous RA/Dec/Alt/Az at `atUtc`,
 * plus a dense altitude-curve scan and rise/transit/set solve across the
 * UTC CALENDAR DAY containing `atUtc` (00:00Z-24:00Z of that date, not a
 * window centered on atUtc). Dense-scan-forces-Kepler guardrail, matching
 * every v0.4/v0.5 analysis file: hundreds of body-state lookups always use
 * 'kepler' internally, never triggering a background Horizons fetch per
 * sample.
 *
 * Result shape matches v0.5's nested convention (id/type/target/observer/
 * reference/input/result/solver/series) and is already JSON-export-
 * compatible with analysis/export.js's assertReproducible — export
 * buttons are deliberately not wired in this version (not in v0.6's
 * acceptance criteria; CSV would need new columns export.js doesn't have
 * yet), but the shape stays a small follow-up, not a redesign, if that
 * changes later.
 */
export function analyzeObserver({ target, atUtc, latDeg, lonDeg, elevationM = 0 }) {
  validateTarget(target);
  validateLatLon(latDeg, lonDeg);
  const forceSource = 'kepler';
  const atJsDate = new Date(atUtc);
  if (Number.isNaN(atJsDate.getTime())) {
    throw new Error(`invalid atUtc: ${atUtc}`);
  }

  const now = observeAt({ target, jsDate: atJsDate, latDeg, lonDeg, elevationM, forceSource });

  const dayStartMs = Date.UTC(atJsDate.getUTCFullYear(), atJsDate.getUTCMonth(), atJsDate.getUTCDate());
  const stepMs = COARSE_SAMPLE_INTERVAL_MIN * 60 * 1000;
  const timesJd = [];
  const altDegValues = [];
  const altDerivValues = [];
  for (let ms = dayStartMs; ms <= dayStartMs + 24 * 3600 * 1000; ms += stepMs) {
    const jd = julianDateFromDate(new Date(ms));
    timesJd.push(jd);
    altDegValues.push(altDegAtJd(jd, target, latDeg, lonDeg, elevationM, forceSource));
    altDerivValues.push(altDerivativeAtJd(jd, target, latDeg, lonDeg, elevationM, forceSource));
  }

  const evalAltFn = (jd) => altDegAtJd(jd, target, latDeg, lonDeg, elevationM, forceSource);
  const evalDerivFn = (jd) => altDerivativeAtJd(jd, target, latDeg, lonDeg, elevationM, forceSource);

  const riseSetPts = findStationaryPoints(timesJd, altDegValues, evalAltFn, { toleranceSeconds: RISE_SET_TOLERANCE_SECONDS, labelFor: riseSetLabelFor });
  const transitPts = findStationaryPoints(timesJd, altDerivValues, evalDerivFn, { toleranceSeconds: RISE_SET_TOLERANCE_SECONDS, labelFor: transitLabelFor });

  const events = [...riseSetPts, ...transitPts]
    .sort((a, b) => a.epochJd - b.epochJd)
    .map((pt) => {
      const o = observeAt({ target, jsDate: dateFromJulianDate(pt.epochJd), latDeg, lonDeg, elevationM, forceSource });
      return { event: pt.transition, epochJd: pt.epochJd, epochUtc: dateFromJulianDate(pt.epochJd).toISOString(), altDeg: o.altDeg, azDeg: o.azDeg };
    });

  let note = null;
  const hasRiseSet = events.some((e) => e.event === 'rise' || e.event === 'set');
  if (!hasRiseSet) {
    note = altDegValues.every((a) => a > 0)
      ? "Circumpolar for this day/latitude — target does not set (based on this UTC day's scan)."
      : "Target does not rise above the horizon on this UTC day at this latitude (based on this day's scan).";
  }

  return {
    id: `observer-${target}-${atUtc.slice(0, 10)}`,
    type: 'observer',
    target,
    observer: { type: 'topocentric', bodyId: 'earth', latDeg, lonDeg, elevationM },
    reference: { frame: 'TOPOCENTRIC_EQUATORIAL_FIXED_OBLIQUITY', center: 'OBSERVER', source: 'kepler' },
    input: { atUtc, latDeg, lonDeg, elevationM },
    result: {
      raDeg: now.raDeg, decDeg: now.decDeg, altDeg: now.altDeg, azDeg: now.azDeg,
      aboveHorizon: now.aboveHorizon, distanceAu: now.distanceAu,
      events, // [{event:'rise'|'set'|'transit'|'lower-transit', epochJd, epochUtc, altDeg, azDeg}, ...] chronological
      note,   // string | null — circumpolar / never-rises explanation
    },
    solver: { method: 'bisection', toleranceSeconds: RISE_SET_TOLERANCE_SECONDS, status: events.length ? 'success' : 'no-crossings-in-day' },
    series: { timesJd, altDeg: altDegValues },
  };
}
