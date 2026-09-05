// Constellation name labels — screen-space DOM overlay, not 3D sprites, so
// text always reads flat/crisp regardless of camera distance (same
// tradeoff hover-labels.js already makes for the mouse-hover tooltip; this
// is that same idea applied to a fixed set of always-on labels instead of
// one that follows the cursor). Only the ~22 rank-1 constellations get a
// label (see core/star-catalog.js#constellationLabelPositions) — labeling
// all 88 would recreate the exact clutter this was added to fix.
import * as THREE from 'three';
import { constellationLabelPositions } from '../core/star-catalog.js';
import { STAR_SHELL_RADIUS } from './starfield.js';

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`fetch ${path} failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Builds one absolutely-positioned <div> per major constellation inside a
 * single fixed, pointer-events:none container (so labels never intercept
 * mouse/touch input meant for the 3D scene).
 */
export async function createConstellationLabels() {
  const constellationsGeoJson = await fetchJson('assets/stars/constellations.json');
  const labels = constellationLabelPositions(constellationsGeoJson);

  const container = document.createElement('div');
  container.className = 'constellation-labels';
  document.body.appendChild(container);

  const entries = labels.map(({ name, x, y, z }) => {
    const el = document.createElement('div');
    el.className = 'constellation-label';
    el.textContent = name;
    el.hidden = true;
    container.appendChild(el);
    return { el, dir: new THREE.Vector3(x, y, z) };
  });

  const worldPos = new THREE.Vector3();
  const projected = new THREE.Vector3();

  return {
    /** Projects each label's fixed sky direction to screen space every frame — same camera-recentered-shell idea as the other two sky layers, just resolved in 2D DOM coordinates instead of moving a 3D mesh. */
    update(camera) {
      const width = window.innerWidth;
      const height = window.innerHeight;
      for (const { el, dir } of entries) {
        worldPos.copy(dir).multiplyScalar(STAR_SHELL_RADIUS).add(camera.position);
        projected.copy(worldPos).project(camera);
        if (projected.z > 1 || projected.z < -1) {
          el.hidden = true; // behind the camera
          continue;
        }
        el.hidden = false;
        el.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
        el.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
      }
    },
    dispose() {
      container.remove();
    },
  };
}
