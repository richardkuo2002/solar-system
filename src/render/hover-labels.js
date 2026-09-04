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
}
