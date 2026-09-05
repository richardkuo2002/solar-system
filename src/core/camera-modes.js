// Camera/viewpoint state machine. Pure — no THREE/DOM imports. Computes a
// camera *pose* (position + look-at target + up, all plain {x,y,z}) from
// app state; render/camera-rig.js is the only file that applies this to an
// actual THREE.Camera. All 4 modes (HELIOCENTRIC_TOPDOWN, FREE_FLIGHT,
// SURFACE_FIRST_PERSON, GEOCENTRIC) are implemented.

import { compressSize } from './scale.js';
import { sub, normalize } from './vector3.js';
import { PLANETS } from '../data/planets.js';

export const CAMERA_MODES = Object.freeze({
  HELIOCENTRIC_TOPDOWN: 'heliocentric_topdown',
  SURFACE_FIRST_PERSON: 'surface_first_person',
  FREE_FLIGHT: 'free_flight',
  GEOCENTRIC: 'geocentric',
});

const TOPDOWN_HEIGHT = 140;

export function createCameraState(initialMode = CAMERA_MODES.HELIOCENTRIC_TOPDOWN) {
  return {
    mode: initialMode,
    focusBody: 'sun',
    freeFlight: { position: { x: 0, y: 20, z: 60 }, yaw: Math.PI, pitch: -0.2 },
    surface: { planet: 'earth', lat: 0, lon: 0 },
    geocentric: { focusBody: 'mars', yaw: 0, pitch: 0 },
  };
}

export function setMode(state, mode, options = {}) {
  if (!Object.values(CAMERA_MODES).includes(mode)) {
    throw new Error(`Unknown camera mode: ${mode}`);
  }
  const next = { ...state, mode };
  if (mode === CAMERA_MODES.SURFACE_FIRST_PERSON) {
    next.surface = { ...state.surface, ...options };
  }
  return next;
}

export function setFocusBody(state, bodyKey) {
  return { ...state, focusBody: bodyKey };
}

export function setSurfaceLocation(state, lat, lon) {
  return { ...state, surface: { ...state.surface, lat, lon } };
}

export function setSurfacePlanet(state, planetKey) {
  return { ...state, surface: { ...state.surface, planet: planetKey } };
}

/**
 * Switches into GEOCENTRIC mode, snapshotting the look direction toward
 * `focusBody` (as seen from Earth) *at this moment* into yaw/pitch. The
 * camera then tracks Earth's position every frame (see computePose) but
 * keeps looking in that same fixed world-space direction rather than
 * re-aiming at the target every frame — if the camera re-aimed continuously,
 * the target would always sit dead-center and could never visibly trace a
 * retrograde loop. With a fixed look direction, Earth's own motion plus the
 * target's motion make it drift across the view over the following months —
 * that drift, forward/pause/backward/forward, *is* the retrograde motion,
 * and it falls entirely out of the real orbital math already in this
 * project (no separate retrograde model). The user can also mouse-look
 * around from this fixed base direction (see camera-rig.js) to track it if
 * it drifts out of frame.
 */
