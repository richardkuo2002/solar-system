// Small, self-written, seeded 3D value-noise + fbm generator — used only by
// procedural-textures.js for bodies with no real photographic texture.
// Deterministic per seed so the same body always gets the same look.

export function hashSeed(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + t * (b - a);
const wrap255 = (v) => ((v % 256) + 256) % 256;

/** Seeded 3D value-noise sampler + fbm/ridged fractal helpers. */
export function makeNoise(seed) {
  const rand = mulberry32(seed);
  const SIZE = 256;
  const values = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) values[i] = rand();
  const perm = new Uint8Array(SIZE);
  for (let i = 0; i < SIZE; i++) perm[i] = i;
  for (let i = SIZE - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }

  function latticeValue(x, y, z) {
    const xi = wrap255(x), yi = wrap255(y), zi = wrap255(z);
    return values[perm[(xi + perm[(yi + perm[zi]) % SIZE]) % SIZE]];
  }

  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
    const c000 = latticeValue(xi, yi, zi), c100 = latticeValue(xi + 1, yi, zi);
    const c010 = latticeValue(xi, yi + 1, zi), c110 = latticeValue(xi + 1, yi + 1, zi);
    const c001 = latticeValue(xi, yi, zi + 1), c101 = latticeValue(xi + 1, yi, zi + 1);
    const c011 = latticeValue(xi, yi + 1, zi + 1), c111 = latticeValue(xi + 1, yi + 1, zi + 1);
    const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u);
    const x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
    const y0 = lerp(x00, x10, v), y1 = lerp(x01, x11, v);
    return lerp(y0, y1, w) * 2 - 1; // [-1, 1]
  }

  /** Fractal Brownian motion: several octaves of noise summed, roughly [-1, 1]. */
  function fbm(x, y, z, octaves = 5) {
    let sum = 0, amp = 0.5, freq = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise3(x * freq, y * freq, z * freq);
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / total;
  }

  /** Ridged variant (folds noise around zero) — sharper, vein/crater-like detail, roughly [0, 1]. */
  function ridged(x, y, z, octaves = 4) {
    let sum = 0, amp = 0.5, freq = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * (1 - Math.abs(noise3(x * freq, y * freq, z * freq)));
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / total;
  }

  return { noise3, fbm, ridged };
}
