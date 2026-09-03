// textureKey -> local file lookup only. Source URLs, licenses, and credits
// are NOT duplicated here — assets/textures/manifest.json is the single
// source of truth for that, and ATTRIBUTION.md is the human-readable
// summary. Files are self-hosted rather than hotlinked (both source hosts
// send no Access-Control-Allow-Origin header, which WebGL's texImage2D
// requires for a cross-origin image) — see scripts/fetch-textures.mjs.
//
// A body with no entry here (Pluto, Callisto, Halley's Comet — see
// ATTRIBUTION.md for why) falls back to a runtime procedural texture
// (src/render/procedural-textures.js), not a missing/flat-color material.

const BASE = 'assets/textures';

export const TEXTURES = {
  sun: `${BASE}/2k_sun.jpg`,
  mercury: `${BASE}/2k_mercury.jpg`,
  venus: `${BASE}/2k_venus_surface.jpg`,
  venusAtmosphere: `${BASE}/2k_venus_atmosphere.jpg`,
  earth: `${BASE}/2k_earth_daymap.jpg`,
  earthNight: `${BASE}/2k_earth_nightmap.jpg`,
  earthClouds: `${BASE}/2k_earth_clouds.jpg`,
  mars: `${BASE}/2k_mars.jpg`,
  jupiter: `${BASE}/2k_jupiter.jpg`,
  saturn: `${BASE}/2k_saturn.jpg`,
  uranus: `${BASE}/2k_uranus.jpg`,
  neptune: `${BASE}/2k_neptune.jpg`,
  moon: `${BASE}/2k_moon.jpg`,
  stars: `${BASE}/2k_stars_milky_way.jpg`,
  saturnRing: `${BASE}/2k_saturn_ring_alpha.png`,
  io: `${BASE}/io.jpg`,
  europa: `${BASE}/europa.png`,
  ganymede: `${BASE}/ganymede.jpg`,
  titan: `${BASE}/titan.jpg`,
  triton: `${BASE}/triton.jpg`,
  charon: `${BASE}/charon.jpg`,
};

/** Preview-resolution (512px) counterpart of a full texture path, same filename under BASE/preview/. */
export function previewPath(fullPath) {
  const filename = fullPath.slice(fullPath.lastIndexOf('/') + 1);
  return `${BASE}/preview/${filename}`;
}
