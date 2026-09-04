import assert from 'node:assert/strict';
import { solveEccentricAnomaly, elementsToPosition, normalizeAngle } from '../src/core/kepler.js';
import {
  elementsAtDate, julianDateFromDate, circularOrbitAngle, moonLocalPosition,
  elementsVelocity, sampleOrbitPath,
} from '../src/core/orbital-elements.js';
import { compressDistance, compressSize, compressPosition, compressMoonOrbit } from '../src/core/scale.js';
import { PLANETS, PLANET_ORDER } from '../src/data/planets.js';
import { MOONS, MOON_ORDER } from '../src/data/moons.js';
import { COMETS, COMET_ORDER } from '../src/data/comets.js';
import { DWARF_PLANETS, DWARF_PLANET_ORDER, CHARON } from '../src/data/dwarf-planets.js';
import { hasRealTextureFile } from '../src/core/texture-resolution.js';
import { parseVectorsBlock, HorizonsUnavailableError } from '../src/core/horizons-client.js';
import { getBodyState, sunBodyState, isHorizonsAvailable, resetCircuitBreaker } from '../src/core/ephemeris.js';
import { createBodyState } from '../src/core/body-state.js';
import {
  createTimeController, tick, play, pause, setSpeed, reverse, jumpToDate,
} from '../src/core/time-controller.js';
import {
  createCameraState, setMode, setFocusBody, setSurfaceLocation, setSurfacePlanet,
  moveFreeFlight, enterGeocentric, rotateGeocentricView, computePose, CAMERA_MODES,
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

// kepler: high-eccentricity mean anomaly converges too (comet-like orbits,
// not just the near-circular planet case above)
{
  const M = 1.0, e = 0.9;
  const E = solveEccentricAnomaly(M, e);
  assert.ok(Math.abs((E - e * Math.sin(E)) - M) < 1e-5);
}

// kepler: normalizeAngle wraps negative/large input into [0, 2*PI)
{
  const a = normalizeAngle(-Math.PI / 2);
  assert.ok(a >= 0 && a < 2 * Math.PI);
  assert.ok(Math.abs(a - (3 * Math.PI / 2)) < 1e-9);
  const b = normalizeAngle(5 * Math.PI);
  assert.ok(b >= 0 && b < 2 * Math.PI);
  assert.ok(Math.abs(b - Math.PI) < 1e-9);
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

// orbital-elements: julianDateFromDate is a correct J2000 epoch anchor —
// the one numeric-correctness check (vs. finiteness) on this function
{
  const jd = julianDateFromDate(new Date('2000-01-01T12:00:00Z'));
  assert.equal(jd, 2451545.0, 'J2000.0 must map to exactly JD 2451545.0');
}

// orbital-elements: elementsVelocity is finite and non-degenerate for
// every planet — mirrors the position-finiteness block above, new function
{
  const jd = julianDateFromDate(new Date());
  for (const key of PLANET_ORDER) {
    const v = elementsVelocity(PLANETS[key].elements, jd);
    assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z), `${key} produced a non-finite velocity`);
    assert.ok(Math.hypot(v.x, v.y, v.z) > 0, `${key} has zero velocity`);
  }
}

// orbital-elements: sampleOrbitPath returns a finite, closed loop —
// segments+1 points, first and last coincide (mean anomaly 0 and 2*PI)
{
  const jd = julianDateFromDate(new Date());
  const points = sampleOrbitPath(PLANETS.earth.elements, jd, 8);
  assert.equal(points.length, 9);
  for (const p of points) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  }
  const first = points[0], last = points[points.length - 1];
  assert.ok(Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6 && Math.abs(first.z - last.z) < 1e-6, 'orbit loop must close');
}

