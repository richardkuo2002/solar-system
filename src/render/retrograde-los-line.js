// Earth-to-Mars line-of-sight line — visual block 1 of the Retrograde Lab
// (see docs/ROADMAP.md's v0.4 spec). Drawn into the existing main scene
// rather than a second camera/renderer: this codebase has zero
// multi-viewport precedent, and "Earth/Mars orbiting normally + a visible
// line-of-sight" is fully satisfiable this way. Best viewed in
// Heliocentric or Free-flight camera mode — see README limitations.
import * as THREE from 'three';

/**
 * @param {THREE.Scene} scene
 * @returns {{ update(earthScenePos: {x,y,z}, marsScenePos: {x,y,z}): void, dispose(): void, line: THREE.Line }}
 */
export function createLineOfSightLine(scene) {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0),
  ]);
  const material = new THREE.LineBasicMaterial({ color: 0x6cf, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geometry, material);
  line.name = 'Retrograde Lab: Earth-Mars line-of-sight';
  line.visible = false; // only shown once the panel has run an analysis
  scene.add(line);

  function update(earthScenePos, marsScenePos) {
    const positions = geometry.attributes.position;
    positions.setXYZ(0, earthScenePos.x, earthScenePos.y, earthScenePos.z);
    positions.setXYZ(1, marsScenePos.x, marsScenePos.y, marsScenePos.z);
    positions.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  function dispose() {
    scene.remove(line);
    geometry.dispose();
    material.dispose();
  }

  return { update, dispose, line };
}
