import assert from 'node:assert/strict';
import { solveEccentricAnomaly, elementsToPosition } from '../src/core/kepler.js';
import {
  elementsAtDate, julianDateFromDate, circularOrbitAngle, moonLocalPosition,
} from '../src/core/orbital-elements.js';
import { compressDistance, compressSize, compressPosition, compressMoonOrbit } from '../src/core/scale.js';
import { PLANETS, PLANET_ORDER } from '../src/data/planets.js';
import { MOONS, MOON_ORDER } from '../src/data/moons.js';
import {
  createTimeController, tick, play, pause, setSpeed, reverse, jumpToDate,
} from '../src/core/time-controller.js';
import {
  createCameraState, setMode, setFocusBody, setSurfaceLocation, setSurfacePlanet,
  moveFreeFlight, computePose, CAMERA_MODES,
} from '../src/core/camera-modes.js';

// kepler: eccentric anomaly solver satisfies Kepler's equation
{
  const M = 1.0, e = 0.2;
  const E = solveEccentricAnomaly(M, e);
  assert.ok(Math.abs((E - e * Math.sin(E)) - M) < 1e-5);
}

// kepler: circular orbit (e=0) puts body at exactly `a` AU from focus
{
  const pos = elementsToPosition({ a: 1, e: 0, i: 0, om: 0, w: 0, meanAnomalyRad: 0 });
  const r = Math.hypot(pos.x, pos.y, pos.z);
  assert.ok(Math.abs(r - 1) < 1e-6);
}

// orbital-elements: every v1 planet produces a finite, non-degenerate
// position at both J2000 and today
{
  const dates = [julianDateFromDate(new Date('2000-01-01T12:00:00Z')), julianDateFromDate(new Date())];
  for (const key of PLANET_ORDER) {
    for (const jd of dates) {
      const els = elementsAtDate(PLANETS[key].elements, jd);
      const pos = elementsToPosition(els);
      assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z), `${key} produced a non-finite position`);
      assert.ok(Math.hypot(pos.x, pos.y, pos.z) > 0, `${key} collapsed to the origin`);
    }
  }
}

// scale: compressDistance/compressSize are monotonic
{
  assert.ok(compressDistance(1) < compressDistance(5));
  assert.ok(compressDistance(0.387) < compressDistance(30.07)); // Mercury < Neptune, by AU
  assert.ok(compressSize(2439.7) < compressSize(69911)); // Mercury < Jupiter, by radius
}

// scale: compressPosition preserves direction and handles negative axes
// (a naive per-axis Math.pow would NaN on negative coordinates)
{
  const pos = compressPosition({ x: -3, y: 4, z: 0 }); // r = 5
  assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z));
  assert.ok(pos.x < 0 && pos.y > 0 && pos.z === 0, 'compressPosition should preserve sign/direction');
  const origin = compressPosition({ x: 0, y: 0, z: 0 });
  assert.deepEqual(origin, { x: 0, y: 0, z: 0 });
}

// time-controller: play/pause/speed/reverse/jump math
{
  let s = createTimeController({ startDate: new Date('2026-01-01T00:00:00Z'), speedDaysPerSecond: 1 });
  s = play(s);
  s = tick(s, 10); // 10 real seconds -> 10 simulated days
  assert.equal(s.currentDate.toISOString().slice(0, 10), '2026-01-11');

  s = pause(s);
  const before = s.currentDate.getTime();
  s = tick(s, 10);
  assert.equal(s.currentDate.getTime(), before, 'paused tick must be a no-op');

  s = play(s);
  s = setSpeed(s, 2);
  s = tick(s, 1); // 1 real second at 2 days/sec -> +2 days
  assert.equal(s.currentDate.toISOString().slice(0, 10), '2026-01-13');

  s = reverse(s);
  const beforeReverse = s.currentDate.getTime();
  s = tick(s, 1);
  assert.ok(s.currentDate.getTime() < beforeReverse, 'reverse should move currentDate backward');

  s = jumpToDate(s, new Date('2000-01-01T00:00:00Z'));
  assert.equal(s.currentDate.getUTCFullYear(), 2000);
  assert.equal(s.speedDaysPerSecond, 2, 'jumpToDate must not disturb speed');
}

// scale: compressMoonOrbit is monotonic in orbitKm and always clears the
// parent's own scene radius (a moon must never render inside its parent)
{
  const parentRadiusKm = 69911; // Jupiter
  const parentSceneRadius = compressSize(parentRadiusKm);
  const rIo = compressMoonOrbit(421700, parentRadiusKm, parentSceneRadius);
  const rCallisto = compressMoonOrbit(1882709, parentRadiusKm, parentSceneRadius);
  assert.ok(rIo > parentSceneRadius, 'Io must render outside Jupiter');
  assert.ok(rCallisto > rIo, 'Callisto orbits farther out than Io');
}

