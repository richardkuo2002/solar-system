// Elongation angle (Sun-observer-target angle) — the shared geometry
// primitive behind v0.5's opposition/conjunction and greatest-elongation
// event types. Pure math, zero DOM/THREE, Node-testable like core/.

import { sub, dot, length } from '../core/vector3.js';

function clampCos(v) {
  return Math.min(1, Math.max(-1, v));
}

/**
 * Unsigned elongation — the angle between the observer's line of sight to
 * the Sun and its line of sight to the target — in radians, [0, π]. For
 * an outer planet this is 0° at conjunction (behind the Sun) and 180° at
 * opposition (opposite the Sun); for an inner planet it's bounded well
 * below 180° (the greatest-elongation maximum).
 */
export function elongationRad(targetState, observerState, sunState) {
  const toSun = sub(sunState.positionAu, observerState.positionAu);
  const toTarget = sub(targetState.positionAu, observerState.positionAu);
  return Math.acos(clampCos(dot(toSun, toTarget) / (length(toSun) * length(toTarget))));
}

/**
 * Angular separation between two arbitrary bodies as seen from a third
 * (v1.4, for planet-planet appulses) — structurally identical to
 * elongationRad above (its "sunState" slot is really just "the other
 * body"), given an honest name for call sites where neither body is the
 * Sun.
 */
export function angularSeparationAtObserver(stateA, observerState, stateB) {
  return elongationRad(stateA, observerState, stateB);
}

/**
 * Signed elongation for inner planets: positive = east of the Sun (evening
 * sky, sets after the Sun), negative = west (morning sky, rises before the
 * Sun). Sign comes from the z-component of (observer→Sun) × (observer→
 * target) in the ecliptic (x,y) plane — the same handedness as
 * geocentricEclipticLongitudeRad's atan2(y,x) convention (positive z-cross
 * means target is ahead of the Sun in the direction of increasing ecliptic
 * longitude, i.e. east).
 */
export function signedElongationRad(targetState, observerState, sunState) {
  const unsigned = elongationRad(targetState, observerState, sunState);
  const toSun = sub(sunState.positionAu, observerState.positionAu);
  const toTarget = sub(targetState.positionAu, observerState.positionAu);
  const crossZ = toSun.x * toTarget.y - toSun.y * toTarget.x;
  return crossZ >= 0 ? unsigned : -unsigned;
}
