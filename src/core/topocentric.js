// Topocentric-geometry primitives for v0.6 Observer Mode: sidereal time,
// ecliptic-to-equatorial rotation, RA/Dec extraction, an observer's
// geocentric position from lat/lon/elevation, hour angle, and Alt/Az.
// Pure math, zero DOM/THREE, Node-testable like core/. Mirrors
// analysis/longitude.js's scope (one file, one physical-geometry concern,
// its own local DEG_TO_RAD/RAD_TO_DEG rather than a core/units.js
// addition — that file is reserved for physical unit constants like
// KM_PER_AU, not angle conversions). See docs/accuracy.md's "Observer Mode
// (v0.6)" section for the exact scope of every approximation made here.

import { PLANETS } from '../data/planets.js';
import { AU_PER_KM } from './units.js';
import { J2000_JD } from './orbital-elements.js';

const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

// Fixed J2000 obliquity for the shared ecliptic<->equatorial rotations —
// deliberately NOT date-dependent (the star catalog renders fixed-J2000
// coordinates through the same rotation; see docs/accuracy.md). Precession
// (v1.5, precessEquatorialToDate) and nutation (v1.6, nutation/
// nutateEquatorialToTrue/eqEquinoxDeg) are applied separately at Observer
// Mode's output only.
export const OBLIQUITY_DEG = PLANETS.earth.axialTiltDeg;

function clampUnit(v) {
  return Math.min(1, Math.max(-1, v));
}
function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

/** Greenwich Mean Sidereal Time, IAU-1982-style low-precision polynomial
 *  (adequate to sub-arcminute for civil dates, not observatory-grade —
 *  see docs/accuracy.md). Degrees, [0, 360). */
export function gmstDeg(jd) {
  const T = (jd - J2000_JD) / 36525;
  const deg = 280.46061837 + 360.98564736629 * (jd - J2000_JD)
    + 0.000387933 * T * T - (T * T * T) / 38710000;
  return wrap360(deg);
}

/** Local Sidereal Time = GMST + observer longitude (east-positive). Degrees, [0, 360). */
export function lstDeg(jd, lonDeg) {
  return wrap360(gmstDeg(jd) + lonDeg);
}

/**
 * Rotates an ECLIPJ2000 xyz vector to geocentric-equatorial xyz by the
 * FIXED obliquity above (rotation about the x-axis — the equinox
 * direction is invariant under this rotation). Direction-only; works for
 * any consistent unit (AU here).
 */
export function eclipticToEquatorial(v) {
  const eps = OBLIQUITY_DEG * DEG_TO_RAD;
  const cosE = Math.cos(eps);
  const sinE = Math.sin(eps);
  return { x: v.x, y: v.y * cosE - v.z * sinE, z: v.y * sinE + v.z * cosE };
}

/** RA (degrees, [0,360)) / Dec (degrees, [-90,90]) of an equatorial-frame vector. */
export function raDecFromEquatorial(v) {
  const r = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const raDeg = wrap360(Math.atan2(v.y, v.x) * RAD_TO_DEG);
  const decDeg = Math.asin(clampUnit(v.z / r)) * RAD_TO_DEG;
  return { raDeg, decDeg };
}

/** Unit vector (equatorial frame) from RA/Dec, degrees — inverse of raDecFromEquatorial. */
export function unitVectorFromRaDec(raDeg, decDeg) {
  const ra = raDeg * DEG_TO_RAD;
  const dec = decDeg * DEG_TO_RAD;
  return { x: Math.cos(dec) * Math.cos(ra), y: Math.cos(dec) * Math.sin(ra), z: Math.sin(dec) };
}

/**
 * Rotates a geocentric-equatorial xyz vector to ECLIPJ2000 xyz by the fixed
 * obliquity above — the inverse rotation of eclipticToEquatorial (rotation
 * about the x-axis is orthogonal, so the inverse is the transpose: negate
 * the sinE terms). Used for v1.2's star catalog, whose RA/Dec is
 * equatorial, to align with the rest of this project's ecliptic frame.
 */
