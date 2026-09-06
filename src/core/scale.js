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

// Saturn's ring outer edge, real km (main rings: C through A). Lives here
// (not render/bodies.js, which imports THREE) so moonLocalPosition below can
// also read it, to keep Titan's compressed orbit outside the ring — the two
// curves (compressSize for the ring, compressMoonOrbit for moon orbits) are
// independently tuned and don't otherwise preserve real-world ordering at
// Saturn's scale. render/bodies.js imports this instead of redeclaring it.
export const SATURN_RING_OUTER_KM = 136800;

/**
 * Compress a moon's orbit radius into scene units, relative to its parent
 * planet — NOT the same curve as compressDistance, which is tuned for
 * heliocentric AU-scale distances (0.4-30 AU) and would collapse moon-scale
 * orbits (hundreds of thousands of km) to well inside the parent planet's
 * rendered radius. Uses the orbit-radius-in-parent-radii ratio (a
 * physically meaningful, scale-invariant number — the Moon orbits at ~60
 * Earth radii, Io at ~6 Jupiter radii) and always adds on top of the
 * parent's own scene radius, so a moon can never render inside its parent.
 *
 * `minSceneRadius` (optional): a floor on the result — used to keep Titan
 * clear of Saturn's rings (see SATURN_RING_OUTER_KM above); 0 for every
 * other moon, so this is a no-op for them.
 */
export function compressMoonOrbit(orbitKm, parentRadiusKm, parentSceneRadius, minSceneRadius = 0) {
  // v1.8.6 — parentRadiusKm <= 0 has no real data row today, but is a
  // latent trap for the next moon/dwarf-planet addition with a missing
  // radiusKm: it used to silently produce Infinity here, which then
  // propagated through spacedMoonOrbitRadii's Math.max into every other
  // moon sharing that parent, making the entire moon system vanish from
  // the scene with no error. Fail loudly instead — this is a data bug,
  // not a value worth quietly working around.
  if (!(parentRadiusKm > 0)) {
    throw new Error(`compressMoonOrbit: parentRadiusKm must be positive, got ${parentRadiusKm}`);
  }
  const radiiRatio = orbitKm / parentRadiusKm;
  const r = parentSceneRadius + MOON_GAP_SCALE * Math.pow(radiiRatio, MOON_GAP_POWER);
  return Math.max(r, minSceneRadius);
}

// v1.8.4 — for a parent with 2+ moons whose real orbital-radius ratios span
// a narrow range (Jupiter's four Galilean moons: Io ~6x Jupiter's radius,
// Callisto ~27x — under 5x apart), compressMoonOrbit's shared ratio^power
// curve compresses that narrow real range into an even narrower scene-unit
// spread, visibly narrower than the moons' own rendered sizes — so the
// moons render overlapping each other (and the planet), rather than
// merely "close together" the way the real solar system actually has
// them. Walks moons ordered by real orbit radius (ascending — the
// `moons` array must already be sorted, since this only ever pushes
// outward) and nudges any orbit that would overlap its inner neighbor
// (both moons' compressed sizes + a small gap) further out. A no-op for
// any parent with 0-1 moons (Earth/Saturn/Neptune here), since there's no
// neighbor to collide with — existing single-moon systems are unaffected.
export const MOON_MIN_GAP_SCENE = 0.02;

export function spacedMoonOrbitRadii(moons) {
  const result = [];
  let prevR = null;
  let prevSizeScene = 0;
  for (const moon of moons) {
    const rScene = prevR === null ? moon.rScene : Math.max(moon.rScene, prevR + prevSizeScene + moon.sizeScene + MOON_MIN_GAP_SCENE);
    result.push({ ...moon, rScene });
    prevR = rScene;
    prevSizeScene = moon.sizeScene;
  }
  return result;
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

/**
 * Real apparent angular radius (radians) of a body of radiusKm at
 * distanceKm — the number the compression curves above deliberately do
 * NOT preserve (they compress distance far more aggressively than size,
 * see docs/accuracy.md's "Surface Mode sky realism" note). Used by v1.3's
 * Surface Mode Sun/moon override, which needs the real angular size
 * instead of the compressed scene's inflated one.
 */
export function apparentAngularRadiusRad(radiusKm, distanceKm) {
  // v1.8.6 — Math.asin is only defined for inputs in [-1, 1]; a
  // distanceKm collapsed below radiusKm (a degenerate body-state, e.g. a
  // Kepler propagation far outside Standish validity, or a future body
  // added with bad data) previously returned NaN here, which silently
  // zeroed out an object's THREE.js scale and made it vanish from the
  // scene with no error. Clamping the ratio caps the returned angle at
  // 90° (pi/2) instead — visually "fills the whole sky", a plausible
  // degenerate answer, rather than "disappears".
  return Math.asin(Math.min(1, radiusKm / distanceKm));
}
