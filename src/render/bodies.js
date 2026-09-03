// Builds planet meshes and orbit-path lines from src/data/planets.js.
// Step 2: flat colors, no textures/lighting yet (MeshBasicMaterial) — swaps
// to MeshStandardMaterial + textures + a Sun light in step 5.
import * as THREE from 'three';
import { elementsAtDate } from '../core/orbital-elements.js';
import { elementsToPosition } from '../core/kepler.js';
import { compressPosition, compressSize } from '../core/scale.js';

/** Sphere mesh for one planet, sized via scale.js. Position set per-frame by the caller. */
export function buildPlanetMesh(planetData) {
  const radius = compressSize(planetData.radiusKm);
  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  const material = new THREE.MeshBasicMaterial({ color: planetData.color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = planetData.name;
  return mesh;
}

/**
 * Precomputed closed orbit-path line, sampled at `segments` evenly spaced
 * mean anomalies at the *current* (not time-varying) osculating elements —
 * a display-only approximation of the orbit shape, doesn't itself move.
 */
export function buildOrbitPath(baseElements, julianDate, segments = 256) {
  const els = elementsAtDate(baseElements, julianDate);
  const points = [];
  for (let s = 0; s <= segments; s++) {
    const meanAnomalyRad = (s / segments) * 2 * Math.PI;
    const pos = elementsToPosition({ ...els, meanAnomalyRad });
    const scenePos = compressPosition(pos);
    // ecliptic z (out-of-plane) -> scene up
    points.push(new THREE.Vector3(scenePos.x, scenePos.z, scenePos.y));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: 0x555566 });
  return new THREE.LineLoop(geometry, material);
}

/** Heliocentric ecliptic {x,y,z} (AU) -> scene {x,y,z}, with compression applied. */
export function toScenePosition(auPosition) {
  const scenePos = compressPosition(auPosition);
  // ecliptic z (out-of-plane) -> scene up
  return { x: scenePos.x, y: scenePos.z, z: scenePos.y };
}