export function equatorialToEcliptic(v) {
  const eps = OBLIQUITY_DEG * DEG_TO_RAD;
  const cosE = Math.cos(eps);
  const sinE = Math.sin(eps);
  return { x: v.x, y: v.y * cosE + v.z * sinE, z: -v.y * sinE + v.z * cosE };
}

/**
 * Observer's geocentric position vector, equatorial frame, AU. Spherical
 * Earth (real radiusKm + elevationM) — NO oblateness, geodetic vs.
 * geocentric latitude not distinguished (see docs/accuracy.md). `lonDeg`
 * is already folded into `lstDegValue` by the caller via lstDeg(jd, lonDeg)
 * — this function only needs latDeg + the combined LST.
 */
// WGS-84 reference ellipsoid (Meeus Ch. 11) — deliberately NOT the same as
// PLANETS.earth.radiusKm (the app's single mean radius, used everywhere
// else for rendering/scale.js compression): geodetic-to-geocentric
// conversion needs the real equatorial radius + flattening specifically,
// a distinct concern from "one representative radius for a sphere".
const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
const WGS84_FLATTENING = 1 / 298.257223563;
const ONE_MINUS_F = 1 - WGS84_FLATTENING;

/**
 * Observer's geocentric position vector, equatorial frame, AU — v1.3: now
 * corrected for Earth's real oblateness (Meeus 11.1-11.2, WGS-84), not a
 * sphere. Geodetic latitude in, geocentric latitude/radius handled
 * internally; up to ~0.2deg from a spherical-Earth answer at mid
 * latitudes (the number docs/accuracy.md already quoted as this mode's
 * pre-v1.3 approximation scope).
 */
export function observerGeocentricPositionAu({ latDeg, elevationM = 0 }, lstDegValue) {
  const latRad = latDeg * DEG_TO_RAD;
  const lstRad = lstDegValue * DEG_TO_RAD;
  const elevationKm = elevationM / 1000;

  const u = Math.atan(ONE_MINUS_F * Math.tan(latRad));
  const rhoSinPhiPrime = ONE_MINUS_F * Math.sin(u) + (elevationKm / EARTH_EQUATORIAL_RADIUS_KM) * Math.sin(latRad);
  const rhoCosPhiPrime = Math.cos(u) + (elevationKm / EARTH_EQUATORIAL_RADIUS_KM) * Math.cos(latRad);

  const rXYKm = rhoCosPhiPrime * EARTH_EQUATORIAL_RADIUS_KM;
  const rZKm = rhoSinPhiPrime * EARTH_EQUATORIAL_RADIUS_KM;
  return {
    x: rXYKm * Math.cos(lstRad) * AU_PER_KM,
    y: rXYKm * Math.sin(lstRad) * AU_PER_KM,
    z: rZKm * AU_PER_KM,
  };
}

// Bennett's atmospheric refraction formula (Meeus Ch. 16), true-altitude
// form — the standard amateur-astronomy-precision approximation, valid to
// h > -1deg or so, assuming 1010mbar/10degC (this project doesn't expose
// pressure/temperature inputs, matching its "much better than nothing,
// not observatory-grade" precision tier everywhere else). Returns 0 below
// -1deg rather than extrapolating into the formula's singularity.
const REFRACTION_MIN_ALT_DEG = -1;

/** Atmospheric refraction, arcminutes, for a TRUE (geometric) altitude in degrees. */
export function refractionArcmin(trueAltDeg) {
  if (trueAltDeg < REFRACTION_MIN_ALT_DEG) return 0;
  const h = trueAltDeg;
  return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * DEG_TO_RAD);
}

// IAU 1976 precession polynomials (Meeus Ch. 21, eq. 21.2), arcseconds per
// Julian century from J2000. Used by precessEquatorialToDate only — the
// shared OBLIQUITY_DEG rotation above deliberately stays a fixed J2000
// constant: the star catalog (core/star-catalog.js) renders fixed-J2000
// Hipparcos coordinates through equatorialToEcliptic, and making the
// obliquity date-dependent there would silently rotate the whole star
// sphere over time with no corresponding data correction. Precession is
// applied at Observer Mode's output only (analysis/observer.js).
const ARCSEC_TO_DEG = 1 / 3600;