// orbital-elements: comets produce a finite, non-degenerate position too —
// same code path as planets, just with a highly eccentric/inclined orbit,
// so this is really testing that the shared math doesn't assume e<<1 or i<90°
{
  const dates = [julianDateFromDate(new Date('2000-01-01T12:00:00Z')), julianDateFromDate(new Date())];
  for (const key of COMET_ORDER) {
    for (const jd of dates) {
      const els = elementsAtDate(COMETS[key].elements, jd);
      const pos = elementsToPosition(els);
      assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z), `${key} produced a non-finite position`);
      const r = Math.hypot(pos.x, pos.y, pos.z);
      assert.ok(r > 0, `${key} collapsed to the origin`);
      // perihelion/aphelion bounds: a(1-e) <= r <= a(1+e)
      const { a, e } = COMETS[key].elements;
      assert.ok(r >= a[0] * (1 - e[0]) - 1e-6 && r <= a[0] * (1 + e[0]) + 1e-6, `${key} distance outside its orbit's perihelion/aphelion bounds`);
    }
  }
}

// orbital-elements: dwarf planets (Pluto) also produce a finite,
// non-degenerate position at both J2000 and today — same code path as
// planets, table values just have a much larger inclination
{
  const dates = [julianDateFromDate(new Date('2000-01-01T12:00:00Z')), julianDateFromDate(new Date())];
  for (const key of DWARF_PLANET_ORDER) {
    for (const jd of dates) {
      const els = elementsAtDate(DWARF_PLANETS[key].elements, jd);
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

// orbital-elements: Charon (Pluto's moon) produces a finite position
// outside Pluto's own scene radius, same helper regular moons use
{
  const jd = julianDateFromDate(new Date());
  const plutoData = DWARF_PLANETS.pluto;
  const parentSceneRadius = compressSize(plutoData.radiusKm);
  const pos = moonLocalPosition(CHARON, plutoData.radiusKm, parentSceneRadius, jd, jd - 1000);
  assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.z));
  assert.ok(Math.hypot(pos.x, pos.z) > parentSceneRadius, 'Charon must render outside Pluto');
}

// texture-resolution: hasRealTextureFile is a pure manifest lookup — true
// only when the manifest has a truthy entry for the path's filename, false
// for a missing path, an absent manifest entry, or a falsy one (a body
// whose fetch failed and fell back to procedural)
{
  const manifest = { '2k_earth_daymap.jpg': { body: 'earth' }, 'callisto.jpg': false };
  assert.equal(hasRealTextureFile(manifest, 'assets/textures/2k_earth_daymap.jpg'), true);
  assert.equal(hasRealTextureFile(manifest, 'assets/textures/callisto.jpg'), false);
  assert.equal(hasRealTextureFile(manifest, 'assets/textures/pluto.jpg'), false, 'no manifest entry at all');
  assert.equal(hasRealTextureFile(manifest, undefined), false, 'no textureKey at all (procedural-only body)');
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

// camera-modes: geocentric camera always tracks Earth's position, and the
// initial look direction (from enterGeocentric) points at the chosen body
{
  const bodyPositions = { earth: { x: 20, y: 0, z: 0 }, mars: { x: 30, y: 0, z: 0 } };
  let state = enterGeocentric(createCameraState(), bodyPositions, 'mars');
  assert.equal(state.geocentric.focusBody, 'mars');

  const pose = computePose(state, bodyPositions);
  assert.deepEqual(pose.position, bodyPositions.earth, 'geocentric camera position must be exactly Earth');

  // Mars is due +x from Earth here, so the initial look direction should
  // point mostly along +x too (dot product with (1,0,0) close to 1).
  const dir = { x: pose.target.x - pose.position.x, y: pose.target.y - pose.position.y, z: pose.target.z - pose.position.z };
  const dirLen = Math.hypot(dir.x, dir.y, dir.z);
  assert.ok(dir.x / dirLen > 0.99, 'initial geocentric look direction should point toward the focus body');
}

// camera-modes: geocentric look direction is fixed across a position update
// (doesn't re-aim at the target every frame) but does respond to explicit
// mouse-look deltas — this fixed-direction behavior is *the* mechanism that
// lets retrograde motion show up as real drift instead of the camera
// tracking the target and hiding it dead-center every frame
{
  const bodyPositions = { earth: { x: 20, y: 0, z: 0 }, mars: { x: 30, y: 0, z: 0 } };
  let state = enterGeocentric(createCameraState(), bodyPositions, 'mars');
  const poseBefore = computePose(state, bodyPositions);

  // Earth moves (simulating a later frame); mars stays put; no explicit rotate call.
  const laterBodyPositions = { earth: { x: 20, y: 0, z: 5 }, mars: { x: 30, y: 0, z: 0 } };
  const poseAfterMove = computePose(state, laterBodyPositions);
  const dirBefore = { x: poseBefore.target.x - poseBefore.position.x, y: poseBefore.target.y - poseBefore.position.y, z: poseBefore.target.z - poseBefore.position.z };
  const dirAfterMove = { x: poseAfterMove.target.x - poseAfterMove.position.x, y: poseAfterMove.target.y - poseAfterMove.position.y, z: poseAfterMove.target.z - poseAfterMove.position.z };
  assert.ok(
    Math.abs(dirBefore.x - dirAfterMove.x) < 1e-9 &&
    Math.abs(dirBefore.y - dirAfterMove.y) < 1e-9 &&
    Math.abs(dirBefore.z - dirAfterMove.z) < 1e-9,
    'look direction must not change just because bodies moved'
  );
  assert.deepEqual(poseAfterMove.position, laterBodyPositions.earth, 'position must still track the new Earth position');

  // Now an explicit mouse-look delta should change the direction.
  state = rotateGeocentricView(state, 0.3, 0.1);
  const poseAfterRotate = computePose(state, bodyPositions);
  const dirAfterRotate = { x: poseAfterRotate.target.x - poseAfterRotate.position.x, y: poseAfterRotate.target.y - poseAfterRotate.position.y, z: poseAfterRotate.target.z - poseAfterRotate.position.z };
  assert.notDeepEqual(dirAfterRotate, dirBefore, 'explicit rotateGeocentricView should change the look direction');
}

// horizons-client: parses a realistic $$SOE/$$EOE vector-table block,
// including the VX/VY/VZ velocity line (VEC_TABLE='2' — position and
// velocity in the same response, no live network call)
{
  const sample = [
    '$$SOE',
    '2461104.500000000 = A.D. 2026-Mar-01 00:00:00.0000 TDB ',
    ' X = 3.050325123456789E-01 Y =-4.031234567890123E-01 Z =-3.123456789012345E-02',
    ' VX= 1.987654321098765E-02 VY= 1.234567890123456E-02 VZ=-1.234567890123456E-03',
    '$$EOE',
  ].join('\n');
  const pos = parseVectorsBlock(sample);
  assert.ok(Math.abs(pos.x - 0.3050325123456789) < 1e-9);
  assert.ok(Math.abs(pos.y - (-0.4031234567890123)) < 1e-9);
  assert.ok(Math.abs(pos.z - (-0.03123456789012345)) < 1e-9);
  assert.ok(Math.abs(pos.vx - 0.01987654321098765) < 1e-9);
  assert.ok(Math.abs(pos.vy - 0.01234567890123456) < 1e-9);
  assert.ok(Math.abs(pos.vz - (-0.001234567890123456)) < 1e-9);
}

// horizons-client: parseVectorsBlock tolerates a response with no velocity
// line (VEC_TABLE='1'-style) — velocity defaults to zero, not a crash
{
  const sample = [
    '$$SOE',
    '2461104.500000000 = A.D. 2026-Mar-01 00:00:00.0000 TDB ',
    ' X = 1.0E+00 Y = 0.0E+00 Z = 0.0E+00',
    '$$EOE',
  ].join('\n');
  const pos = parseVectorsBlock(sample);
  assert.deepEqual({ vx: pos.vx, vy: pos.vy, vz: pos.vz }, { vx: 0, vy: 0, vz: 0 });
}

// horizons-client: malformed/missing markers throw HorizonsUnavailableError, not a crash
{
  assert.throws(() => parseVectorsBlock('no markers here'), HorizonsUnavailableError);
  assert.throws(() => parseVectorsBlock('$$SOE\nnothing useful\n$$EOE'), HorizonsUnavailableError);
}

// ephemeris: getBodyState always returns synchronously (never awaits
// Horizons in the caller), and falls back to source:'kepler',
// quality:'approximate' with a finite position+velocity when the (stubbed)
// fetch fails — the render loop must never crash or block on a dead
// network. No live network calls: global.fetch is stubbed manually.
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('stubbed: network down'));
  resetCircuitBreaker();

  const jsDate = new Date('2026-06-15T00:00:00Z');
  const result = getBodyState('mars', jsDate, PLANETS.mars.elements);
  assert.equal(result.source, 'kepler');
  assert.equal(result.quality, 'approximate');
  assert.equal(result.bodyId, 'mars');
  assert.ok(Number.isFinite(result.positionAu.x) && Number.isFinite(result.positionAu.y) && Number.isFinite(result.positionAu.z));
  assert.ok(Number.isFinite(result.velocityAuPerDay.x) && Number.isFinite(result.velocityAuPerDay.y) && Number.isFinite(result.velocityAuPerDay.z));

  // let the background fetch attempt settle so the circuit breaker trips
  // and so there's no unhandled-rejection warning when the process exits
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(isHorizonsAvailable(), false, 'a failed Horizons attempt should open the circuit breaker');

  globalThis.fetch = originalFetch;
  resetCircuitBreaker();
}

