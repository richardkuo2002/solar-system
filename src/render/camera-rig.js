// Owns the actual THREE.PerspectiveCamera + OrbitControls. The only file
// that touches THREE camera objects directly — everything else deals in
// plain {x,y,z} poses computed by core/camera-modes.js.
//
// Input handling (keyboard/mouse for free-flight) lives here rather than in
// core/ because it's inherently DOM/browser-specific; it just calls the
// pure core/camera-modes.js#moveFreeFlight with pre-computed deltas.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_MODES, moveFreeFlight, rotateGeocentricView, walkSurface, cycleGeocentricFocus } from '../core/camera-modes.js';

const MOVE_SPEED = 15; // scene units / second
const MOUSE_SENSITIVITY = 0.0025;

/** Clamp a scalar to [-1, 1] — used to combine keyboard's discrete ±1 with the touch joystick's continuous axis without either alone exceeding full speed. */
function clamp11(x) {
  return Math.max(-1, Math.min(1, x));
}
// Top-down's view spans much farther (Pluto/comets sit ~200+ scene units
// out) than free-flight's walking-speed feel, so panning needs a faster
// constant to feel responsive at that scale.
const TOPDOWN_PAN_SPEED = 60; // scene units / second
const SURFACE_WALK_SPEED_DEG_PER_SEC = 15; // stylized "walking" rate, not tied to any planet's real size