/**
 * Precesses a J2000 mean-equator/equinox equatorial vector to the mean
 * equator/equinox of date at `jd` — rigorous IAU 1976 rotation (Meeus
 * Ch. 21): R_z(-z) · R_y(theta) · R_z(-zeta). Also fixes an internal
 * inconsistency: gmstDeg above is inherently equinox-of-date, so hour
 * angles computed from a J2000-anchored RA were silently mixing two
 * equinox references (~0.36deg by 2026) before v1.5.
 */
export function precessEquatorialToDate(v, jd) {
  const T = (jd - J2000_JD) / 36525;
  const zetaDeg = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * ARCSEC_TO_DEG;
  const zDeg = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * ARCSEC_TO_DEG;
  const thetaDeg = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * ARCSEC_TO_DEG;

  const zeta = zetaDeg * DEG_TO_RAD;
  const z = zDeg * DEG_TO_RAD;
  const theta = thetaDeg * DEG_TO_RAD;

  // R_z(-zeta): rotate about z by +zeta (standard equinox convention)
  const x1 = v.x * Math.cos(zeta) - v.y * Math.sin(zeta);
  const y1 = v.x * Math.sin(zeta) + v.y * Math.cos(zeta);
  const z1 = v.z;
  // R_y(theta)
  const x2 = x1 * Math.cos(theta) - z1 * Math.sin(theta);
  const y2 = y1;
  const z2 = x1 * Math.sin(theta) + z1 * Math.cos(theta);
  // R_z(-z)
  return {
    x: x2 * Math.cos(z) - y2 * Math.sin(z),
    y: x2 * Math.sin(z) + y2 * Math.cos(z),
    z: z2,
  };
}

/**
 * Nutation in longitude/obliquity — Meeus Ch. 22, abbreviated form: the
 * five fundamental arguments as low-order polynomials (deliberately NOT
 * refactored out of lunar-theory.js's higher-order versions — that
 * function is verified against Meeus's own worked example and doesn't
 * compute Ω anyway) plus the dominant periodic terms. Accuracy ~0.5″,
 * ample against the full IAU 1980 106-term series for this project's
 * precision tier. Degrees out.
 */
export function nutation(jd) {
  const T = (jd - J2000_JD) / 36525;
  // Fundamental arguments (degrees) — Meeus 22.x low-order polynomials.
  const D = 297.85036 + 445267.111480 * T - 0.0019142 * T * T + T * T * T / 189474;
  const M = 357.52772 + 35999.050340 * T - 0.0001603 * T * T - T * T * T / 300000;
  const Mp = 134.96298 + 477198.867398 * T + 0.0086972 * T * T + T * T * T / 56250;
  const F = 93.27191 + 483202.017538 * T - 0.0036825 * T * T + T * T * T / 327270;
  const Om = 125.04452 - 1934.136261 * T + 0.0020708 * T * T + T * T * T / 450000;

  const rad = (deg) => deg * DEG_TO_RAD;
  // Dominant terms of the IAU 1980 series (coefficients in 0.0001″).
  const dPsiArcsec = (
    (-171996 - 174.2 * T) * Math.sin(rad(Om))
    + (-13187 - 1.6 * T) * Math.sin(rad(-2 * D + 2 * F + 2 * Om))
    + (-2274 - 0.2 * T) * Math.sin(rad(2 * F + 2 * Om))
    + (2062 + 0.2 * T) * Math.sin(rad(2 * Om))
    + (1426 - 3.4 * T) * Math.sin(rad(M))
    + (712 + 0.1 * T) * Math.sin(rad(Mp))
    + (-517 + 1.2 * T) * Math.sin(rad(-2 * D + M + 2 * F + 2 * Om))
    + (-386 - 0.4 * T) * Math.sin(rad(2 * F + Om))
    - 301 * Math.sin(rad(Mp + 2 * F + 2 * Om))
  ) * 0.0001;
  const dEpsArcsec = (
    (92025 + 8.9 * T) * Math.cos(rad(Om))
    + (5736 - 3.1 * T) * Math.cos(rad(-2 * D + 2 * F + 2 * Om))
    + (977 - 0.5 * T) * Math.cos(rad(2 * F + 2 * Om))
    + (-895 + 0.5 * T) * Math.cos(rad(2 * Om))
    + (54 - 0.1 * T) * Math.cos(rad(M))
    - 7 * Math.cos(rad(Mp))
    + (224 - 0.6 * T) * Math.cos(rad(-2 * D + M + 2 * F + 2 * Om))
    + 200 * Math.cos(rad(2 * F + Om))
    + (129 - 0.1 * T) * Math.cos(rad(Mp + 2 * F + 2 * Om))
  ) * 0.0001;

  return { dPsiDeg: dPsiArcsec / 3600, dEpsDeg: dEpsArcsec / 3600 };
}