// ephemeris: a populated Horizons cache entry is reported as
// source:'horizons-cache', quality:'authoritative' on the next lookup for
// the same body/date bucket — the cache-hit path, not previously covered
{
  const originalFetch = globalThis.fetch;
  const fixtureResult = [
    '$$SOE',
    '2461104.500000000 = A.D. 2026-Mar-01 00:00:00.0000 TDB ',
    ' X = 1.234567890123456E+00 Y = 2.345678901234567E-01 Z =-3.456789012345678E-02',
    ' VX=-4.567890123456789E-03 VY= 5.678901234567890E-03 VZ= 6.789012345678901E-04',
    '$$EOE',
  ].join('\n');
  globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ result: fixtureResult }) });
  resetCircuitBreaker();

  const jsDate = new Date('2026-03-01T00:00:00Z');
  const first = getBodyState('mars', jsDate, PLANETS.mars.elements);
  assert.equal(first.source, 'kepler', 'first lookup (no cache yet) still falls back to kepler this frame');

  // let the background fetch resolve and populate the cache
  await new Promise((resolve) => setTimeout(resolve, 20));

  const second = getBodyState('mars', jsDate, PLANETS.mars.elements);
  assert.equal(second.source, 'horizons-cache');
  assert.equal(second.quality, 'authoritative');
  assert.ok(Math.abs(second.positionAu.x - 1.234567890123456) < 1e-9);
  assert.ok(Math.abs(second.positionAu.y - 0.2345678901234567) < 1e-9);
  assert.ok(Math.abs(second.positionAu.z - (-0.03456789012345678)) < 1e-9);
  assert.ok(Math.abs(second.velocityAuPerDay.x - (-0.004567890123456789)) < 1e-9);
  assert.ok(second.validity.note.includes('fetched'), 'cache-hit validity.note should record fetch time + source URL');

  globalThis.fetch = originalFetch;
  resetCircuitBreaker();
}

// ephemeris: sunBodyState is always the exact origin, authoritative — the
// Sun has no `elements`/Horizons code, doesn't go through getBodyState
{
  const state = sunBodyState(new Date());
  assert.deepEqual(state.positionAu, { x: 0, y: 0, z: 0 });
  assert.deepEqual(state.velocityAuPerDay, { x: 0, y: 0, z: 0 });
  assert.equal(state.quality, 'authoritative');
  assert.equal(state.bodyId, 'sun');
}

// body-state: createBodyState round-trips every field it's given, and
// fills the default `validity` shape when omitted
{
  const state = createBodyState({
    bodyId: 'x', epochJd: 1, epochUtc: '2026-01-01T00:00:00Z',
    source: 'kepler', sourceDetail: 'test', quality: 'approximate',
    positionAu: { x: 1, y: 2, z: 3 }, velocityAuPerDay: { x: 4, y: 5, z: 6 },
  });
  assert.equal(state.bodyId, 'x');
  assert.equal(state.center, 'SUN');
  assert.equal(state.frame, 'ECLIPJ2000');
  assert.deepEqual(state.validity, { startUtc: null, endUtc: null, note: null });
}

console.log('PASS: smoke-test.js all assertions passed');
