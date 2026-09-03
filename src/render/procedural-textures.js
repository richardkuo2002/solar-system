// Runtime procedural fallback for bodies with no real photographic texture
// (Pluto, Callisto, Halley's Comet — see ATTRIBUTION.md for why). An
// equirectangular canvas texture, sampled per-pixel from 3D value noise
// projected onto a sphere, so it wraps seamlessly at the ±180° seam and at
// both poles (unlike 2D noise sampled directly in (u,v)).
//
// Only ever 3 bodies use this — small enough that generating synchronously
// at a modest 512×256 is fast (well under 100ms each) and doesn't need the
// background job-queue a larger set of procedural bodies would justify.
import * as THREE from 'three';
import { makeNoise, hashSeed } from './noise.js';

const PALETTES = {
  gray: { base: [120, 118, 116], varr: [55, 55, 55], craters: 1.0 },
  ice: { base: [205, 215, 225], varr: [35, 32, 28], craters: 0.3 },
  pluto: { base: [196, 168, 132], varr: [70, 60, 45], craters: 0.4 },
  callisto: { base: [110, 100, 90], varr: [65, 60, 50], craters: 1.2 },
  comet: { base: [55, 58, 64], varr: [30, 28, 26], craters: 0.6 },
};

function clamp255(v) {
  return Math.max(0, Math.min(255, v));
}

/** Deterministic per-`bodyId` equirectangular procedural texture. */
export function proceduralMap(bodyId, palette = 'gray', width = 512, height = 256) {
  const preset = PALETTES[palette] ?? PALETTES.gray;
  const n = makeNoise(hashSeed(`${bodyId}:tex`));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const d = img.data;

  for (let y = 0; y < height; y++) {
    const lat = (0.5 - y / height) * Math.PI;
    const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    for (let x = 0; x < width; x++) {
      const lon = (x / width - 0.5) * 2 * Math.PI;
      const px = cosLat * Math.cos(lon), py = sinLat, pz = cosLat * Math.sin(lon);

      let t = 0.5 + 0.5 * n.fbm(px * 3, py * 3, pz * 3, 5);
      t = t * 0.7 + 0.3 * n.ridged(px * 8, py * 8, pz * 8, 4);

      let shade = 1;
      if (preset.craters > 0) {
        const c = n.fbm(px * 18, py * 18, pz * 18, 3);
        const rim = Math.max(0, 1 - Math.abs(c - 0.18) * 14);
        const pit = Math.max(0, 1 - Math.abs(c - 0.3) * 9);
        shade += preset.craters * (rim * 0.18 - pit * 0.3);
      }

      const i = (y * width + x) * 4;
      d[i] = clamp255((preset.base[0] + (t - 0.5) * preset.varr[0]) * shade);
      d[i + 1] = clamp255((preset.base[1] + (t - 0.5) * preset.varr[1]) * shade);
      d[i + 2] = clamp255((preset.base[2] + (t - 0.5) * preset.varr[2]) * shade);
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
