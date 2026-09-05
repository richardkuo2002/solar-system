// The 88 constellations' traditional line figures, overlaid on the real
// star catalog (star-catalog.js / starfield.js) — see docs/ROADMAP.md's
// v1.2 closeout. Same camera-recentered-shell pattern as starfield.js and
// scene-setup.js#createMilkyWaySkySphere, sitting at the same radius as
// the star points so lines visually meet the stars they connect.
import * as THREE from 'three';
import { constellationLineSegments } from '../core/star-catalog.js';
import { STAR_SHELL_RADIUS } from './starfield.js';

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`fetch ${path} failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Builds the constellation-line segments as one THREE.LineSegments mesh.
 * Dim and non-depth-writing so it reads as a faint overlay rather than
 * competing with the star points themselves.
 */
export async function createConstellationLines() {
  const linesGeoJson = await fetchJson('assets/stars/constellations.lines.json');
  const segmentPositions = constellationLineSegments(linesGeoJson);

  const scaled = new Float32Array(segmentPositions.length);
  for (let i = 0; i < segmentPositions.length; i++) scaled[i] = segmentPositions[i] * STAR_SHELL_RADIUS;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(scaled, 3));

  const material = new THREE.LineBasicMaterial({
    color: 0x445566,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });

  const lines = new THREE.LineSegments(geometry, material);

  return {
    lines,
    /** Recenter on the camera every frame, same as the other two sky layers. */
    update(camera) {
      lines.position.copy(camera.position);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
