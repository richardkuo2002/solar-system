// Builds planet/moon meshes, the Sun, and orbit-path lines from
// src/data/planets.js / moons.js / textures.js.
import * as THREE from 'three';
import { elementsAtDate } from '../core/orbital-elements.js';
import { elementsToPosition } from '../core/kepler.js';
import { compressPosition, compressSize, SUN_SIZE_CAP } from '../core/scale.js';
import { TEXTURES } from '../data/textures.js';

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

function loadTexture(textureKey) {
  const url = TEXTURES[textureKey];
  if (!url) return null;
  if (!textureCache.has(textureKey)) {
    textureCache.set(textureKey, textureLoader.load(url));
  }
  return textureCache.get(textureKey);
}

/** Sphere mesh for a planet/moon: real texture if one exists for its textureKey, flat color otherwise. */
function buildBodyMesh(bodyData, { unlit = false } = {}) {
  const radius = compressSize(bodyData.radiusKm);
  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  const map = loadTexture(bodyData.textureKey);
  const materialOptions = map ? { map } : { color: bodyData.color };
  const material = unlit
    ? new THREE.MeshBasicMaterial(materialOptions)
    : new THREE.MeshStandardMaterial(materialOptions);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = bodyData.name;
  return mesh;
}

/** Sphere mesh for one planet, sized via scale.js. Position set per-frame by the caller. */
export function buildPlanetMesh(planetData) {
  return buildBodyMesh(planetData);
}

/**
 * Sun mesh (unlit — it's the light source, not something lit by one) + the
 * PointLight it casts. Radius is explicitly capped (SUN_SIZE_CAP) rather
 * than going through the same curve as planets: the Sun's true relative
 * size would dominate/obscure the whole scene even after compression.
 */
export function buildSun(sunData) {
  const radius = Math.min(compressSize(sunData.radiusKm), SUN_SIZE_CAP);
  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  const map = loadTexture(sunData.textureKey);
  const materialOptions = map ? { map } : { color: sunData.color };
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial(materialOptions));
  mesh.name = sunData.name;
  const light = new THREE.PointLight(0xffffff, 3, 0, 0); // no distance-based falloff cutoff, kept simple for v1
  return { mesh, light };
}

/**
 * Moon mesh, sized via scale.js like a planet. Its local position each
 * frame comes from core/orbital-elements.js#moonLocalPosition — app.js adds
 * this mesh to the parent planet's THREE.Group, so it inherits the
 * parent's world position for free.
 */
export function buildMoonMesh(moonData) {
  return buildBodyMesh(moonData);
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
