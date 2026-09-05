// Time propagation of Standish-1992-style osculating elements (value + rate
// per Julian century) into the {a,e,i,om,w,meanAnomalyRad} shape kepler.js
// expects. Pure math, Node-testable.

import { normalizeAngle, elementsToPosition } from './kepler.js';
import { compressMoonOrbit, compressSize, SATURN_RING_OUTER_KM } from './scale.js';
import { AU_PER_KM } from './units.js';
import { moonEclipticPosition } from './lunar-theory.js';

const VELOCITY_HALF_DT_DAYS = 1 / 48; // ±30 min — small vs. the fastest
  // period in this dataset (Mercury, ~88d), large enough that float
  // subtraction noise in elementsToPosition doesn't dominate.

export const J2000_JD = 2451545.0;
const MS_PER_DAY = 86400000;
const DEG_TO_RAD = Math.PI / 180;

/** Julian Date for a JS Date. */
export function julianDateFromDate(jsDate) {
  return jsDate.getTime() / MS_PER_DAY + 2440587.5;
}

/** Inverse of julianDateFromDate — JS Date (UTC) for a Julian Date. */
export function dateFromJulianDate(julianDate) {
  return new Date((julianDate - 2440587.5) * MS_PER_DAY);
}

function at(pair, T) {
  const [value, ratePerCentury] = pair;
  return value + ratePerCentury * T;
}

/**
 * Propagate one planet's base elements (each an [value, rate/century] pair,
 * angles in degrees per the Standish table convention) to the given Julian
 * Date, returning the {a, e, i, om, w, meanAnomalyRad} shape kepler.js's
 * elementsToPosition expects (angles in radians).
 */
export function elementsAtDate(baseElements, julianDate) {
  const T = (julianDate - J2000_JD) / 36525;
  const { a, e, i, L, wBar, om } = baseElements;

  const aAtT = at(a, T);
  const eAtT = at(e, T);
  const iDeg = at(i, T);
  const LDeg = at(L, T);
  const wBarDeg = at(wBar, T);
  const omDeg = at(om, T);

  const wDeg = wBarDeg - omDeg;
  const meanAnomalyDeg = LDeg - wBarDeg;

  return {
    a: aAtT,
    e: eAtT,
    i: iDeg * DEG_TO_RAD,
    om: omDeg * DEG_TO_RAD,
    w: wDeg * DEG_TO_RAD,
    meanAnomalyRad: normalizeAngle(meanAnomalyDeg * DEG_TO_RAD),
  };
}

/**
 * Central-difference AU/day velocity at `julianDate`, from the same
 * elements/propagation already used for position — no separate model, no
 * new numerics dependency.
 */
export function elementsVelocity(baseElements, julianDate) {
  const before = elementsToPosition(elementsAtDate(baseElements, julianDate - VELOCITY_HALF_DT_DAYS));
  const after = elementsToPosition(elementsAtDate(baseElements, julianDate + VELOCITY_HALF_DT_DAYS));
  const dtDays = 2 * VELOCITY_HALF_DT_DAYS;
  return {
    x: (after.x - before.x) / dtDays,
    y: (after.y - before.y) / dtDays,
    z: (after.z - before.z) / dtDays,
  };
}

/**
 * AU points around one static, closed orbit-line loop at `julianDate`'s
 * osculating elements — sampled at `segments` evenly spaced mean
 * anomalies. Lives in core/ (not render/bodies.js, which used to import
 * elementsAtDate/elementsToPosition directly to do this itself) so
 * render/ never touches raw orbital elements — this is a shape sample,
 * not a per-frame moving-body lookup, so it deliberately returns bare
 * {x,y,z} AU points, not full body-state objects.
 */
export function sampleOrbitPath(baseElements, julianDate, segments = 256) {
  const els = elementsAtDate(baseElements, julianDate);
  const points = [];
  for (let s = 0; s <= segments; s++) {
    const meanAnomalyRad = (s / segments) * 2 * Math.PI;
    points.push(elementsToPosition({ ...els, meanAnomalyRad }));
  }
  return points;
}

/**
 * Angle (radians, [0, 2*PI)) for a simple circular orbit given how many
 * days have elapsed since an arbitrary epoch and the orbital period —
 * used for v1 moons (data/moons.js), which use a near-circular
 * approximation rather than full Standish-table elements.
 */
export function circularOrbitAngle(daysSinceEpoch, periodDays) {
  return normalizeAngle((daysSinceEpoch / periodDays) * 2 * Math.PI);
}

