// Mouse-hover name tooltip for planets/moons/Sun. Plain raycasting against
// a fixed set of meshes + a single floating <div>, updated on mousemove
// only (not every frame) — cheap enough that no throttling is needed.
import * as THREE from 'three';

export function createHoverLabels(canvas, camera, pickables) {
  const el = document.createElement('div');
  el.className = 'hover-label';
  el.hidden = true;
  document.body.appendChild(el);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

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
    } else {
      el.hidden = true;
    }
  });

  canvas.addEventListener('mouseleave', () => { el.hidden = true; });
}