/**
 * Rotates a MEAN-equinox-of-date equatorial vector to the TRUE equinox of
 * date: R_x(-(eps+dEps)) · R_z(-dPsi) · R_x(eps) — into the ecliptic
 * frame, rotate the equinox by nutation-in-longitude, back into the
 * (now-nutated) equatorial frame. Uses the fixed OBLIQUITY_DEG for eps:
 * the mean-obliquity drift inside a 17″ rotation contributes <0.01″,
 * far below this tier.
 */
export function nutateEquatorialToTrue(v, jd) {
  const { dPsiDeg, dEpsDeg } = nutation(jd);
  const eps = OBLIQUITY_DEG * DEG_TO_RAD;
  const epsTrue = (OBLIQUITY_DEG + dEpsDeg) * DEG_TO_RAD;
  const dPsi = dPsiDeg * DEG_TO_RAD;

  // R_x(eps): equatorial -> ecliptic-of-date
  const y1 = v.y * Math.cos(eps) + v.z * Math.sin(eps);
  const z1 = -v.y * Math.sin(eps) + v.z * Math.cos(eps);
  const x1 = v.x;
  // R_z(-dPsi): rotate the equinox by nutation in longitude
  const x2 = x1 * Math.cos(dPsi) - y1 * Math.sin(dPsi);
  const y2 = x1 * Math.sin(dPsi) + y1 * Math.cos(dPsi);
  const z2 = z1;
  // R_x(-(eps+dEps)): ecliptic -> TRUE equatorial (nutated obliquity)
  return {
    x: x2,
    y: y2 * Math.cos(epsTrue) - z2 * Math.sin(epsTrue),
    z: y2 * Math.sin(epsTrue) + z2 * Math.cos(epsTrue),
  };
}

/** Equation of the equinoxes (degrees): apparent minus mean sidereal time
 *  = dPsi · cos(eps). Added to gmstDeg/lstDeg to get apparent (GAST-based)
 *  sidereal time, keeping hour angles consistent with a true-of-date RA. */
export function eqEquinoxDeg(jd) {
  return nutation(jd).dPsiDeg * Math.cos(OBLIQUITY_DEG * DEG_TO_RAD);
}

/** Local hour angle H = LST - RA. Degrees, [0, 360). */
export function hourAngleDeg(lstDegValue, raDeg) {
  return wrap360(lstDegValue - raDeg);
}

/**
 * Standard spherical-astronomy Alt/Az from Dec/observer-lat/hour-angle.
 * Azimuth convention: measured from North, clockwise through East
 * (0=N, 90=E, 180=S, 270=W) — documented explicitly since an alternate
 * from-South convention exists in older texts. Azimuth is undefined at
 * the zenith/nadir (cos(alt)≈0) — reports 0° there rather than NaN.
 */
export function altAzFromDecHa({ decDeg, latDeg, haDeg }) {
  const dec = decDeg * DEG_TO_RAD;
  const lat = latDeg * DEG_TO_RAD;
  const ha = haDeg * DEG_TO_RAD;
  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  const altRad = Math.asin(clampUnit(sinAlt));
  if (Math.abs(Math.cos(altRad)) < 1e-8) return { altDeg: altRad * RAD_TO_DEG, azDeg: 0 };
  const cosAz = (Math.sin(dec) - Math.sin(altRad) * Math.sin(lat)) / (Math.cos(altRad) * Math.cos(lat));
  let azRad = Math.acos(clampUnit(cosAz));
  if (Math.sin(ha) > 0) azRad = 2 * Math.PI - azRad;
  return { altDeg: altRad * RAD_TO_DEG, azDeg: azRad * RAD_TO_DEG };
}
