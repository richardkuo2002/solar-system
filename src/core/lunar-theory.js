// Moon geocentric ecliptic position — Meeus, "Astronomical Algorithms" 2nd
// ed., Chapter 47 ("Position of the Moon"): the standard truncated
// ELP2000-82B-derived periodic series (60 terms for longitude/distance, 60
// for latitude). Pure math, no THREE/DOM imports — Node-testable, mirrors
// kepler.js's style.
//
// Precision: ~10 arcsec in longitude, ~4 arcsec in latitude, ~4000 km
// (~1%) in distance — per Meeus. Output is geocentric ecliptic lon/lat/
// distance referred to the MEAN EQUINOX OF DATE (matches Meeus's own
// worked example, so it's directly testable against a published
// reference) — NOT the fixed J2000 equinox the rest of this project's
// ECLIPJ2000 frame uses. Callers that need a J2000-consistent longitude
// (i.e. orbital-elements.js#moonHeliocentricPositionAu, which combines
// this with Standish-element positions that ARE J2000-fixed) must apply
// the general-precession-in-longitude correction themselves — this is
// NOT a negligible rounding nicety: left uncorrected it grows to several
// tenths of a degree within a few decades of J2000 (see that function's
// docstring for the concrete bug this caused before the correction was
// added). Not corrected for nutation (sub-arcminute, genuinely negligible
// here). Time argument is treated as JD ~= TT (UTC-TT is under 70s,
// negligible here). See docs/accuracy.md.

const DEG_TO_RAD = Math.PI / 180;
const J2000_JD = 2451545.0;

// Table 47.A: periodic terms for longitude (Sigma_l, unit 1e-6 deg) and
// distance (Sigma_r, unit 1e-3 km). Columns: D, M, M', F, coeff_l, coeff_r.
const TABLE_47A = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],
  [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0],
  [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616],
  [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117],
  [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423],
  [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571],
  [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0],
  [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0],
  [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0],
  [2, 0, -1, -2, 0, 8752],
];

// Table 47.B: periodic terms for latitude (Sigma_b, unit 1e-6 deg).
// Columns: D, M, M', F, coeff_b.
const TABLE_47B = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],
  [1, 0, 0, 1, -1491],
  [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344],
  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021],
  [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777],
  [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596],
  [2, -1, 1, -1, 491],
  [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439],
  [2, 0, 2, 1, 422],
  [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351],
  [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315],
  [2, -2, 0, -1, 302],
  [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229],
  [1, 1, 0, -1, 223],
  [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220],
  [2, 1, -1, -1, -220],
  [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181],
  [0, 1, 2, 1, -177],
  [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166],
  [1, 0, 1, -1, -164],
  [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119],
  [4, -1, 0, -1, 115],
  [2, -2, 0, 1, 107],
];

/**
 * Moon's geocentric ecliptic position for a given Julian Date.
 * @returns {{ lonDeg: number, latDeg: number, distanceKm: number }}
 */
export function moonEclipticPosition(jd) {
  const T = (jd - J2000_JD) / 36525;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  // Fundamental arguments (degrees), Meeus eq. 47.1-47.5.
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000;
  const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000;

  // Additive-correction arguments (Venus/Jupiter/flattening terms).
  const A1 = (119.75 + 131.849 * T) * DEG_TO_RAD;
  const A2 = (53.09 + 479264.29 * T) * DEG_TO_RAD;
  const A3 = (313.45 + 481266.484 * T) * DEG_TO_RAD;

  const Dr = D * DEG_TO_RAD;
  const Mr = M * DEG_TO_RAD;
  const Mpr = Mp * DEG_TO_RAD;
  const Fr = F * DEG_TO_RAD;
  const Lpr = Lp * DEG_TO_RAD;

  // Earth-orbit eccentricity correction (Sun's mean anomaly terms need
  // dampening away from J2000 — eq. 47.6).
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const E2 = E * E;
  const eFactor = (mCoeff) => (Math.abs(mCoeff) === 1 ? E : Math.abs(mCoeff) === 2 ? E2 : 1);

  let sigmaL = 0;
  let sigmaR = 0;
  for (const [d, m, mp, f, coeffL, coeffR] of TABLE_47A) {
    const arg = d * Dr + m * Mr + mp * Mpr + f * Fr;
    const factor = eFactor(m);
    sigmaL += factor * coeffL * Math.sin(arg);
    sigmaR += factor * coeffR * Math.cos(arg);
  }

  let sigmaB = 0;
  for (const [d, m, mp, f, coeffB] of TABLE_47B) {
    const arg = d * Dr + m * Mr + mp * Mpr + f * Fr;
    sigmaB += eFactor(m) * coeffB * Math.sin(arg);
  }

  sigmaL += 3958 * Math.sin(A1) + 1962 * Math.sin(Lpr - Fr) + 318 * Math.sin(A2);
  sigmaB +=
    -2235 * Math.sin(Lpr) +
    382 * Math.sin(A3) +
    175 * Math.sin(A1 - Fr) +
    175 * Math.sin(A1 + Fr) +
    127 * Math.sin(Lpr - Mpr) -
    115 * Math.sin(Lpr + Mpr);

  const lonDegRaw = Lp + sigmaL / 1e6;
  const lonDeg = ((lonDegRaw % 360) + 360) % 360;
  const latDeg = sigmaB / 1e6;
  const distanceKm = 385000.56 + sigmaR / 1e3;

  return { lonDeg, latDeg, distanceKm };
}
