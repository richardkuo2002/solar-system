// Pure math for the procedural background star layer (src/render/starfield.js
// builds the actual THREE.Points/BufferGeometry from this). Zero THREE/DOM
// imports, so this is Node-testable the same way orbital-elements.js/scale.js
// are — deterministic output for a given seed is exactly what a smoke test
// needs to check.

/**
 * mulberry32 — a small, public-domain, deterministic 32-bit PRNG. Same seed
 * always produces the same sequence, which is the whole point here (the
 * roadmap-adjacent requirement is "fixed seed -> identical star field every
 * load", not cryptographic quality).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Uniformly-distributed point on the unit sphere. Sampling x/y/z
 * independently and normalizing is WRONG (it biases toward the cube's
 * corners); this instead samples z uniformly in [-1,1] and the azimuthal
 * angle uniformly in [0,2*PI), which is the standard, provably-uniform
 * construction (Archimedes' hat-box theorem: uniform z on a sphere <=>
 * uniform surface area).
 */
export function sampleUnitSphere(rand) {
  const z = 2 * rand() - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const theta = 2 * Math.PI * rand();
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), z };
}

export const STAR_COUNTS = { low: 2500, medium: 6000, high: 12000 };
export const DEFAULT_STAR_QUALITY = 'medium';

// Stylized palette, not real stellar-population statistics (no attempt at
// matching the real Milky Way's actual mix of spectral types) — just five
// visually-distinct color temperatures with weights chosen so most stars
// read as white/warm-white, per the requested "at least five color
// categories" with a plausible-looking skew. `weight`s are cumulative
// selection probability, not physical star-type frequency.
const STAR_PALETTE = [
  { name: 'blue-white', weight: 0.08, r: 0.75, g: 0.82, b: 1.0 },
  { name: 'white', weight: 0.3, r: 1.0, g: 1.0, b: 1.0 },
  { name: 'warm-white', weight: 0.35, r: 1.0, g: 0.93, b: 0.8 },
  { name: 'orange', weight: 0.17, r: 1.0, g: 0.7, b: 0.42 },
  { name: 'red', weight: 0.1, r: 1.0, g: 0.45, b: 0.35 },
];

function pickColor(rand) {
  let t = rand();
  for (const entry of STAR_PALETTE) {
    if (t < entry.weight) return entry;
    t -= entry.weight;
  }
  return STAR_PALETTE[STAR_PALETTE.length - 1];
}

// Brightness skew: most stars dim/small, a few bright/large. Raising a
// uniform random to a power > 1 pushes the distribution toward 0 while
// still allowing rare values near 1 — a cheap stand-in for a realistic
// magnitude distribution without modeling actual stellar luminosity.
const BRIGHTNESS_SKEW_POWER = 3.2;
const MIN_POINT_SIZE_PX = 0.6;
const MAX_POINT_SIZE_PX = 3.2;

/**
 * Builds the full deterministic star field for a given count/seed: unit-
 * sphere positions, per-star RGB color (0..1), brightness (0..1, skewed
 * dim-heavy), and a point size in pixels correlated with brightness.
 * Returns plain typed arrays (Float32Array) — render/starfield.js copies
 * these straight into BufferAttributes, scaling position by the scene's
 * star-shell radius (a render-layer concern, not this module's).
 */
export function generateStarfield({ count, seed }) {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const p = sampleUnitSphere(rand);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;

    const b = Math.pow(rand(), BRIGHTNESS_SKEW_POWER);
    brightness[i] = b;
    sizes[i] = MIN_POINT_SIZE_PX + (MAX_POINT_SIZE_PX - MIN_POINT_SIZE_PX) * b;

    const color = pickColor(rand);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  return { positions, colors, sizes, brightness };
}
