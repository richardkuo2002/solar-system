// Eclipse events (lunar + solar) — v1.1 Event Toolkit. Syzygy-finding
// reuses opposition.js's exact "extremum of elongationRad" trick (the
// Moon's elongation from the Sun oscillates 0deg<->180deg once per
// synodic month, same shape as an outer planet's conjunction<->
// opposition cycle) — zero new root-finding code. Shadow geometry is
// plain similar-triangles cone math on real physical radii (src/data/,
// never core/scale.js's display-compressed values). Pure math, zero DOM/
// THREE, Node-testable like core/. See docs/accuracy.md's "Eclipses
// (v1.1)" section for the exact scope of every simplification made here:
// spherical Sun/Earth/Moon, no atmospheric shadow enlargement, no
// Besselian elements, magnitude + one peak time only (not a 4/5-contact
// circumstance table). Solar eclipse timing IS refined per observer (see
// refineLocalSolarEclipseEpoch) — parallax shifts the apparent alignment
// enough, over the time span between geocentric syzygy and a given
// site's own greatest eclipse, to flip total/partial for a narrow path.

import { getBodyState, sunBodyState } from '../core/ephemeris.js';
import { julianDateFromDate, dateFromJulianDate, moonHeliocentricPositionAu } from '../core/orbital-elements.js';
import { PLANETS, SUN } from '../data/planets.js';
import { MOONS } from '../data/moons.js';
import { sub, length, normalize, dot } from '../core/vector3.js';
import { elongationRad } from './elongation.js';
import { findStationaryPoints } from './retrograde.js';
import { RAD_TO_DEG } from './longitude.js';
import { KM_PER_AU } from '../core/units.js';
import { observeAt } from './observer.js';

const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_TOLERANCE_SECONDS = 60;
const REFINE_HALF_STEP_DAYS = 0.05; // ~72 min — the Moon's elongation moves
  // ~12deg/day (synodic month ~29.5d), far faster than an outer planet's;
  // finer than opposition.js's 0.5d half-step, coarser than retrograde's
  // 0.01d (Mars's apparent motion near stationary points is faster still).

function clampUnit(v) {
  return Math.min(1, Math.max(-1, v));
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

function validateLatLon(latDeg, lonDeg) {
  if (!(latDeg >= -90 && latDeg <= 90)) throw new Error('latDeg must be in [-90, 90]');
  if (!(lonDeg >= -180 && lonDeg <= 180)) throw new Error('lonDeg must be in [-180, 180]');
}

// --- Syzygy (new/full moon) finding — mirrors opposition.js exactly ---

function moonElongationAtJd(jd) {
  const jsDate = dateFromJulianDate(jd);
  const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource: 'kepler' });
  const moonPositionAu = moonHeliocentricPositionAu(MOONS.moon, earthState.positionAu, jd);
  const sunState = sunBodyState(jsDate);
  return elongationRad({ positionAu: moonPositionAu }, earthState, sunState);
}

function moonElongationDerivativeAtJd(jd, halfStepDays) {
  const before = moonElongationAtJd(jd - halfStepDays);
  const after = moonElongationAtJd(jd + halfStepDays);
  return (after - before) / (2 * halfStepDays);
}

// + -> - (elongation was rising toward 180deg, now falling) = local max = full moon.
// - -> + (elongation was falling toward 0deg, now rising) = local min = new moon.
function syzygyLabelFor(sign) {
  return sign > 0 ? 'full-moon' : 'new-moon';
}

/** Full/new moon epochs across [startUtc, endUtc] — the moment closest to
 *  exact syzygy in this window, NOT the moment of minimum distance from
 *  the shadow axis (those differ by up to roughly an hour, since ecliptic
 *  latitude changes slowly compared to elongation right at syzygy — a
 *  documented simplification, see docs/accuracy.md). */
function findSyzygies(startUtc, endUtc, intervalHours) {
  const { startMs, endMs, stepMs } = validateRange(startUtc, endUtc, intervalHours);
  const timesJd = [];
  const elongationDot = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const jd = julianDateFromDate(new Date(ms));
    timesJd.push(jd);
    elongationDot.push(moonElongationDerivativeAtJd(jd, REFINE_HALF_STEP_DAYS));
  }
  if (timesJd.length < 3) {
    throw new Error('date range too short to sample — need at least 3 points');
  }
  const evalFn = (jd) => moonElongationDerivativeAtJd(jd, REFINE_HALF_STEP_DAYS);
  return findStationaryPoints(timesJd, elongationDot, evalFn, {
    toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
    labelFor: syzygyLabelFor,
  }).sort((a, b) => a.epochJd - b.epochJd);
}

