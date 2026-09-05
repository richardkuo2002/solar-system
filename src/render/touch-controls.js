// Mobile touch controls (v0.10) — a virtual joystick (movement), a
// look-drag zone (camera rotation), and Prev/Next buttons (Geocentric's
// focus-cycle), all feeding into camera-rig.js's existing input
// accumulators (setTouchMoveVector/addLookDelta/pushCycleDirection) —
// same code path keyboard/mouse already drain every frame, no duplicate
// state and no core/ changes. Top-Down mode gets no new touch code at all:
// OrbitControls (already in use) has built-in touch support (one-finger
// rotate, two-finger pinch/pan) that already covers everything WASD-pan +
// mouse-drag-orbit give it on desktop.
import { CAMERA_MODES } from '../core/camera-modes.js';

const JOYSTICK_MAX_RADIUS_PX = 45;
// Matches camera-rig.js's MOUSE_SENSITIVITY so touch-drag-to-look and
// mouse-drag-to-look feel the same for a given screen-pixel movement.
const TOUCH_LOOK_SENSITIVITY = 0.0025;

const MOVE_MODES = new Set([CAMERA_MODES.FREE_FLIGHT, CAMERA_MODES.SURFACE_FIRST_PERSON]);
const LOOK_MODES = new Set([CAMERA_MODES.FREE_FLIGHT, CAMERA_MODES.GEOCENTRIC]);

/** Pure — clamps a 2D vector to the unit circle (joystick deadzone-free radial clamp). */
function clampToUnitCircle(x, y) {
  const dist = Math.hypot(x, y);
  if (dist <= 1) return { x, y };
  return { x: x / dist, y: y / dist };
}

function findTouch(touchList, identifier) {
  for (const t of touchList) if (t.identifier === identifier) return t;
  return null;
}

/**
 * @param {HTMLElement} container appended to (e.g. #ui-root)
 * @param {HTMLElement} canvas the render canvas — look-drag listens here
 * @param {object} cameraRig from render/camera-rig.js
 * @returns {{setMode(mode: string): void}}
 */
export function createTouchControls(container, canvas, cameraRig) {
  // Only build touch UI where it's actually useful — zero DOM/listeners on
  // a mouse-only desktop. Known v1 limitation: (pointer: coarse) reflects
  // the PRIMARY pointer, so a touchscreen laptop with a mouse as primary
  // won't show these controls even though touch technically works.
  if (!window.matchMedia?.('(pointer: coarse)').matches) {
    return { setMode() {} };
  }

  let currentMode = null;

  // --- Joystick (movement: Free-flight forward/strafe, Surface lat/lon walk) ---
  const joystickBase = document.createElement('div');
  joystickBase.className = 'touch-joystick-base';
  const joystickStick = document.createElement('div');
  joystickStick.className = 'touch-joystick-stick';
  joystickBase.appendChild(joystickStick);
  joystickBase.hidden = true;
  container.appendChild(joystickBase);

  let joystickTouchId = null;
  let joystickBaseRect = null;

  function updateJoystick(touch) {
    const cx = joystickBaseRect.left + joystickBaseRect.width / 2;
    const cy = joystickBaseRect.top + joystickBaseRect.height / 2;
    const { x, y } = clampToUnitCircle(
      (touch.clientX - cx) / JOYSTICK_MAX_RADIUS_PX,
      (touch.clientY - cy) / JOYSTICK_MAX_RADIUS_PX
    );
    joystickStick.style.transform = `translate(${x * JOYSTICK_MAX_RADIUS_PX}px, ${y * JOYSTICK_MAX_RADIUS_PX}px)`;
    // Screen-down (+y) must mean "backward"/"south", matching W/S's sign in
    // camera-rig.js's updateFreeFlight/updateSurfaceWalk — hence the flip.
    cameraRig.setTouchMoveVector(x, -y);
  }

  function resetJoystick() {
    joystickTouchId = null;
    joystickStick.style.transform = 'translate(0, 0)';
    cameraRig.setTouchMoveVector(0, 0);
  }

  joystickBase.addEventListener('touchstart', (event) => {
    if (joystickTouchId !== null) return;
    const t = event.changedTouches[0];
    joystickTouchId = t.identifier;
    joystickBaseRect = joystickBase.getBoundingClientRect();
    updateJoystick(t);
  }, { passive: true });

  window.addEventListener('touchmove', (event) => {
    if (joystickTouchId === null) return;
    const t = findTouch(event.changedTouches, joystickTouchId);
    if (t) updateJoystick(t);
  }, { passive: true });

  window.addEventListener('touchend', (event) => {
    if (findTouch(event.changedTouches, joystickTouchId)) resetJoystick();
  }, { passive: true });
  window.addEventListener('touchcancel', (event) => {
    if (findTouch(event.changedTouches, joystickTouchId)) resetJoystick();
  }, { passive: true });

  // --- Look-drag zone (Free-flight/Geocentric camera rotation) ---
  // Listens on the canvas itself, not a separate overlay div — a touch
  // starting on the joystick or the cycle buttons below never reaches this
  // listener at all (they're separate DOM elements; the browser targets
  // whichever element is actually under the finger), so no manual
  // hit-testing against those widgets' bounds is needed here.
  let lookTouchId = null;
  let lastLookX = 0;
  let lastLookY = 0;

  canvas.addEventListener('touchstart', (event) => {
    if (!LOOK_MODES.has(currentMode) || lookTouchId !== null) return;
    const t = event.changedTouches[0];
    lookTouchId = t.identifier;
    lastLookX = t.clientX;
    lastLookY = t.clientY;
  }, { passive: true });

  canvas.addEventListener('touchmove', (event) => {
    if (lookTouchId === null) return;
    const t = findTouch(event.changedTouches, lookTouchId);
    if (!t) return;
    const dYaw = -(t.clientX - lastLookX) * TOUCH_LOOK_SENSITIVITY;
    const dPitch = -(t.clientY - lastLookY) * TOUCH_LOOK_SENSITIVITY;
    lastLookX = t.clientX;
    lastLookY = t.clientY;
    cameraRig.addLookDelta(dYaw, dPitch);
  }, { passive: true });

  function endLookTouch(event) {
    if (findTouch(event.changedTouches, lookTouchId)) lookTouchId = null;
  }
  canvas.addEventListener('touchend', endLookTouch, { passive: true });
  canvas.addEventListener('touchcancel', endLookTouch, { passive: true });

  // --- Prev/Next buttons (Geocentric's WASD-cycle equivalent) ---
  const cycleButtons = document.createElement('div');
  cycleButtons.className = 'touch-cycle-buttons';
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '◀';
  prevBtn.addEventListener('click', () => cameraRig.pushCycleDirection(-1));
  const nextBtn = document.createElement('button');
  nextBtn.textContent = '▶';
  nextBtn.addEventListener('click', () => cameraRig.pushCycleDirection(1));
  cycleButtons.append(prevBtn, nextBtn);
  cycleButtons.hidden = true;
  container.appendChild(cycleButtons);

  return {
    setMode(mode) {
      currentMode = mode;
      joystickBase.hidden = !MOVE_MODES.has(mode);
      cycleButtons.hidden = mode !== CAMERA_MODES.GEOCENTRIC;
      if (!MOVE_MODES.has(mode)) resetJoystick();
      // Don't fight a live drag mid-switch, just stop recognizing new ones.
      if (!LOOK_MODES.has(mode)) lookTouchId = null;
    },
  };
}
