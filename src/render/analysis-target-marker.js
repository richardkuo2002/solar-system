// Screen-space marker pointing at the Event Toolkit's currently analyzed
// body — v1.8.1, Surface Mode only. Surface Mode's sky proxies
// (app.js#applySurfaceSkyProxies) place every other planet at its own
// true angular size/direction, often floored to a ~1.5px dot
// (MIN_PROXY_PIXEL_RADIUS) indistinguishable from any other faint point —
// this was the "can't tell what's going on" report. Reuses
// constellation-labels.js's screen-space projection technique (a
// world-space position -> DOM left/top), not a second line-of-sight line:
// the existing line-of-sight visual (render/retrograde-los-line.js) is
// built from Earth-to-target COMPRESSED scenePositions, which point in a
// different direction than Surface Mode's true-angular-direction proxies
// (see docs/accuracy.md's Surface Mode section) — app.js hides that line
// in Surface Mode instead of drawing something actively misleading.
import * as THREE from 'three';

/**
 * @returns {{ setLabel(text:string):void, update(camera:THREE.Camera, object3d:THREE.Object3D|null):void, dispose():void }}
 */
export function createAnalysisTargetMarker() {
  const el = document.createElement('div');
  el.className = 'analysis-target-marker';
  el.hidden = true;
  document.body.appendChild(el);

  const worldPos = new THREE.Vector3();
  const projected = new THREE.Vector3();

  return {
    setLabel(text) {
      el.textContent = text;
    },
    /**
     * @param {THREE.Camera} camera
     * @param {THREE.Object3D|null} object3d  the analyzed body's proxy
     *   object (e.g. `planetGroups[key]`) to point at this frame, or null
     *   to hide the marker (not in Surface Mode, no active analysis, or
     *   the analyzed body has no scene-space proxy — e.g. the Moon).
     */
    update(camera, object3d) {
      if (!object3d) {
        el.hidden = true;
        return;
      }
      object3d.getWorldPosition(worldPos);
      projected.copy(worldPos).project(camera);
      if (projected.z > 1 || projected.z < -1) {
        el.hidden = true; // behind the camera
        return;
      }
      el.hidden = false;
      el.style.left = `${(projected.x * 0.5 + 0.5) * window.innerWidth}px`;
      el.style.top = `${(-projected.y * 0.5 + 0.5) * window.innerHeight}px`;
    },
    dispose() {
      el.remove();
    },
  };
}