// --- Lunar eclipse: Earth-shadow-cone geometry ---

/** Earth's umbra/penumbra cone radii (km) at a given distance from Earth's
 *  center, via similar triangles on real Sun/Earth radii and the actual
 *  Sun-Earth distance at that epoch. Pure vacuum cone geometry — no
 *  empirical atmospheric-enlargement factor (real eclipse calendars apply
 *  one, typically ~1%; omitted here, see docs/accuracy.md). */
function earthShadowRadiiKm(distanceFromEarthKm, sunEarthDistKm) {
  const penumbraHalfAngle = Math.atan((SUN.radiusKm + PLANETS.earth.radiusKm) / sunEarthDistKm);
  const umbraHalfAngle = Math.atan((SUN.radiusKm - PLANETS.earth.radiusKm) / sunEarthDistKm);
  return {
    penumbraRadiusKm: PLANETS.earth.radiusKm + distanceFromEarthKm * Math.tan(penumbraHalfAngle),
    umbraRadiusKm: PLANETS.earth.radiusKm - distanceFromEarthKm * Math.tan(umbraHalfAngle),
  };
}

function lunarEclipseAt(epochJd) {
  const jsDate = dateFromJulianDate(epochJd);
  const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource: 'kepler' });
  const moonPositionAu = moonHeliocentricPositionAu(MOONS.moon, earthState.positionAu, epochJd);

  const moonGeocentricAu = sub(moonPositionAu, earthState.positionAu);
  const moonDistanceKm = length(moonGeocentricAu) * KM_PER_AU;
  const sunEarthDistKm = length(earthState.positionAu) * KM_PER_AU;

  // Sun is at the heliocentric origin, so the direction from Earth to the
  // Sun is -earthState.positionAu; the antisolar direction (where Earth's
  // shadow points) is the opposite of that, i.e. +earthState.positionAu.
  const antisolarUnit = normalize(earthState.positionAu);
  const moonDirectionUnit = normalize(moonGeocentricAu);
  const angularSeparationRad = Math.acos(clampUnit(dot(moonDirectionUnit, antisolarUnit)));
  const offsetKm = moonDistanceKm * Math.sin(angularSeparationRad);

  const { umbraRadiusKm, penumbraRadiusKm } = earthShadowRadiiKm(moonDistanceKm, sunEarthDistKm);
  const moonRadiusKm = MOONS.moon.radiusKm;

  let classification;
  let magnitude;
  if (offsetKm + moonRadiusKm <= umbraRadiusKm) {
    classification = 'total';
    magnitude = (umbraRadiusKm + moonRadiusKm - offsetKm) / (2 * moonRadiusKm);
  } else if (offsetKm - moonRadiusKm <= umbraRadiusKm) {
    classification = 'partial';
    magnitude = (umbraRadiusKm + moonRadiusKm - offsetKm) / (2 * moonRadiusKm);
  } else if (offsetKm - moonRadiusKm <= penumbraRadiusKm) {
    classification = 'penumbral';
    magnitude = (penumbraRadiusKm + moonRadiusKm - offsetKm) / (2 * moonRadiusKm);
  } else {
    classification = 'none';
    magnitude = 0;
  }

  return { classification, magnitude: Math.max(0, magnitude), offsetKm, umbraRadiusKm, penumbraRadiusKm };
}

/**
 * Lunar eclipses across [startUtc, endUtc]: one event per full moon in
 * range, classified none/penumbral/partial/total from the Moon's actual
 * offset from Earth's shadow axis vs. the umbra/penumbra radii at the
 * Moon's distance that epoch. Reports magnitude + the syzygy epoch only —
 * not the four/five real-world contact times (P1/U1/U2/greatest/U3/U4/P4)
 * a full eclipse calendar shows (see docs/accuracy.md).
 */
