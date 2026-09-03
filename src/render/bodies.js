// Builds planet/moon meshes, the Sun, and orbit-path lines from
// src/data/planets.js / moons.js / textures.js. Texture loading itself goes
// through render/texture-loader.js (preview-first, lazy full-res upgrade,
// procedural fallback for bodies with no real file) — every exported
// builder here takes the initialized loader as a parameter rather than
// managing its own texture cache.
import * as THREE from 'three';
import { elementsAtDate } from '../core/orbital-elements.js';
import { elementsToPosition } from '../core/kepler.js';
import { compressPosition, compressSize, SUN_SIZE_CAP } from '../core/scale.js';

/**
 * Sphere mesh for a planet/moon. `textureLoader.getInitial` always returns
 * a usable Texture now (a real preview, or a procedural one) — `bodyData.
 * color` is no longer applied as a material tint on top of it (it would
 * double up with the procedural palette's own coloring, or wash out a real
 * photo); it stays purely a fallback value for anything that reads
 * `bodyData.color` directly outside rendering (there isn't one currently).
 */
function buildBodyMesh(bodyData, textureLoader, { unlit = false } = {}) {
  const radius = compressSize(bodyData.radiusKm);
  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  const map = textureLoader.getInitial(bodyData.name, bodyData.textureKey, { proceduralPalette: bodyData.proceduralPalette });
  const materialOptions = { map };

  if (bodyData.nightTextureKey) {
    materialOptions.emissiveMap = textureLoader.getInitial(bodyData.name, bodyData.nightTextureKey, { colorSpace: THREE.SRGBColorSpace });
    materialOptions.emissive = new THREE.Color(0xffffff);
    materialOptions.emissiveIntensity = 1.2;
  }

  const material = unlit
    ? new THREE.MeshBasicMaterial(materialOptions)
    : new THREE.MeshStandardMaterial(materialOptions);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = bodyData.name;
  return mesh;
}

/** Sphere mesh for one planet, sized via scale.js. Position set per-frame by the caller. */
export function buildPlanetMesh(planetData, textureLoader) {
  return buildBodyMesh(planetData, textureLoader);
}

/**
 * Sun mesh (unlit — it's the light source, not something lit by one) + the
 * PointLight it casts. Radius is explicitly capped (SUN_SIZE_CAP) rather
 * than going through the same curve as planets: the Sun's true relative
 * size would dominate/obscure the whole scene even after compression.
 */
export function buildSun(sunData, textureLoader) {
  const radius = Math.min(compressSize(sunData.radiusKm), SUN_SIZE_CAP);
  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  const map = textureLoader.getInitial(sunData.name, sunData.textureKey, {});
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map }));
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
export function buildMoonMesh(moonData, textureLoader) {
  return buildBodyMesh(moonData, textureLoader);
}

/**
 * Translucent shell (~1.01x the body's radius) for a cloud layer (Earth) or
 * haze layer (Venus) over its surface map — a second sphere with an alpha
 * map, not baked into the surface material, so it can be lazily upgraded
 * independently. No independent rotation from the base mesh for v1 — it
 * tilts/spins with whatever group its caller adds it into alongside the
 * base mesh, skipped as a deliberate simplification (add a slower/opposite
 * rotation.y increment on this mesh specifically if independent cloud drift
 * is wanted later).
 */
export function buildAtmosphereShell(bodyData, textureKey, textureLoader, { opacity = 0.55 } = {}) {
  const radius = compressSize(bodyData.radiusKm) * 1.01;
  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  const alphaMap = textureLoader.getInitial(bodyData.name, textureKey, { colorSpace: THREE.NoColorSpace });
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, alphaMap, transparent: true, depthWrite: false, opacity,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${bodyData.name} Atmosphere`;
  return mesh;
}

// Real-world km, not scaled by compressSize's planet-radius curve tuning —
// close enough for a v1 visual (main rings: C through A, skipping the
// fainter/wider F-and-beyond rings).
const SATURN_RING_INNER_KM = 74500;
const SATURN_RING_OUTER_KM = 136800;

/**
 * Saturn's ring, as a flat annulus using the same compressSize() curve as
 * body radii (a real-world km measurement, same order of magnitude as a
 * planet radius) so it scales consistently with Saturn's own compressed
 * size. RingGeometry's default UVs aren't radial, which stretches a
 * radial-gradient texture badly — remapped here so U runs outward from the
 * inner to the outer edge instead.
 */
export function buildSaturnRing(planetData, textureLoader) {
  const innerRadius = compressSize(SATURN_RING_INNER_KM);
  const outerRadius = compressSize(SATURN_RING_OUTER_KM);
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 64, 1);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const v3 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    const radialT = (v3.length() - innerRadius) / (outerRadius - innerRadius);
    uv.setXY(i, radialT, 1);
  }
  const map = textureLoader.getInitial('Saturn Ring', 'saturnRing', {});
  const material = new THREE.MeshBasicMaterial({
    map, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2; // lie flat in the scene's XZ (equatorial) plane
  mesh.name = `${planetData.name} Ring`;
  return mesh;
}

/**
 * Precomputed closed orbit-path line, sampled at `segments` evenly spaced
 * mean anomalies at the *current* (not time-varying) osculating elements —
 * a display-only approximation of the orbit shape, doesn't itself move.
 */
export function buildOrbitPath(baseElements, julianDate, segments = 256, color = 0x555566) {
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
  const material = new THREE.LineBasicMaterial({ color });
  return new THREE.LineLoop(geometry, material);
}

/** Heliocentric ecliptic {x,y,z} (AU) -> scene {x,y,z}, with compression applied. */
export function toScenePosition(auPosition) {
  const scenePos = compressPosition(auPosition);
  // ecliptic z (out-of-plane) -> scene up
  return { x: scenePos.x, y: scenePos.z, z: scenePos.y };
}
