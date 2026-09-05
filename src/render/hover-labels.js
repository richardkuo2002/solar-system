// Mouse-hover name tooltip for planets/moons/Sun. Plain raycasting against
// a fixed set of meshes + a single floating <div>, updated on mousemove
// only (not every frame) — cheap enough that no throttling is needed.
import * as THREE from 'three';

/**
 * @param {(mesh: THREE.Object3D) => void} [onHover] — fired once per newly
 * hovered body (not every mousemove tick) — app.js uses this to trigger
 * that body's full-resolution texture load (see render/texture-loader.js).
 * @param {(mesh: THREE.Object3D) => void} [onSelect] — fired on click when
 * a body is currently hovered — app.js uses this to update the selected
 * body (ephemeris HUD, camera focus). Same raycast, no extra work.
 */
export function createHoverLabels(canvas, camera, pickables, onHover, onSelect) {
  const el = document.createElement('div');
  el.className = 'hover-label';
  el.hidden = true;
  document.body.appendChild(el);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let lastHovered = null;

  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObjects(pickables, false);
    if (hit) {
      el.textContent = hit.object.name;
      el.style.left = `${event.clientX + 14}px`;
      el.style.top = `${event.clientY + 14}px`;
      el.hidden = false;
      if (hit.object !== lastHovered) {
        lastHovered = hit.object;
        onHover?.(hit.object);
      }
    } else {
      el.hidden = true;
      lastHovered = null;
    }
  });

  canvas.addEventListener('mouseleave', () => { el.hidden = true; });
  canvas.addEventListener('click', () => {
    if (lastHovered) onSelect?.(lastHovered);
  });

  // v0.10 — touch tap-to-select. There's no touchscreen equivalent of
  // mousemove-before-click, so `lastHovered` is never set by a tap alone;
  // this raycasts directly at the tap position instead, independent of
  // hover state. Distinguishes a tap from a drag (camera look/joystick,
  // see render/touch-controls.js) purely by movement distance + duration —
  // this listener and touch-controls.js's own listeners on the same canvas
  // don't interfere, since neither calls stopPropagation.
  const TAP_MOVE_THRESHOLD_PX = 12;
  const TAP_MAX_DURATION_MS = 500;
  let touchStart = null;

  canvas.addEventListener('touchstart', (event) => {
    const t = event.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY, time: performance.now() };
  }, { passive: true });

  canvas.addEventListener('touchend', (event) => {
    if (!touchStart) return;
    const t = event.changedTouches[0];
    const moved = Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y);
    const elapsed = performance.now() - touchStart.time;
    touchStart = null;
    if (moved > TAP_MOVE_THRESHOLD_PX || elapsed > TAP_MAX_DURATION_MS) return; // a drag, not a tap

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((t.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((t.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObjects(pickables, false);
    if (hit) onSelect?.(hit.object);
  }, { passive: true });
}
