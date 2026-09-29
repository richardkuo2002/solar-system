// Event Toolkit apparent-path trail (v1.13) — the analyzed target's path
// across the result's series, drawn into the main 3D scene so it's visible
// alongside the existing lineOfSight line, not just the small 2D chart
// canvas (drawApparentPathCanvas in event-charts.js). Modeled on
// createLineOfSightLine (retrograde-los-line.js) for the returned-object
// idiom, but point count varies per analysis result, so geometry is
// rebuilt via setFromPoints (same construction buildOrbitPath uses for
// static orbit rings, src/render/bodies.js) rather than mutating a
// fixed-size buffer.
import * as THREE from 'three';

const TRAIL_COLOR = 0xffaa33; // distinct from lineOfSight's 0x6cf (same hex the 2D chart's PATH_COLOR uses)

/**
 * @param {THREE.Scene} scene
 * @returns {{ setPoints(points: {x,y,z}[]): void, dispose(): void, line: THREE.Line }}
 */
export function createAnalysisTrail(scene) {
  const material = new THREE.LineBasicMaterial({ color: TRAIL_COLOR, transparent: true, opacity: 0.85 });
  const trail = { line: new THREE.Line(new THREE.BufferGeometry(), material) };
  trail.line.name = 'Event Toolkit: analysis apparent-path trail';
  trail.line.visible = false; // only shown once an analysis with a scene position has run
  scene.add(trail.line);

  trail.setPoints = (points) => {
    scene.remove(trail.line);
    trail.line.geometry.dispose();
    trail.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, p.y, p.z))),
      material,
    );
    trail.line.name = 'Event Toolkit: analysis apparent-path trail';
    scene.add(trail.line);
  };

  trail.dispose = () => {
    scene.remove(trail.line);
    trail.line.geometry.dispose();
    material.dispose();
  };

  return trail;
}