export function analyzeLunarEclipse({ startUtc, endUtc, intervalHours = 6, ephemerisSource = 'kepler' }) {
  const syzygies = findSyzygies(startUtc, endUtc, intervalHours).filter((s) => s.transition === 'full-moon');

  const events = syzygies.map((s) => {
    const { classification, magnitude } = lunarEclipseAt(s.epochJd);
    return {
      event: 'lunar-eclipse',
      epochJd: s.epochJd,
      epochUtc: dateFromJulianDate(s.epochJd).toISOString(),
      classification,
      magnitude,
      method: s.method,
      toleranceSeconds: s.toleranceSeconds,
    };
  }).filter((e) => e.classification !== 'none');

  const midJsDate = new Date((new Date(startUtc).getTime() + new Date(endUtc).getTime()) / 2);
  const displaySource = getBodyState('earth', midJsDate, PLANETS.earth.elements, {
    forceSource: ephemerisSource === 'kepler' || ephemerisSource === 'cache' ? ephemerisSource : undefined,
  }).source;

  return {
    id: `lunar-eclipse-${startUtc.slice(0, 4)}`,
    type: 'lunar-eclipse',
    target: 'moon',
    observer: { type: 'geocenter', bodyId: 'earth' },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN', source: displaySource },
    input: { startUtc, endUtc, intervalHours },
    result: { events },
    solver: {
      method: 'bisection',
      toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
      status: events.length ? 'success' : 'no-events-in-range',
    },
    series: {
      timesJd: syzygies.map((s) => s.epochJd),
      valueDeg: syzygies.map((s) => lunarEclipseAt(s.epochJd).magnitude * 100),
    },
  };
}

// --- Solar eclipse: apparent-disk geometry for a specific observer ---

// Exported for reuse by analysis/occultation.js (v1.4) — a pure spherical-
// law-of-cosines primitive worth sharing verbatim, unlike the position-
// lookup snippets this codebase otherwise duplicates per-file on purpose.
export function angularSeparationDeg(ra1Deg, dec1Deg, ra2Deg, dec2Deg) {
  const ra1 = ra1Deg * DEG_TO_RAD, dec1 = dec1Deg * DEG_TO_RAD;
  const ra2 = ra2Deg * DEG_TO_RAD, dec2 = dec2Deg * DEG_TO_RAD;
  const cosSep = Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return Math.acos(clampUnit(cosSep)) * RAD_TO_DEG;
}

