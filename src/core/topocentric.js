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

// Fixed obliquity approximation — see docs/accuracy.md "Observer Mode
// (v0.6)". Ignores real time-varying obliquity, precession, nutation.
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

/**
 * Observer's geocentric position vector, equatorial frame, AU. Spherical
 * Earth (real radiusKm + elevationM) — NO oblateness, geodetic vs.
 * geocentric latitude not distinguished (see docs/accuracy.md). `lonDeg`
 * is already folded into `lstDegValue` by the caller via lstDeg(jd, lonDeg)
 * — this function only needs latDeg + the combined LST.
 */
export function observerGeocentricPositionAu({ latDeg, elevationM = 0 }, lstDegValue) {
  const rAu = (PLANETS.earth.radiusKm + elevationM / 1000) * AU_PER_KM;
  const latRad = latDeg * DEG_TO_RAD;
  const lstRad = lstDegValue * DEG_TO_RAD;
  return {
    x: rAu * Math.cos(latRad) * Math.cos(lstRad),
    y: rAu * Math.cos(latRad) * Math.sin(lstRad),
    z: rAu * Math.sin(latRad),
  };
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
