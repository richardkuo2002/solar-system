// Lazy texture loading: every body starts showing a small (~512px preview,
// or a procedural texture for the 3 bodies with no real file — see
// ATTRIBUTION.md) image instantly, and upgrades to its full-resolution
// texture only when `ensureFull` is actually called for it (hover, focus,
// surface-mode selection, or the idle background queue app.js runs after
// startup). A small LRU cap keeps at most a handful of full textures
// resident in VRAM at once; the rest fall back to their still-cached
// preview when evicted.
import * as THREE from 'three';
import { TEXTURES, previewPath } from '../data/textures.js';
import { hasRealTextureFile } from '../core/texture-resolution.js';
import { proceduralMap } from './procedural-textures.js';

const MAX_RESIDENT_FULL_TEXTURES = 10;

export async function initTextureLoader(renderer) {
  const manifest = await fetch('assets/textures/manifest.json')
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));

  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loader = new THREE.TextureLoader();

  const previewCache = new Map(); // textureKey -> Texture
  const fullCache = new Map(); // textureKey -> Texture
  const consumers = new Map(); // textureKey -> Set<{ material, property }>
  const lruOrder = []; // textureKey, most-recently-used at the end

  function configure(texture, { colorSpace }) {
    // NoColorSpace is '' (falsy) — `if (colorSpace)` would silently skip
    // it. Harmless today since three.js's own default is already
    // NoColorSpace, but checking !== undefined makes the intent explicit.
    if (colorSpace !== undefined) texture.colorSpace = colorSpace;
    texture.anisotropy = maxAnisotropy;
    return texture;
  }

  function touchLru(textureKey) {
    const idx = lruOrder.indexOf(textureKey);
    if (idx !== -1) lruOrder.splice(idx, 1);
    lruOrder.push(textureKey);
    while (lruOrder.length > MAX_RESIDENT_FULL_TEXTURES) {
      evict(lruOrder.shift());
    }
  }

  function evict(textureKey) {
    const full = fullCache.get(textureKey);
    if (!full) return;
    fullCache.delete(textureKey);
    full.dispose();
    const preview = previewCache.get(textureKey);
    for (const { material, property } of consumers.get(textureKey) ?? []) {
      material[property] = preview ?? null;
      material.needsUpdate = true;
    }
  }

  /**
   * Immediate texture for a body: the real preview if a full file exists
   * per the manifest, otherwise a procedural texture (nothing to upgrade
   * to later, in that case — see ensureFull).
   */
  function getInitial(bodyKey, textureKey, { proceduralPalette, colorSpace = THREE.SRGBColorSpace } = {}) {
    const path = TEXTURES[textureKey];
    if (!hasRealTextureFile(manifest, path)) {
      return configure(proceduralMap(bodyKey, proceduralPalette), { colorSpace });
    }
    if (previewCache.has(textureKey)) return previewCache.get(textureKey);
    const tex = configure(loader.load(previewPath(path)), { colorSpace });
    previewCache.set(textureKey, tex);
    return tex;
  }

  /** Starts (once) loading the full-resolution texture for `textureKey` and swaps it into `material[property]` when ready. No-op if there's no real file. */
  function ensureFull(textureKey, material, { property = 'map', colorSpace = THREE.SRGBColorSpace } = {}) {
    const path = TEXTURES[textureKey];
    if (!hasRealTextureFile(manifest, path)) return;

    if (!consumers.has(textureKey)) consumers.set(textureKey, new Set());
    consumers.get(textureKey).add({ material, property });

    if (fullCache.has(textureKey)) {
      material[property] = fullCache.get(textureKey);
      material.needsUpdate = true;
      touchLru(textureKey);
      return;
    }

    loader.load(path, (tex) => {
      configure(tex, { colorSpace });
      fullCache.set(textureKey, tex);
      touchLru(textureKey);
      for (const { material: m, property: p } of consumers.get(textureKey) ?? []) {
        m[p] = tex;
        m.needsUpdate = true;
      }
    });
  }

  return { getInitial, ensureFull, manifest };
}