// v1.8.6 — see the keydown listener below for why this exists.
function isTypingIntoFormField(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable === true;
}

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
  // GEOCENTRIC's WASD is a discrete "pick the next/previous body" action,
  // not a continuous move — queued here (+1/-1 per keypress) and drained
  // once per frame by updateGeocentricCycle, rather than read from
  // `keysDown` like the continuous-movement modes. `e.repeat` is ignored so
  // holding a key doesn't rapid-fire through the whole planet list.
  let pendingCycleDirections = [];
  // v0.10 touch input — a continuous analog vector from the on-screen
  // joystick (render/touch-controls.js), combined with keyboard's discrete
  // ±1 via clamp11 in the update* methods below so keyboard and touch both
  // work at once, neither excluding the other.
  let touchMoveVector = { x: 0, y: 0 };
  // v1.7 — Free-flight's vertical (Q/E) axis, the one movement axis v0.10's
  // touch controls left without an equivalent (documented known limit,
  // docs/ROADMAP.md). Continuous like touchMoveVector, not a discrete
  // per-tap value: render/touch-controls.js's up/down buttons hold this at
  // +-1 while pressed and reset it to 0 on release.
  let touchVertical = 0;

  window.addEventListener('keydown', (e) => {
    // v1.8.6 — this listener is on `window` (so WASD works without the
    // canvas needing focus, since it has none — see camera-rig.js's own
    // history), which means it also fires while a form field elsewhere on
    // the page has focus. Typing "-96.7970" into the Observer Mode
    // longitude field would walk the surface camera at the same time,
    // since W/A/S/D are all real letters/characters someone might type.
    if (isTypingIntoFormField(e.target)) return;
    keysDown.add(e.code);
    if (e.repeat) return;
    if (e.code === 'KeyD' || e.code === 'KeyW') pendingCycleDirections.push(1);
    else if (e.code === 'KeyA' || e.code === 'KeyS') pendingCycleDirections.push(-1);
  });
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
      // Drop any cycle presses queued while in a different mode — switching
      // INTO geocentric shouldn't immediately replay stale WASD taps from
      // whatever mode you were just in.
      pendingCycleDirections = [];
      touchMoveVector = { x: 0, y: 0 };
      touchVertical = 0;
    },

    /** v0.10 — the on-screen joystick calls this continuously while dragging (and resets to {0,0} on release). */
    setTouchMoveVector(x, y) {
      touchMoveVector = { x, y };
    },

    /** v1.7 — the on-screen up/down buttons call this on press/release (+1/-1/0), same accumulator pattern as setTouchMoveVector. */
    setTouchVertical(v) {
      touchVertical = v;
    },

    /** v0.10 — the on-screen look-drag zone calls this with deltas scaled the same way mouse-drag already is; feeds the same accumulator updateFreeFlight/updateGeocentricLook already drain per-frame. */
    addLookDelta(dYaw, dPitch) {
      pendingYaw += dYaw;
      pendingPitch += dPitch;
    },

    /** v0.10 — the on-screen Prev/Next buttons call this; feeds the same queue WASD-tap already pushes into. */
    pushCycleDirection(direction) {
      pendingCycleDirections.push(direction);
    },

    applyPose(pose) {
      camera.position.set(pose.position.x, pose.position.y, pose.position.z);
      camera.up.set(pose.up.x, pose.up.y, pose.up.z);
      camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    },

    /** Reads accumulated WASD/QE + mouse-drag input and returns the next cameraState (pure moveFreeFlight underneath). */
    updateFreeFlight(cameraState, deltaSeconds) {
      const forward = clamp11(((keysDown.has('KeyW') ? 1 : 0) - (keysDown.has('KeyS') ? 1 : 0)) + touchMoveVector.y) * MOVE_SPEED * deltaSeconds;
      const strafe = clamp11(((keysDown.has('KeyD') ? 1 : 0) - (keysDown.has('KeyA') ? 1 : 0)) + touchMoveVector.x) * MOVE_SPEED * deltaSeconds;
      const vertical = clamp11(((keysDown.has('KeyE') ? 1 : 0) - (keysDown.has('KeyQ') ? 1 : 0)) + touchVertical) * MOVE_SPEED * deltaSeconds;
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

    /**
     * WASD "walks" SURFACE_FIRST_PERSON's (lat, lon) — a discrete change to
     * where the fixed observation point sits on the planet, not a free-fly
     * move (pure walkSurface underneath).
     */
    updateSurfaceWalk(cameraState, deltaSeconds) {
      const dLatDeg = clamp11(((keysDown.has('KeyW') ? 1 : 0) - (keysDown.has('KeyS') ? 1 : 0)) + touchMoveVector.y) * SURFACE_WALK_SPEED_DEG_PER_SEC * deltaSeconds;
      const dLonDeg = clamp11(((keysDown.has('KeyD') ? 1 : 0) - (keysDown.has('KeyA') ? 1 : 0)) + touchMoveVector.x) * SURFACE_WALK_SPEED_DEG_PER_SEC * deltaSeconds;
      if (!dLatDeg && !dLonDeg) return cameraState;
      return walkSurface(cameraState, { dLatDeg, dLonDeg });
    },

    /**
     * WASD pans HELIOCENTRIC_TOPDOWN's orbit-around point — a new "where
     * am I looking from" starting point for OrbitControls' drag-to-orbit,
     * not a free-fly move. Moves camera position and orbitControls.target
     * by the same delta (screen-relative to the camera's current yaw, so
     * panning "up" always means "away from camera" regardless of how far
     * you've dragged/rotated the view) so the current zoom/rotation offset
     * between them is preserved exactly — this lives entirely outside the
     * pure camera-modes.js state machine, same as OrbitControls' own
     * drag-to-orbit already does for this mode.
     */
    updateTopDownPan(deltaSeconds) {
      const forwardInput = (keysDown.has('KeyW') ? 1 : 0) - (keysDown.has('KeyS') ? 1 : 0);
      const strafeInput = (keysDown.has('KeyD') ? 1 : 0) - (keysDown.has('KeyA') ? 1 : 0);
      if (!forwardInput && !strafeInput) return;
      const forwardVec = new THREE.Vector3();
      camera.getWorldDirection(forwardVec);
      forwardVec.y = 0;
      if (forwardVec.lengthSq() < 1e-8) forwardVec.set(0, 0, -1); // near-straight-down edge case
      forwardVec.normalize();
      const rightVec = new THREE.Vector3().crossVectors(forwardVec, camera.up).normalize();
      const speed = TOPDOWN_PAN_SPEED * deltaSeconds;
      const delta = new THREE.Vector3()
        .addScaledVector(forwardVec, forwardInput * speed)
        .addScaledVector(rightVec, strafeInput * speed);
      camera.position.add(delta);
      orbitControls.target.add(delta);
    },

    /**
     * Drains any queued WASD cycle presses (see the keydown listener above)
     * and applies each as a GEOCENTRIC focus-body switch, in order — the
     * pure cycleGeocentricFocus underneath re-snapshots the look direction
     * exactly like first entering the mode.
     */
    updateGeocentricCycle(cameraState, bodyPositions, candidateKeys) {
      if (pendingCycleDirections.length === 0) return cameraState;
      const directions = pendingCycleDirections;
      pendingCycleDirections = [];
      return directions.reduce(
        (state, direction) => cycleGeocentricFocus(state, bodyPositions, candidateKeys, direction),
        cameraState
      );
    },
  };
}