/**
 * Kepler's third law, T(years) = a(AU)^1.5 — the same approximation
 * data/comets.js already uses to derive Halley's orbital period without a
 * separately-published number (see that file's header comment). Used by
 * the v0.7 Planet Info Panel (src/render/body-info-panel.js) for
 * planets/comets/dwarf planets, whose data only stores orbital *elements*,
 * never a period directly. Ignores elements.a's tiny rate-per-century
 * drift (J2000 value only) — a rough "how long is a year here" figure, not
 * ephemeris-grade timing (that's what the full Kepler propagation
 * elsewhere in this app is for).
 */
export function orbitalPeriodDaysFromSemiMajorAxisAu(aAu) {
  return Math.pow(aAu, 1.5) * 365.25;
}

// Titan's real orbit (~1.2M km) is well outside Saturn's real rings
// (~137,000 km) — but compressMoonOrbit and compressSize are independently
// tuned curves that don't preserve that ordering at Saturn's scale (Titan's
// compressed orbit would otherwise land inside the ring band). A 5% margin
// past the ring's own compressed outer edge keeps Titan visibly clear.
const SATURN_RING_CLEARANCE_MARGIN = 1.05;

/**
 * Local-space (parent-relative) scene position for a moon at `currentJD`,
 * using the circular-orbit approximation above + scale.js's
 * compressMoonOrbit. Pure — safe to keep in core/ (no THREE import) so
 * render/bodies.js just calls this instead of duplicating the math in a
 * THREE-importing file where it couldn't be Node-tested.
 */
export function moonLocalPosition(moonData, parentRadiusKm, parentSceneRadius, currentJD, epochJD) {
  const angle = circularOrbitAngle(currentJD - epochJD, moonData.periodDays);
  const minSceneRadius = moonData.parent === 'saturn'
    ? compressSize(SATURN_RING_OUTER_KM) * SATURN_RING_CLEARANCE_MARGIN
    : 0;
  const r = compressMoonOrbit(moonData.orbitKm, parentRadiusKm, parentSceneRadius, minSceneRadius);
  return { x: r * Math.cos(angle), y: 0, z: r * Math.sin(angle) };
}

/**
 * Heliocentric AU position of the Moon: Meeus Ch.47 lunar theory
 * (moonEclipticPosition, ~10 arcsec longitude / ~4 arcsec latitude
 * precision) geocentric ecliptic lon/lat/distance, converted to ecliptic
 * rectangular and added onto the parent's (Earth's) real heliocentric AU
 * position. Real inclination/eccentricity/phase — unlike the old
 * constant-angular-rate circular-orbit approximation this replaced (see
 * git history / docs/accuracy.md), this one is calibrated to the actual
 * Moon and safe to use for phase, eclipse, and Observer Mode geometry.
 *
 * `moonData` is unused (kept for signature compatibility with call sites
 * and any other moon this might someday be asked to route through it —
 * currently only ever called for `MOONS.moon`).
 *
 * moonEclipticPosition's lonDeg is referred to the MEAN EQUINOX OF DATE
 * (that's what Meeus's lunar theory — and the published worked example
 * this codebase tests it against — actually computes), not J2000. Every
 * other body-state in this app (Standish elements via kepler.js) IS fixed
 * to the J2000 equinox (FRAME_ECLIPJ2000). Left uncorrected, this is a
 * real, growing error (general precession ~50.29"/year — already ~0.34deg
 * by 2024), not a rounding nicety: it was large enough to flip a real
 * total solar eclipse to "partial" in this codebase's own eclipse
 * reference-case test before this fix. GENERAL_PRECESSION_DEG_PER_CENTURY
 * below removes it, rotating the Moon's longitude back onto the same
 * fixed J2000 equinox everything else uses.
 */
const GENERAL_PRECESSION_DEG_PER_CENTURY = 5029.0966 / 3600; // IAU precession in longitude, linear term
const GENERAL_PRECESSION_DEG_PER_CENTURY_SQ = 1.11113 / 3600; // quadratic term (negligible over this app's date ranges, kept for completeness)

export function moonHeliocentricPositionAu(moonData, parentPositionAu, currentJD) {
  const { lonDeg: lonOfDateDeg, latDeg, distanceKm } = moonEclipticPosition(currentJD);
  const T = (currentJD - J2000_JD) / 36525;
  const precessionDeg = GENERAL_PRECESSION_DEG_PER_CENTURY * T + GENERAL_PRECESSION_DEG_PER_CENTURY_SQ * T * T;
  const lonRad = (lonOfDateDeg - precessionDeg) * DEG_TO_RAD;
  const latRad = latDeg * DEG_TO_RAD;
  const distanceAu = distanceKm * AU_PER_KM;
  const cosLat = Math.cos(latRad);
  return {
    x: parentPositionAu.x + distanceAu * cosLat * Math.cos(lonRad),
    y: parentPositionAu.y + distanceAu * cosLat * Math.sin(lonRad),
    z: parentPositionAu.z + distanceAu * Math.sin(latRad),
  };
}
