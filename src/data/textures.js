// 2k CC-BY textures from solarsystemscope.com
// (https://www.solarsystemscope.com/textures/, CC Attribution 4.0
// International — attribute solarsystemscope.com per their license if this
// ships publicly). Self-hosted under assets/textures/ rather than hotlinked
// from their CDN: their server sends no Access-Control-Allow-Origin header,
// so WebGL's texImage2D throws a SecurityError on a cross-origin image
// without a CORS-cleared response — hotlinking simply doesn't work here.
//
// Only bodies with an entry here get a real texture; bodies/moons without
// one (the Galilean moons — solarsystemscope.com doesn't publish textures
// for them) fall back to a flat color in render/bodies.js.

const BASE = 'assets/textures';

export const TEXTURES = {
  sun: `${BASE}/2k_sun.jpg`,
  mercury: `${BASE}/2k_mercury.jpg`,
  venus: `${BASE}/2k_venus_surface.jpg`,
  earth: `${BASE}/2k_earth_daymap.jpg`,
  mars: `${BASE}/2k_mars.jpg`,
  jupiter: `${BASE}/2k_jupiter.jpg`,
  saturn: `${BASE}/2k_saturn.jpg`,
  uranus: `${BASE}/2k_uranus.jpg`,
  neptune: `${BASE}/2k_neptune.jpg`,
  moon: `${BASE}/2k_moon.jpg`,
  stars: `${BASE}/2k_stars_milky_way.jpg`,
  saturnRing: `${BASE}/2k_saturn_ring_alpha.png`,
};
