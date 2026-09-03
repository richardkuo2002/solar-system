// Owns the actual THREE.PerspectiveCamera + OrbitControls. The only file
// that touches THREE camera objects directly — everything else deals in
// plain {x,y,z} poses computed by core/camera-modes.js.
//
// Input handling (keyboard/mouse for free-flight) lives here rather than in
// core/ because it's inherently DOM/browser-specific; it just calls the
// pure core/camera-modes.js#moveFreeFlight with pre-computed deltas.
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_MODES, moveFreeFlight, rotateGeocentricView } from '../core/camera-modes.js';

const MOVE_SPEED = 15; // scene units / second
const MOUSE_SENSITIVITY = 0.0025;

export function createCameraRig(camera, domElement) {
  const orbitControls = new OrbitControls(camera, domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;

  const keysDown = new Set();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pendingYaw = 0;
  let pendingPitch = 0;

  window.addEventListener('keydown', (e) => keysDown.add(e.code));
  window.addEventListener('keyup', (e) => keysDown.delete(e.code));
  domElement.addEventListener('mousedown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    pendingYaw -= (e.clientX - lastX) * MOUSE_SENSITIVITY;
    pendingPitch -= (e.clientY - lastY) * MOUSE_SENSITIVITY;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  return {
    orbitControls,

    /** Enable OrbitControls only for modes where free user rotation/zoom around a fixed target makes sense. */
    setMode(mode) {
      orbitControls.enabled = mode === CAMERA_MODES.HELIOCENTRIC_TOPDOWN;
    },

    applyPose(pose) {
      camera.position.set(pose.position.x, pose.position.y, pose.position.z);
      camera.up.set(pose.up.x, pose.up.y, pose.up.z);
      camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    },

    /** Reads accumulated WASD/QE + mouse-drag input and returns the next cameraState (pure moveFreeFlight underneath). */
    updateFreeFlight(cameraState, deltaSeconds) {
      const forward = ((keysDown.has('KeyW') ? 1 : 0) - (keysDown.has('KeyS') ? 1 : 0)) * MOVE_SPEED * deltaSeconds;
      const strafe = ((keysDown.has('KeyD') ? 1 : 0) - (keysDown.has('KeyA') ? 1 : 0)) * MOVE_SPEED * deltaSeconds;
      const vertical = ((keysDown.has('KeyE') ? 1 : 0) - (keysDown.has('KeyQ') ? 1 : 0)) * MOVE_SPEED * deltaSeconds;
      const dYaw = pendingYaw;
      const dPitch = pendingPitch;
      pendingYaw = 0;
      pendingPitch = 0;
      return moveFreeFlight(cameraState, { forward, strafe, vertical, dYaw, dPitch });
    },

    /** Reads accumulated mouse-drag input (position is not user-controlled — it always tracks Earth) and returns the next cameraState. */
    updateGeocentricLook(cameraState) {
      const dYaw = pendingYaw;
      const dPitch = pendingPitch;
      pendingYaw = 0;
      pendingPitch = 0;
      return rotateGeocentricView(cameraState, dYaw, dPitch);
    },
  };
}
