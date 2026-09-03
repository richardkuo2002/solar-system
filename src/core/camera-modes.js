// Camera/viewpoint state machine. Pure — no THREE/DOM imports. Computes a
// camera *pose* (position + look-at target + up, all plain {x,y,z}) from
// app state; render/camera-rig.js is the only file that applies this to an
// actual THREE.Camera.
//
// Step 4 implements HELIOCENTRIC_TOPDOWN and FREE_FLIGHT. SURFACE_FIRST_PERSON
// (step 6) and GEOCENTRIC (step 8) throw a clear "not implemented yet" error
// so a mistaken early wire-up fails loudly instead of returning a bogus pose.

import { compressSize } from './scale.js';
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

const DEG_TO_RAD = Math.PI / 180;
const GLOBAL_UP = { x: 0, y: 1, z: 0 };

/**
 * Pose for standing on a sphere's surface at (lat, lon) looking straight up
 * (radially outward) into the sky. Doesn't model each planet's real axial
 * tilt — "north" is taken as the global scene up axis, a deliberate v1
 * simplification consistent with not modeling axial tilt anywhere else in
 * this project.
 */
function surfacePose(planetPos, sceneRadius, lat, lon) {
  const phi = (90 - lat) * DEG_TO_RAD; // colatitude from north pole
  const theta = lon * DEG_TO_RAD;
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
  const rightVec = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };

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
 * @returns {{position: {x,y,z}, target: {x,y,z}, up: {x,y,z}}}
 */
export function computePose(state, bodyPositions) {
  switch (state.mode) {
    case CAMERA_MODES.HELIOCENTRIC_TOPDOWN: {
      const target = bodyPositions[state.focusBody] ?? { x: 0, y: 0, z: 0 };
      return {
        position: { x: target.x + 0.001, y: TOPDOWN_HEIGHT, z: target.z },
        target,
        up: { x: 0, y: 0, z: -1 },
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
      return surfacePose(planetPos, sceneRadius, lat, lon);
    }
    case CAMERA_MODES.GEOCENTRIC:
      throw new Error('GEOCENTRIC pose is not implemented until build step 8');
    default:
      throw new Error(`Unknown camera mode: ${state.mode}`);
  }
}
