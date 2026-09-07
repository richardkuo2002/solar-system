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

// v1.11.3 risk audit — this cap only ever bounded the *opportunistically*
// loaded bodies (hover, idle background queue). The 5 keys app.js loads
// eagerly at startup (Sun; Earth's map/night/clouds; the Moon) shared the
// same LRU accounting, so once the idle queue had touched 10 other bodies,
// eviction would silently demote Earth or the Moon back to a 512px
// preview — directly contradicting the "always loads full-res
// immediately" comments at each eager call site. Eager loads now `pin`
// (see ensureFull below) instead of competing for LRU slots at all; the
// cap here still bounds everything else.
const MAX_RESIDENT_FULL_TEXTURES = 10;

export async function initTextureLoader(renderer) {
  const manifest = await fetch('assets/textures/manifest.json')
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));

  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loader = new THREE.TextureLoader();

  const previewCache = new Map(); // textureKey -> Texture
  const fullCache = new Map(); // textureKey -> Texture
  // v1.11.3 — was `Set<{material,property}>`, but each `ensureFull` call
  // built a fresh object literal, so the Set's reference-identity dedup
  // never actually deduped anything: re-hovering the same body kept
  // appending an equivalent-but-distinct entry forever. A plain array
  // with an explicit equality check on add is small (a handful of real
  // consumers per texture key) and correct.
  const consumers = new Map(); // textureKey -> Array<{ material, property }>
  const lruOrder = []; // textureKey, most-recently-used at the end
  const pinned = new Set(); // textureKey — exempt from LRU eviction entirely
  const inFlight = new Set(); // textureKey — a loader.load() is already pending

  function configure(texture, { colorSpace }) {
    // NoColorSpace is '' (falsy) — `if (colorSpace)` would silently skip
    // it. Harmless today since three.js's own default is already
    // NoColorSpace, but checking !== undefined makes the intent explicit.
    if (colorSpace !== undefined) texture.colorSpace = colorSpace;
    texture.anisotropy = maxAnisotropy;
    return texture;
  }

  function addConsumer(textureKey, material, property) {
    if (!consumers.has(textureKey)) consumers.set(textureKey, []);
    const list = consumers.get(textureKey);
    if (!list.some((c) => c.material === material && c.property === property)) {
      list.push({ material, property });
    }
  }

  function touchLru(textureKey) {
    if (pinned.has(textureKey)) return;
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

  /**
   * Starts (once) loading the full-resolution texture for `textureKey` and
   * swaps it into `material[property]` when ready. No-op if there's no
   * real file. `pin: true` (used by app.js's eager Sun/Earth/Moon loads)
   * exempts this key from LRU eviction for the rest of the session.
   *
   * v1.11.3 risk audit — `inFlight` guards against a second `loader.load`
   * starting for a key that's already loading (re-hovering a body before
   * its first load finishes used to start a second, redundant GPU decode,
   * with the first one's result silently discarded and never disposed —
   * a leak). It also happens to close a related race: without it, two
   * overlapping loads could resolve out of order, so a slow *first* load
   * finishing *after* the key had already been evicted (by activity in
   * between) would silently resurrect it, bypassing the eviction. With at
   * most one load in flight per key, that interleaving can't happen.
   */
  function ensureFull(textureKey, material, { property = 'map', colorSpace = THREE.SRGBColorSpace, pin = false } = {}) {
    const path = TEXTURES[textureKey];
    if (!hasRealTextureFile(manifest, path)) return;

    if (pin) pinned.add(textureKey);
    addConsumer(textureKey, material, property);

    if (fullCache.has(textureKey)) {
      material[property] = fullCache.get(textureKey);
      material.needsUpdate = true;
      touchLru(textureKey);
      return;
    }

    if (inFlight.has(textureKey)) return; // the pending load's callback already covers every registered consumer, including this one just added
    inFlight.add(textureKey);

    loader.load(
      path,
      (tex) => {
        inFlight.delete(textureKey);
        configure(tex, { colorSpace });
        fullCache.set(textureKey, tex);
        touchLru(textureKey);
        for (const { material: m, property: p } of consumers.get(textureKey) ?? []) {
          m[p] = tex;
          m.needsUpdate = true;
        }
      },
      undefined,
      () => {
        // Without this, a failed load left `inFlight` permanently set for
        // this key — every future ensureFull call would silently no-op
        // forever instead of retrying, worse than having no guard at all.
        inFlight.delete(textureKey);
      },
    );
  }

  return { getInitial, ensureFull, manifest };
}
