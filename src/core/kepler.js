// Kepler-equation solver and orbital-elements -> heliocentric position.
// Pure math, no THREE/DOM imports — must stay Node-testable.

/** Wrap an angle in radians to [0, 2*PI). */
export function normalizeAngle(radians) {
  const twoPi = 2 * Math.PI;
  let a = radians % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

/**
 * Solve Kepler's equation M = E - e*sin(E) for the eccentric anomaly E,
 * via Newton-Raphson. M and the return value are in radians.
 */
export function solveEccentricAnomaly(meanAnomalyRad, eccentricity, tolerance = 1e-6, maxIter = 30) {
  const M = normalizeAngle(meanAnomalyRad);
  let E = eccentricity < 0.8 ? M : Math.PI;
  for (let i = 0; i < maxIter; i++) {
    const dE = (E - eccentricity * Math.sin(E) - M) / (1 - eccentricity * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < tolerance) break;
  }
  return E;
}

/**
 * Convert one set of osculating orbital elements + mean anomaly into a
 * heliocentric {x,y,z} position (same units as `a`) in the ecliptic J2000
 * frame.
 *
 * @param {object} elements
 * @param {number} elements.a  semi-major axis
 * @param {number} elements.e  eccentricity
 * @param {number} elements.i  inclination (radians)
 * @param {number} elements.om longitude of ascending node, "Ω" (radians)
 * @param {number} elements.w  argument of periapsis, "ω" (radians)
 * @param {number} elements.meanAnomalyRad mean anomaly (radians)
 */
export function elementsToPosition({ a, e, i, om, w, meanAnomalyRad }) {
  const E = solveEccentricAnomaly(meanAnomalyRad, e);

  // True anomaly and radius from the eccentric anomaly.
  const trueAnomaly = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2)
  );
  const r = a * (1 - e * Math.cos(E));

  // Position in the orbital (perifocal) plane.
  const xOrb = r * Math.cos(trueAnomaly);
  const yOrb = r * Math.sin(trueAnomaly);

  // Rotate perifocal -> ecliptic via R3(-om) * R1(-i) * R3(-w).
  const cosW = Math.cos(w), sinW = Math.sin(w);
  const cosOm = Math.cos(om), sinOm = Math.sin(om);
  const cosI = Math.cos(i), sinI = Math.sin(i);

  const x =
    xOrb * (cosW * cosOm - sinW * sinOm * cosI) -
    yOrb * (sinW * cosOm + cosW * sinOm * cosI);
  const y =
    xOrb * (cosW * sinOm + sinW * cosOm * cosI) +
    yOrb * (cosW * cosOm * cosI - sinW * sinOm);
  const z = xOrb * (sinW * sinI) + yOrb * (cosW * sinI);

  return { x, y, z };
}
