// Static asteroid belt between Mars (~1.5 AU) and Jupiter (~5.2 AU) —
// visual texture, not simulated bodies. A single THREE.Points draw call for
// thousands of rocks (per docs/ROADMAP.md's own draw-call concern), with
// positions randomized once at build time and never updated per-frame:
// a static scatter already reads as "asteroid belt" at a glance, and real
// per-rock orbital motion would need per-instance Kepler updates every
// frame for a purely decorative effect nobody would notice moving.
import * as THREE from 'three';
import { compressDistance } from '../core/scale.js';

const INNER_AU = 2.1;
const OUTER_AU = 3.3;
const COUNT = 3000;

export function buildAsteroidBelt(count = COUNT) {
  const positions = new Float32Array(count * 3);
  for (let idx = 0; idx < count; idx++) {
    const auDist = INNER_AU + Math.random() * (OUTER_AU - INNER_AU);
    const angle = Math.random() * Math.PI * 2;
    const r = compressDistance(auDist);
    const height = (Math.random() - 0.5) * r * 0.03; // thin vertical scatter, not a flat disc
    positions[idx * 3] = r * Math.cos(angle);
    positions[idx * 3 + 1] = height;
    positions[idx * 3 + 2] = r * Math.sin(angle);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0x8a8578, size: 0.06, sizeAttenuation: true });
  const points = new THREE.Points(geometry, material);
  points.name = 'Asteroid Belt';
  return points;
}
