import assert from 'node:assert/strict';
import { solveEccentricAnomaly, elementsToPosition } from '../src/core/kepler.js';
import { elementsAtDate, julianDateFromDate } from '../src/core/orbital-elements.js';
import { compressDistance, compressSize, compressPosition } from '../src/core/scale.js';
import { PLANETS, PLANET_ORDER } from '../src/data/planets.js';
import {
  createTimeController, tick, play, pause, setSpeed, reverse, jumpToDate,
} from '../src/core/time-controller.js';
import {
  createCameraState, setMode, setFocusBody, moveFreeFlight, computePose, CAMERA_MODES,
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

// camera-modes: unimplemented modes fail loudly instead of returning a bogus pose
{
  const surfaceState = setMode(createCameraState(), CAMERA_MODES.SURFACE_FIRST_PERSON);
  assert.throws(() => computePose(surfaceState, {}));
  const geoState = setMode(createCameraState(), CAMERA_MODES.GEOCENTRIC);
  assert.throws(() => computePose(geoState, {}));
}

console.log('PASS: smoke-test.js all assertions passed');