export function enterGeocentric(state, bodyPositions, focusBody = 'mars') {
  const earthPos = bodyPositions.earth ?? { x: 0, y: 0, z: 0 };
  const targetPos = bodyPositions[focusBody] ?? bodyPositions.sun ?? { x: 0, y: 0, z: 0 };
  const dir = normalize(sub(targetPos, earthPos));
  const yaw = Math.atan2(dir.x, dir.z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  return { ...state, mode: CAMERA_MODES.GEOCENTRIC, geocentric: { focusBody, yaw, pitch } };
}

/** Pure — adjusts the geocentric look direction by mouse-drag deltas (no positional movement; position always tracks Earth). */
export function rotateGeocentricView(state, dYaw, dPitch) {
  const maxPitch = Math.PI / 2 - 0.01;
  return {
    ...state,
    geocentric: {
      ...state.geocentric,
      yaw: state.geocentric.yaw + dYaw,
      pitch: Math.max(-maxPitch, Math.min(maxPitch, state.geocentric.pitch + dPitch)),
    },
  };
}

const DEG_TO_RAD = Math.PI / 180;
const GLOBAL_UP = { x: 0, y: 1, z: 0 };

/**
 * Pose for standing on a sphere's surface at (lat, lon) looking straight up
 * (radially outward) into the sky. Doesn't model each planet's real axial
 * tilt — "north" is taken as the global scene up axis, a deliberate v1
 * simplification consistent with not modeling axial tilt anywhere else in
 * this project.
 *
 * `rotationRad` is the planet mesh's *current* `rotation.y` (see app.js's
 * updateAllPositions) — without it, (lat, lon) would be a fixed direction
 * in WORLD space, so as the planet mesh spins under the camera the ground
 * would slide out from under a "stationary" observer instead of the
 * observer staying planted on the same physical point as the planet turns
 * (which is what actually produces a day/night sky sweep). Subtracting it
 * from theta is the correct sign for three.js's rotation.y convention
 * (verified against THREE.Matrix4#makeRotationY: a fixed local-frame point
 * at longitude lon ends up, after rotating the mesh by R, at world theta =
 * lon - R) — get this backwards and the sky would sweep at DOUBLE the
 * correct rate instead of staying put.
 */
function surfacePose(planetPos, sceneRadius, lat, lon, rotationRad = 0) {
  const phi = (90 - lat) * DEG_TO_RAD; // colatitude from north pole
  const theta = lon * DEG_TO_RAD - rotationRad;
  const normal = {
    x: Math.sin(phi) * Math.cos(theta),
    y: Math.cos(phi),
    z: Math.sin(phi) * Math.sin(theta),
  };

  const position = {
    x: planetPos.x + normal.x * sceneRadius,
    y: planetPos.y + normal.y * sceneRadius,
    z: planetPos.z + normal.z * sceneRadius,
  };
  const target = { x: position.x + normal.x, y: position.y + normal.y, z: position.z + normal.z };

  // Tangent "north" direction for the up vector — GLOBAL_UP projected onto
  // the plane perpendicular to `normal`. Degenerates exactly at the poles
  // (normal parallel to GLOBAL_UP); fall back to an arbitrary tangent there.
  const dot = GLOBAL_UP.x * normal.x + GLOBAL_UP.y * normal.y + GLOBAL_UP.z * normal.z;
  let up = {
    x: GLOBAL_UP.x - dot * normal.x,
    y: GLOBAL_UP.y - dot * normal.y,
    z: GLOBAL_UP.z - dot * normal.z,
  };
  const upLen = Math.hypot(up.x, up.y, up.z);
  up = upLen < 1e-6 ? { x: 1, y: 0, z: 0 } : { x: up.x / upLen, y: up.y / upLen, z: up.z / upLen };

  return { position, target, up };
}

/** Pure, no side effects — pans/rotates the free-flight rig by pre-computed deltas. */
export function moveFreeFlight(state, { forward = 0, strafe = 0, vertical = 0, dYaw = 0, dPitch = 0 }) {
  const yaw = state.freeFlight.yaw + dYaw;
  const maxPitch = Math.PI / 2 - 0.01;
  const pitch = Math.max(-maxPitch, Math.min(maxPitch, state.freeFlight.pitch + dPitch));

  const forwardVec = facingVector(yaw, pitch);
  // Screen-right for THREE's lookAt (right = forward × up, since the camera
  // looks along -Z locally and target = position + forwardVec) — NOT
  // up × forward, which points the opposite way and was swapping A/D.
  const rightVec = { x: -Math.cos(yaw), y: 0, z: Math.sin(yaw) };

  const position = {
    x: state.freeFlight.position.x + forwardVec.x * forward + rightVec.x * strafe,
    y: state.freeFlight.position.y + forwardVec.y * forward + vertical,
    z: state.freeFlight.position.z + forwardVec.z * forward + rightVec.z * strafe,
  };

  return { ...state, freeFlight: { position, yaw, pitch } };
}

function facingVector(yaw, pitch) {
  return {
    x: Math.cos(pitch) * Math.sin(yaw),
    y: Math.sin(pitch),
    z: Math.cos(pitch) * Math.cos(yaw),
  };
}

/**
 * @param {object} state           camera-modes state (see createCameraState)
 * @param {object} bodyPositions   { [bodyKey]: {x,y,z} } in scene units (post-scale)
 * @param {object} bodyRotations   { [bodyKey]: radians } current mesh.rotation.y per planet (SURFACE_FIRST_PERSON only; every other mode ignores it)
 * @returns {{position: {x,y,z}, target: {x,y,z}, up: {x,y,z}}}
 */
export function computePose(state, bodyPositions, bodyRotations = {}) {
  switch (state.mode) {
    case CAMERA_MODES.HELIOCENTRIC_TOPDOWN: {
      const target = bodyPositions[state.focusBody] ?? { x: 0, y: 0, z: 0 };
      // World up (0,1,0), matching every other mode — NOT the horizontal
      // (0,0,-1) this used to be. OrbitControls decomposes camera position
      // into spherical coordinates around `up` as the pole axis; since this
      // camera sits directly above `target` (along world +Y), `up` must
      // also be world +Y for drag-to-orbit to behave normally (horizontal
      // drag = spin, vertical drag = tilt). A horizontal up like (0,0,-1)
      // put the camera at that spherical system's *equator* instead of its
      // pole, which swaps what horizontal/vertical dragging does — that's
      // what was making Top-Down mouse look reversed. lookAt still doesn't
      // degenerate here even though up is now near-parallel to the view
      // direction (straight down), because position.x's `+ 0.001` offset
      // below keeps them not-quite-parallel.
      return {
        position: { x: target.x + 0.001, y: TOPDOWN_HEIGHT, z: target.z },
        target,
        up: { x: 0, y: 1, z: 0 },
      };
    }
    case CAMERA_MODES.FREE_FLIGHT: {
      const { position, yaw, pitch } = state.freeFlight;
      const forwardVec = facingVector(yaw, pitch);
      return {
        position,
        target: { x: position.x + forwardVec.x, y: position.y + forwardVec.y, z: position.z + forwardVec.z },
        up: { x: 0, y: 1, z: 0 },
      };
    }
    case CAMERA_MODES.SURFACE_FIRST_PERSON: {
      const { planet, lat, lon } = state.surface;
      const planetPos = bodyPositions[planet] ?? { x: 0, y: 0, z: 0 };
      const sceneRadius = compressSize(PLANETS[planet].radiusKm);
      return surfacePose(planetPos, sceneRadius, lat, lon, bodyRotations[planet] ?? 0);
    }
    case CAMERA_MODES.GEOCENTRIC: {
      const earthPos = bodyPositions.earth ?? { x: 0, y: 0, z: 0 };
      const { yaw, pitch } = state.geocentric;
      const dir = facingVector(yaw, pitch);
      return {
        position: earthPos,
        target: { x: earthPos.x + dir.x, y: earthPos.y + dir.y, z: earthPos.z + dir.z },
        up: { x: 0, y: 1, z: 0 },
      };
    }
    default:
      throw new Error(`Unknown camera mode: ${state.mode}`);
  }
}