// orbital-elements: circularOrbitAngle wraps to [0, 2*PI) and completes one
// full revolution after exactly one period
{
  const angleHalf = circularOrbitAngle(13.66, 27.32); // half of the Moon's period
  assert.ok(Math.abs(angleHalf - Math.PI) < 1e-6);
  const angleFull = circularOrbitAngle(27.32, 27.32);
  assert.ok(Math.abs(angleFull) < 1e-6 || Math.abs(angleFull - 2 * Math.PI) < 1e-6);
}

// orbital-elements: moonLocalPosition produces a finite position, at the
// correct distance from the parent, for every v1 moon
{
  const jd = julianDateFromDate(new Date());
  for (const key of MOON_ORDER) {
    const moonData = MOONS[key];
    const parentRadiusKm = PLANETS[moonData.parent].radiusKm;
    const parentSceneRadius = compressSize(parentRadiusKm);
    const pos = moonLocalPosition(moonData, parentRadiusKm, parentSceneRadius, jd, jd - 1000);
    assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.z));
    const r = Math.hypot(pos.x, pos.z);
    assert.ok(r > parentSceneRadius, `${key} must render outside its parent ${moonData.parent}`);
  }
}

// camera-modes: default mode + pose shape for heliocentric top-down
{
  const state = createCameraState();
  assert.equal(state.mode, CAMERA_MODES.HELIOCENTRIC_TOPDOWN);
  const bodyPositions = { sun: { x: 0, y: 0, z: 0 }, earth: { x: 20, y: 0, z: 0 } };
  const pose = computePose(state, bodyPositions);
  assert.ok('position' in pose && 'target' in pose && 'up' in pose);
  assert.deepEqual(pose.target, bodyPositions.sun);
}

// camera-modes: setFocusBody changes the top-down target
{
  let state = createCameraState();
  state = setFocusBody(state, 'earth');
  const bodyPositions = { sun: { x: 0, y: 0, z: 0 }, earth: { x: 20, y: 0, z: 0 } };
  const pose = computePose(state, bodyPositions);
  assert.deepEqual(pose.target, bodyPositions.earth);
}

// camera-modes: free-flight movement is pure and moves along facing direction
{
  let state = setMode(createCameraState(), CAMERA_MODES.FREE_FLIGHT);
  const before = state.freeFlight.position;
  state = moveFreeFlight(state, { forward: 5, strafe: 0, vertical: 0, dYaw: 0, dPitch: 0 });
  const after = state.freeFlight.position;
  assert.notDeepEqual(before, after, 'forward movement should change position');
  const pose = computePose(state, {});
  assert.deepEqual(pose.position, after);
}

// camera-modes: surface first-person places the camera on the sphere at the
// planet's position + its scene radius, looking straight outward
{
  let state = setMode(createCameraState(), CAMERA_MODES.SURFACE_FIRST_PERSON, { planet: 'earth' });
  state = setSurfaceLocation(state, 0, 0); // equator, prime meridian
  const bodyPositions = { earth: { x: 20, y: 0, z: 0 } };
  const pose = computePose(state, bodyPositions);
  const toCamera = {
    x: pose.position.x - bodyPositions.earth.x,
    y: pose.position.y - bodyPositions.earth.y,
    z: pose.position.z - bodyPositions.earth.z,
  };
  const distFromCenter = Math.hypot(toCamera.x, toCamera.y, toCamera.z);
  assert.ok(distFromCenter > 0, 'camera must sit above the planet center, not at it');
  // target should be farther from the planet center than the camera itself
  // (looking outward/up, not down at the surface)
  const targetDist = Math.hypot(
    pose.target.x - bodyPositions.earth.x,
    pose.target.y - bodyPositions.earth.y,
    pose.target.z - bodyPositions.earth.z
  );
  assert.ok(targetDist > distFromCenter, 'surface mode should look outward/up, not back at the planet');
  // up must not be parallel to the view direction (degenerate lookAt)
  const viewDir = { x: pose.target.x - pose.position.x, y: pose.target.y - pose.position.y, z: pose.target.z - pose.position.z };
  const viewLen = Math.hypot(viewDir.x, viewDir.y, viewDir.z);
  const upLen = Math.hypot(pose.up.x, pose.up.y, pose.up.z);
  const cosAngle = (viewDir.x * pose.up.x + viewDir.y * pose.up.y + viewDir.z * pose.up.z) / (viewLen * upLen);
  assert.ok(Math.abs(cosAngle) < 0.999, 'up vector must not be parallel to the view direction');
}

// camera-modes: setSurfacePlanet switches which body surface mode stands on
{
  let state = setSurfacePlanet(createCameraState(), 'mars');
  assert.equal(state.surface.planet, 'mars');
}

// camera-modes: geocentric (not yet implemented) fails loudly instead of returning a bogus pose
{
  const geoState = setMode(createCameraState(), CAMERA_MODES.GEOCENTRIC);
  assert.throws(() => computePose(geoState, {}));
}

console.log('PASS: smoke-test.js all assertions passed');