function topocentricSeparationDeg(jd, latDeg, lonDeg, elevationM) {
  const jsDate = dateFromJulianDate(jd);
  const sunObs = observeAt({ target: 'sun', jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
  const moonObs = observeAt({ target: 'moon', jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
  return angularSeparationDeg(sunObs.raDeg, sunObs.decDeg, moonObs.raDeg, moonObs.decDeg);
}

function separationDerivativeAtJd(jd, latDeg, lonDeg, elevationM, halfStepDays) {
  const before = topocentricSeparationDeg(jd - halfStepDays, latDeg, lonDeg, elevationM);
  const after = topocentricSeparationDeg(jd + halfStepDays, latDeg, lonDeg, elevationM);
  return (after - before) / (2 * halfStepDays);
}

const LOCAL_REFINE_WINDOW_HOURS = 3;   // lunar parallax (~1deg) shifts the
  // apparent Sun-Moon alignment enough, over an hour of Earth rotation,
  // to matter for a narrow eclipse path — this window comfortably spans
  // that shift either side of the geocentric new-moon instant.
const LOCAL_REFINE_STEP_HOURS = 0.25;
const LOCAL_REFINE_HALF_STEP_DAYS = 1 / 1440; // 1 minute

/**
 * Refines the geocentric new-moon instant to THIS observer's own moment of
 * least Sun-Moon apparent separation (their local "greatest eclipse" time)
 * by finding the nearby minimum of topocentric separation — one more
 * application of findStationaryPoints' generic extremum-finding, not new
 * root-finding code. Falls back to the geocentric instant if this observer
 * sees no local minimum in the window (e.g. clearly not on the path).
 */
function refineLocalSolarEclipseEpoch(geocentricJd, latDeg, lonDeg, elevationM) {
  const windowDays = LOCAL_REFINE_WINDOW_HOURS / 24;
  const stepDays = LOCAL_REFINE_STEP_HOURS / 24;
  const timesJd = [];
  const derivs = [];
  for (let jd = geocentricJd - windowDays; jd <= geocentricJd + windowDays; jd += stepDays) {
    timesJd.push(jd);
    derivs.push(separationDerivativeAtJd(jd, latDeg, lonDeg, elevationM, LOCAL_REFINE_HALF_STEP_DAYS));
  }
  const evalFn = (jd) => separationDerivativeAtJd(jd, latDeg, lonDeg, elevationM, LOCAL_REFINE_HALF_STEP_DAYS);
  const extrema = findStationaryPoints(timesJd, derivs, evalFn, {
    toleranceSeconds: DEFAULT_TOLERANCE_SECONDS,
    labelFor: (sign) => (sign < 0 ? 'minimum' : 'maximum'),
  });
  const minimum = extrema.find((e) => e.transition === 'minimum');
  return minimum ? minimum.epochJd : geocentricJd;
}

/**
 * Solar eclipse circumstances for one observer at `epochJd` (already
 * refined to this observer's own local greatest-eclipse instant, see
 * refineLocalSolarEclipseEpoch) — topocentric Sun/Moon positions (reusing
 * analysis/observer.js's observeAt, parallax-corrected) and their apparent
 * angular radii determine none/partial/annular/total. Still spherical
 * Earth/Sun/Moon, no atmospheric refraction (same caveats Observer Mode
 * already documents) — see docs/accuracy.md.
 */
function solarEclipseAt(epochJd, latDeg, lonDeg, elevationM) {
  const jsDate = dateFromJulianDate(epochJd);
  const sunObs = observeAt({ target: 'sun', jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });
  const moonObs = observeAt({ target: 'moon', jsDate, latDeg, lonDeg, elevationM, forceSource: 'kepler' });

  const sunDistanceKm = sunObs.distanceAu * KM_PER_AU;
  const moonDistanceKm = moonObs.distanceAu * KM_PER_AU;
  const sunAngularRadiusDeg = Math.asin(SUN.radiusKm / sunDistanceKm) * RAD_TO_DEG;
  const moonAngularRadiusDeg = Math.asin(MOONS.moon.radiusKm / moonDistanceKm) * RAD_TO_DEG;
  const separationDeg = angularSeparationDeg(sunObs.raDeg, sunObs.decDeg, moonObs.raDeg, moonObs.decDeg);

  const sumRadiiDeg = sunAngularRadiusDeg + moonAngularRadiusDeg;
  const diffRadiiDeg = Math.abs(moonAngularRadiusDeg - sunAngularRadiusDeg);

  let classification;
  if (!sunObs.aboveHorizon) {
    classification = 'none'; // Sun below the horizon — nothing observable here regardless of geometry
  } else if (separationDeg >= sumRadiiDeg) {
    classification = 'none';
  } else if (separationDeg <= diffRadiiDeg) {
    classification = moonAngularRadiusDeg >= sunAngularRadiusDeg ? 'total' : 'annular';
  } else {
    classification = 'partial';
  }

  // Fraction of the Sun's diameter covered — 0 at first/last contact,
  // >=1 once the Moon's disk fully covers (total) or is fully inside
  // (annular) the Sun's disk.
  const magnitude = classification === 'none'
    ? 0
    : Math.max(0, (sumRadiiDeg - separationDeg) / (2 * sunAngularRadiusDeg));

  return { classification, magnitude, altDeg: sunObs.altDeg };
}

/**
 * Solar eclipses across [startUtc, endUtc] as seen from one observer
 * (latDeg/lonDeg/elevationM): one event per new moon in range where this
 * location sees at least a partial eclipse (Sun above the horizon and
 * disks overlapping). Most new moons produce no result here — that's
 * correct: a solar eclipse's visibility path only ever covers a narrow
 * strip of Earth.
 */
export function analyzeSolarEclipse({
  startUtc, endUtc, latDeg, lonDeg, elevationM = 0, intervalHours = 6, ephemerisSource = 'kepler',
}) {
  validateLatLon(latDeg, lonDeg);
  const syzygies = findSyzygies(startUtc, endUtc, intervalHours).filter((s) => s.transition === 'new-moon');

  const refined = syzygies.map((s) => ({
    ...s,
    epochJd: refineLocalSolarEclipseEpoch(s.epochJd, latDeg, lonDeg, elevationM),
  }));

  const events = refined.map((s) => {
    const { classification, magnitude } = solarEclipseAt(s.epochJd, latDeg, lonDeg, elevationM);
    return {
      event: 'solar-eclipse',
      epochJd: s.epochJd,
      epochUtc: dateFromJulianDate(s.epochJd).toISOString(),
      classification,
      magnitude,
      method: s.method,
      toleranceSeconds: s.toleranceSeconds,
    };
  }).filter((e) => e.classification !== 'none');

  const midJsDate = new Date((new Date(startUtc).getTime() + new Date(endUtc).getTime()) / 2);
  const displaySource = getBodyState('earth', midJsDate, PLANETS.earth.elements, {
    forceSource: ephemerisSource === 'kepler' || ephemerisSource === 'cache' ? ephemerisSource : undefined,
  }).source;

  return {
    id: `solar-eclipse-${startUtc.slice(0, 4)}`,
    type: 'solar-eclipse',
    target: 'moon',
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
      timesJd: refined.map((s) => s.epochJd),
      valueDeg: refined.map((s) => solarEclipseAt(s.epochJd, latDeg, lonDeg, elevationM).magnitude * 100),
    },
  };
}
