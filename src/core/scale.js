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
