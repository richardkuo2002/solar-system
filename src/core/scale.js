// "Simplified realistic" scale compression: real planet textures, but
// distances and sizes are compressed with two independent, gentler-than-
// linear curves so the whole system stays visible and legible on screen —
// at true relative scale, inner planets would be crushed against the Sun
// and would render as sub-pixel dots. Pure math, Node-testable.

export const AU_BASE_SCALE = 20;
export const DISTANCE_POWER = 0.6;

export const EARTH_RADIUS_KM = 6371;
export const SIZE_BASE_SCALE = 0.3; // scene units for a body with radiusKm === EARTH_RADIUS_KM
export const SIZE_POWER = 0.45;
export const SUN_SIZE_CAP = 3.5; // scene units — true relative Sun size would dominate the scene

/** Compress a real distance (AU) into scene units. Monotonic in auValue. */
export function compressDistance(auValue) {
  return AU_BASE_SCALE * Math.pow(auValue, DISTANCE_POWER);
}

/** Compress a real radius (km) into scene units. Monotonic in radiusKm. */
export function compressSize(radiusKm) {
  return SIZE_BASE_SCALE * Math.pow(radiusKm / EARTH_RADIUS_KM, SIZE_POWER);
}

export const MOON_GAP_SCALE = 0.068;
export const MOON_GAP_POWER = 0.4;

/**
 * Compress a moon's orbit radius into scene units, relative to its parent
 * planet — NOT the same curve as compressDistance, which is tuned for
 * heliocentric AU-scale distances (0.4-30 AU) and would collapse moon-scale
 * orbits (hundreds of thousands of km) to well inside the parent planet's
 * rendered radius. Uses the orbit-radius-in-parent-radii ratio (a
 * physically meaningful, scale-invariant number — the Moon orbits at ~60
 * Earth radii, Io at ~6 Jupiter radii) and always adds on top of the
 * parent's own scene radius, so a moon can never render inside its parent.
 */
export function compressMoonOrbit(orbitKm, parentRadiusKm, parentSceneRadius) {
  const radiiRatio = orbitKm / parentRadiusKm;
  return parentSceneRadius + MOON_GAP_SCALE * Math.pow(radiiRatio, MOON_GAP_POWER);
}

/**
 * Compress a heliocentric position (AU, plain {x,y,z}) into scene units,
 * preserving direction — compresses the *radial distance* via
 * compressDistance, not each axis independently (compressDistance is only
 * valid for non-negative magnitudes; applying it per-axis would break on
 * negative coordinates and would distort angles).
 */
export function compressPosition(auPosition) {
  const r = Math.hypot(auPosition.x, auPosition.y, auPosition.z);
  if (r === 0) return { x: 0, y: 0, z: 0 };
  const factor = compressDistance(r) / r;
  return { x: auPosition.x * factor, y: auPosition.y * factor, z: auPosition.z * factor };
}
