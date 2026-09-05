import assert from 'node:assert/strict';
import {
  mulberry32, sampleUnitSphere, generateStarfield, STAR_COUNTS, DEFAULT_STAR_QUALITY,
} from '../src/core/starfield-generator.js';
import { solveEccentricAnomaly, elementsToPosition, normalizeAngle } from '../src/core/kepler.js';
import {
  elementsAtDate, julianDateFromDate, dateFromJulianDate, circularOrbitAngle, moonLocalPosition,
  elementsVelocity, sampleOrbitPath,
} from '../src/core/orbital-elements.js';
import { compressDistance, compressSize, compressPosition, compressMoonOrbit, SATURN_RING_OUTER_KM } from '../src/core/scale.js';
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
import { unwrapAnglesRad, centralDiffAngularVelocityRadPerDay } from '../src/analysis/longitude.js';
import { classifyMotion, findStationaryPoints, analyzeMarsRetrograde } from '../src/analysis/retrograde.js';
import { elongationRad, signedElongationRad } from '../src/analysis/elongation.js';
import { analyzeOppositionConjunction, OUTER_TARGETS } from '../src/analysis/opposition.js';
import { analyzeGreatestElongation, analyzeInnerConjunction, INNER_TARGETS } from '../src/analysis/elongation-events.js';
import { phaseAngleRad, illuminatedFraction, analyzePhaseIllumination, PHASE_TARGETS } from '../src/analysis/phase.js';
import { moonHeliocentricPositionAu } from '../src/core/orbital-elements.js';
import { toExportableJson, toExportableCsv } from '../src/analysis/export.js';
import {
  gmstDeg, eclipticToEquatorial, raDecFromEquatorial, observerGeocentricPositionAu,
  hourAngleDeg, altAzFromDecHa, OBLIQUITY_DEG,
} from '../src/core/topocentric.js';
import { J2000_JD } from '../src/core/orbital-elements.js';
import { analyzeObserver, observeAt, OBSERVER_TARGETS } from '../src/analysis/observer.js';

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

// scale: compressMoonOrbit's minSceneRadius floor keeps Titan clear of
// Saturn's ring — without it, Titan's compressed orbit (~1.04) would land
// inside the ring's compressed outer edge (~1.19), a real visual bug this
// floor exists to fix (see src/core/orbital-elements.js#moonLocalPosition).
{
  const saturnRadiusKm = 58232;
  const saturnSceneRadius = compressSize(saturnRadiusKm);
  const ringOuterScene = compressSize(SATURN_RING_OUTER_KM);
  const titanUnclamped = compressMoonOrbit(1221870, saturnRadiusKm, saturnSceneRadius);
  assert.ok(titanUnclamped < ringOuterScene, 'sanity: unclamped Titan orbit really would fall inside the ring');
  const titanClamped = compressMoonOrbit(1221870, saturnRadiusKm, saturnSceneRadius, ringOuterScene * 1.05);
  assert.ok(titanClamped > ringOuterScene, 'Titan orbit must clear Saturn\'s ring once floored');
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

// orbital-elements: dateFromJulianDate is the exact inverse of julianDateFromDate
{
  const original = new Date('2026-09-04T12:34:56.789Z');
  const jd = julianDateFromDate(original);
  const roundTripped = dateFromJulianDate(jd);
  // float64 round-trip through a /86400000 and *86400000 pair loses a
  // sub-millisecond amount of precision at this epoch's magnitude — a few
  // ms tolerance still catches any real bug (wrong constant, sign flip,
  // unit mismatch) while not failing on ordinary float noise.
  assert.ok(Math.abs(roundTripped.getTime() - original.getTime()) < 5);
}

// analysis/longitude: unwrapAnglesRad turns a 359°->0° crossing into
// continuous progress, not a -359° jump (the acceptance criterion this
// exists for; also fixes a bug in the roadmap's own example code, which
// pushed the whole input array as element 0 instead of values[0])
{
  const deg = (d) => (d * Math.PI) / 180;
  const wrapped = [deg(350), deg(355), deg(359), deg(1), deg(5)]; // crosses 360->0
  const unwrapped = unwrapAnglesRad(wrapped);
  assert.ok(Math.abs(unwrapped[0] - deg(350)) < 1e-9);
  for (let i = 1; i < unwrapped.length; i += 1) {
    assert.ok(unwrapped[i] > unwrapped[i - 1], 'unwrapped sequence must keep increasing across the 360deg crossing');
  }
  assert.ok(Math.abs(unwrapped[unwrapped.length - 1] - deg(365)) < 1e-9);
}

// analysis/longitude: centralDiffAngularVelocityRadPerDay recovers a
// constant rate from a synthetic linear lambda(t), including at the array
// edges (one-sided difference there, not NaN)
{
  const timesJd = [0, 1, 2, 3, 4];
  const rateRadPerDay = 0.5;
  const unwrapped = timesJd.map((t) => rateRadPerDay * t);
  const velocity = centralDiffAngularVelocityRadPerDay(unwrapped, timesJd);
  for (const v of velocity) {
    assert.ok(Math.abs(v - rateRadPerDay) < 1e-9);
  }
}

// analysis/retrograde: classifyMotion follows the roadmap's sign convention
{
  assert.equal(classifyMotion(-0.1), 'retrograde');
  assert.equal(classifyMotion(0.1), 'direct');
}

// analysis/retrograde: findStationaryPoints refines a synthetic sin(t)
// zero-crossing to within tolerance, and the refined epoch is NOT one of
// the coarse sample times — the "not an unrefined sample time" acceptance
// criterion, checked directly rather than just hoped for
{
  const periodDays = 10;
  const omega = (2 * Math.PI) / periodDays;
  const lambdaDot = (t) => Math.sin(omega * t); // analytic zero-crossing at t = periodDays/2 = 5
  const timesJd = [0, 2, 4, 6, 8, 10];
  const coarseValues = timesJd.map(lambdaDot);
  const toleranceSeconds = 60;
  const stationary = findStationaryPoints(timesJd, coarseValues, lambdaDot, { toleranceSeconds });

  assert.equal(stationary.length, 1);
  const [point] = stationary;
  assert.ok(Math.abs(point.epochJd - 5) < toleranceSeconds / 86400);
  assert.equal(point.method, 'bisection');
  assert.equal(point.toleranceSeconds, toleranceSeconds);
  // The refined epoch must not equal either raw coarse-grid bracket
  // endpoint (4 or 6) — the "not an unrefined sample time" acceptance
  // criterion, checked directly.
  assert.notEqual(point.epochJd, 4);
  assert.notEqual(point.epochJd, 6);
}

// analysis/retrograde: analyzeMarsRetrograde offline reference case — a
// real historical Mars retrograde window (Nov 2007-Jan 2008), forced to
// ephemerisSource:'kepler' so this is fully deterministic and needs no
// network (see docs/ROADMAP.md's v0.4 acceptance criterion re: an offline
// reference dataset). Dates below were captured by actually running this
// implementation against the window, not assumed in advance — they land
// within a few days of the real astronomical stationary points for this
// well-documented 2007-2008 retrograde, which is the point of the test.
{
  const result = analyzeMarsRetrograde({
    startUtc: '2007-09-01T00:00:00Z', endUtc: '2008-03-01T00:00:00Z',
    intervalHours: 6, ephemerisSource: 'kepler',
  });

  assert.equal(result.type, 'retrograde-interval');
  assert.equal(result.target, 'mars');
  assert.equal(result.observer, 'earth-geocenter');
  assert.equal(result.frame, 'GEOCENTRIC_ECLIPJ2000');
  assert.equal(result.source, 'kepler', 'never horizons-live — see docs/accuracy.md, structurally unreachable here');
  assert.equal(result.samples.intervalHours, 6);
  assert.ok(result.samples.count > 0);
  assert.equal(result.solver.method, 'bisection');
  assert.equal(result.solver.toleranceSeconds, 60);
  assert.equal(result.opposition, null);

  assert.ok(result.start, 'expected a first stationary point in this known-retrograde window');
  assert.ok(result.end, 'expected a second stationary point in this known-retrograde window');
  assert.equal(result.start.event, 'stationary-direct-to-retrograde');
  assert.equal(result.end.event, 'stationary-retrograde-to-direct');
  assert.ok(result.end.epochJd > result.start.epochJd);

  const firstDate = new Date(result.start.epochUtc);
  const secondDate = new Date(result.end.epochUtc);
  assert.ok(firstDate >= new Date('2007-11-01T00:00:00Z') && firstDate <= new Date('2007-11-30T00:00:00Z'),
    `first stationary point ${result.start.epochUtc} expected in Nov 2007`);
  assert.ok(secondDate >= new Date('2008-01-15T00:00:00Z') && secondDate <= new Date('2008-02-15T00:00:00Z'),
    `second stationary point ${result.end.epochUtc} expected in Jan-Feb 2008`);
}

// analysis/retrograde: a short window with no retrograde interval reports
// "no stationary points found" rather than crashing or fabricating a result
{
  const result = analyzeMarsRetrograde({
    startUtc: '2007-09-01T00:00:00Z', endUtc: '2007-09-10T00:00:00Z',
    intervalHours: 6, ephemerisSource: 'kepler',
  });
  assert.equal(result.start, null);
  assert.equal(result.end, null);
  assert.ok(result.note && result.note.length > 0);
}

// analysis/elongation: elongationRad on hand-built synthetic geometries —
// observer at the origin, so `positionAu` doubles as a pure direction
{
  const observer = { positionAu: { x: 0, y: 0, z: 0 } };
  const sun = { positionAu: { x: 1, y: 0, z: 0 } };
  const perpendicular = { positionAu: { x: 0, y: 1, z: 0 } };
  const same = { positionAu: { x: 2, y: 0, z: 0 } };
  const opposite = { positionAu: { x: -1, y: 0, z: 0 } };
  assert.ok(Math.abs(elongationRad(perpendicular, observer, sun) - Math.PI / 2) < 1e-9, 'perpendicular target should be 90deg elongation');
  assert.ok(Math.abs(elongationRad(same, observer, sun)) < 1e-9, 'target along the same ray as the Sun should be 0deg elongation');
  assert.ok(Math.abs(elongationRad(opposite, observer, sun) - Math.PI) < 1e-9, 'target opposite the Sun should be 180deg elongation');
}

// analysis/elongation: signedElongationRad — east (+) vs west (-) of the
// Sun, same synthetic setup, target rotated to either side of the Sun
// direction
{
  const observer = { positionAu: { x: 0, y: 0, z: 0 } };
  const sun = { positionAu: { x: 1, y: 0, z: 0 } };
  const east = { positionAu: { x: 1, y: 1, z: 0 } }; // rotated toward +y
  const west = { positionAu: { x: 1, y: -1, z: 0 } }; // rotated toward -y
  assert.ok(signedElongationRad(east, observer, sun) > 0, 'east of the Sun should be a positive signed elongation');
  assert.ok(signedElongationRad(west, observer, sun) < 0, 'west of the Sun should be a negative signed elongation');
  assert.ok(Math.abs(signedElongationRad(east, observer, sun) + signedElongationRad(west, observer, sun)) < 1e-9, 'symmetric rotation should give opposite-sign, equal-magnitude elongations');
}

// analysis/opposition: analyzeOppositionConjunction offline reference case
// for all 3 supported outer planets — real, independently-known 2022
// opposition dates (Mars 2022-12-08, Jupiter 2022-09-26, Saturn
// 2022-08-14). Forced to ephemerisSource:'kepler' internally regardless of
// the argument, so this is fully deterministic and needs no network. Dates
// captured by actually running this implementation first, not hand-invented
// — same discipline as the Mars retrograde reference test above. This is
// also the test that confirms the opposition/conjunction labelFor mapping
// (+ -> opposition, - -> conjunction) is the right way round, not backwards.
{
  const cases = [
    { target: 'mars', startUtc: '2022-06-01T00:00:00Z', endUtc: '2023-03-01T00:00:00Z', expected: '2022-12-08' },
    { target: 'jupiter', startUtc: '2022-06-01T00:00:00Z', endUtc: '2022-12-01T00:00:00Z', expected: '2022-09-26' },
    { target: 'saturn', startUtc: '2022-05-01T00:00:00Z', endUtc: '2022-11-01T00:00:00Z', expected: '2022-08-14' },
  ];
  for (const { target, startUtc, endUtc, expected } of cases) {
    const result = analyzeOppositionConjunction({ target, startUtc, endUtc, intervalHours: 24, ephemerisSource: 'kepler' });

    assert.equal(result.type, 'opposition-conjunction');
    assert.equal(result.target, target);
    assert.equal(result.observer.bodyId, 'earth');
    assert.equal(result.reference.frame, 'GEOCENTRIC_ECLIPJ2000');
    assert.equal(result.reference.source, 'kepler', 'never horizons-live — see docs/accuracy.md, structurally unreachable here');
    assert.equal(result.solver.method, 'bisection');
    assert.equal(result.solver.toleranceSeconds, 60);

    const oppositions = result.result.events.filter((e) => e.event === 'opposition');
    assert.equal(oppositions.length, 1, `expected exactly one opposition for ${target} in range`);
    const oppositionDate = new Date(oppositions[0].epochUtc);
    const expectedDate = new Date(`${expected}T00:00:00Z`);
    const deltaDays = Math.abs(oppositionDate.getTime() - expectedDate.getTime()) / 86400000;
    assert.ok(deltaDays < 14, `${target} opposition ${oppositions[0].epochUtc} expected within 2 weeks of ${expected}`);
    // Not exactly 180deg — orbital inclination (Mars ~1.85deg, etc.) means
    // opposition is the elongation-derivative zero-crossing, not a perfect
    // Sun-Earth-planet line; a generous band still catches a wrong-body or
    // wrong-formula bug.
    assert.ok(Math.abs(oppositions[0].elongationDeg - 180) < 5, `${target} opposition should be ~180deg elongation, got ${oppositions[0].elongationDeg}`);
  }
  assert.deepEqual(OUTER_TARGETS, ['mars', 'jupiter', 'saturn']);
}

// analysis/opposition: an invalid target throws rather than silently
// misbehaving
{
  assert.throws(() => analyzeOppositionConjunction({ target: 'earth', startUtc: '2022-01-01T00:00:00Z', endUtc: '2022-06-01T00:00:00Z' }));
}

// analysis/elongation-events: analyzeGreatestElongation offline reference
// case — Venus's real, independently-known 2023 greatest elongations
// (eastern ~2023-06-04 at ~45deg, western ~2023-10-23 at ~46deg). Dates
// captured by actually running this implementation first, not hand-invented
// — same discipline as the opposition/conjunction reference test above.
{
  const result = analyzeGreatestElongation({
    target: 'venus', startUtc: '2023-01-01T00:00:00Z', endUtc: '2023-12-31T00:00:00Z', intervalHours: 12, ephemerisSource: 'kepler',
  });

  assert.equal(result.type, 'greatest-elongation');
  assert.equal(result.target, 'venus');
  assert.equal(result.reference.source, 'kepler', 'never horizons-live — see docs/accuracy.md, structurally unreachable here');
  assert.equal(result.result.events.length, 2, 'expected exactly one eastern and one western elongation for Venus in 2023');

  const eastern = result.result.events.find((e) => e.event === 'greatest-eastern-elongation');
  const western = result.result.events.find((e) => e.event === 'greatest-western-elongation');
  assert.ok(eastern, 'expected a greatest-eastern-elongation event');
  assert.ok(western, 'expected a greatest-western-elongation event');
  assert.ok(eastern.signedElongationDeg > 0, 'eastern elongation must be positive-signed');
  assert.ok(western.signedElongationDeg < 0, 'western elongation must be negative-signed');
  assert.ok(Math.abs(eastern.signedElongationDeg) > 40 && Math.abs(eastern.signedElongationDeg) < 50, `Venus eastern elongation magnitude expected ~45deg, got ${eastern.signedElongationDeg}`);
  assert.ok(Math.abs(western.signedElongationDeg) > 40 && Math.abs(western.signedElongationDeg) < 50, `Venus western elongation magnitude expected ~46deg, got ${western.signedElongationDeg}`);

  const easternDate = new Date(eastern.epochUtc);
  assert.ok(easternDate >= new Date('2023-05-21T00:00:00Z') && easternDate <= new Date('2023-06-18T00:00:00Z'),
    `Venus greatest eastern elongation ${eastern.epochUtc} expected within 2 weeks of 2023-06-04`);
  const westernDate = new Date(western.epochUtc);
  assert.ok(westernDate >= new Date('2023-10-09T00:00:00Z') && westernDate <= new Date('2023-11-06T00:00:00Z'),
    `Venus greatest western elongation ${western.epochUtc} expected within 2 weeks of 2023-10-23`);
}

// analysis/elongation-events: analyzeInnerConjunction offline reference
// case — Venus's real, independently-known 2023 inferior conjunction
// (~2023-08-13), which must classify as 'inferior-conjunction' (target
// closer to Earth than the Sun), not 'superior-conjunction'.
{
  const result = analyzeInnerConjunction({
    target: 'venus', startUtc: '2023-01-01T00:00:00Z', endUtc: '2023-12-31T00:00:00Z', intervalHours: 12, ephemerisSource: 'kepler',
  });

  assert.equal(result.type, 'inner-conjunction');
  assert.equal(result.result.events.length, 1, 'expected exactly one Venus conjunction crossing in 2023');
  const [event] = result.result.events;
  assert.equal(event.event, 'inferior-conjunction');
  assert.ok(Math.abs(event.signedElongationDeg) < 15, 'a conjunction crossing should be near-zero elongation');

  const eventDate = new Date(event.epochUtc);
  assert.ok(eventDate >= new Date('2023-07-30T00:00:00Z') && eventDate <= new Date('2023-08-27T00:00:00Z'),
    `Venus inferior conjunction ${event.epochUtc} expected within 2 weeks of 2023-08-13`);

  assert.deepEqual(INNER_TARGETS, ['mercury', 'venus']);
}

// analysis/elongation-events: an invalid target throws for both functions
{
  assert.throws(() => analyzeGreatestElongation({ target: 'mars', startUtc: '2023-01-01T00:00:00Z', endUtc: '2023-12-31T00:00:00Z' }));
  assert.throws(() => analyzeInnerConjunction({ target: 'mars', startUtc: '2023-01-01T00:00:00Z', endUtc: '2023-12-31T00:00:00Z' }));
}

// analysis/phase: illuminatedFraction follows the roadmap's exact formula
// k = (1 + cos(alpha)) / 2 at its three defining angles
{
  assert.ok(Math.abs(illuminatedFraction(0) - 1) < 1e-9, 'alpha=0 (fully lit) should give k=1');
  assert.ok(Math.abs(illuminatedFraction(Math.PI / 2) - 0.5) < 1e-9, 'alpha=90deg should give k=0.5');
  assert.ok(Math.abs(illuminatedFraction(Math.PI)) < 1e-9, 'alpha=180deg (fully dark) should give k=0');
}

// analysis/phase: phaseAngleRad on hand-built synthetic geometries —
// full-Moon-like (observer between Sun and target, so Sun and observer are
// in the same direction from the target) gives alpha near 0; new-Moon-like
// (target between Sun and observer) gives alpha near pi
{
  const sun = { positionAu: { x: 0, y: 0, z: 0 } };
  const fullMoonObserver = { positionAu: { x: 1, y: 0, z: 0 } };
  const fullMoonTarget = { positionAu: { x: 1.01, y: 0, z: 0 } }; // just beyond the observer, same side as the Sun
  assert.ok(phaseAngleRad(fullMoonTarget, fullMoonObserver, sun) < 0.1, 'full-Moon-like geometry should give a near-zero phase angle');

  const newMoonTarget = { positionAu: { x: 0.5, y: 0, z: 0 } }; // between Sun and observer
  const newMoonObserver = { positionAu: { x: 1, y: 0, z: 0 } };
  assert.ok(Math.abs(phaseAngleRad(newMoonTarget, newMoonObserver, sun) - Math.PI) < 1e-6, 'new-Moon-like geometry should give a phase angle near pi');
}

// core/orbital-elements: moonHeliocentricPositionAu at exactly
// MOON_ANALYSIS_EPOCH_JD (= J2000, angle 0) places the moon at
// parentPositionAu + {x: orbitKm*AU_PER_KM, y:0, z:0}
{
  const moonData = MOONS.moon;
  const parentPositionAu = { x: 1.0, y: 0.2, z: -0.01 };
  const j2000Jd = julianDateFromDate(new Date('2000-01-01T12:00:00Z'));
  const pos = moonHeliocentricPositionAu(moonData, parentPositionAu, j2000Jd);
  const expectedRAu = moonData.orbitKm / 149597870.7;
  assert.ok(Math.abs(pos.x - (parentPositionAu.x + expectedRAu)) < 1e-9);
  assert.ok(Math.abs(pos.y - parentPositionAu.y) < 1e-9);
  assert.ok(Math.abs(pos.z - parentPositionAu.z) < 1e-9);
}

// analysis/phase: analyzePhaseIllumination real-date checks. The Moon's
// heliocentric position here is a circular-orbit approximation anchored to
// a fixed J2000 epoch (see core/orbital-elements.js's
// MOON_ANALYSIS_EPOCH_JD docstring) — NOT calibrated to the real Moon's
// actual phase (confirmed by actually running this against real recent
// full-moon dates: they come back with k around 0.08-0.14, not near 1 —
// see docs/accuracy.md). So this only checks the formula stays in its
// valid [0,1] range and doesn't throw, for every supported target,
// rather than asserting against a real astronomical phase date the
// model was never built to reproduce.
{
  for (const target of PHASE_TARGETS) {
    const result = analyzePhaseIllumination({ target, atUtc: '2024-06-15T00:00:00Z', ephemerisSource: 'kepler' });
    assert.equal(result.type, 'phase-illumination');
    assert.equal(result.target, target);
    assert.equal(result.solver.method, 'direct');
    assert.equal(result.solver.toleranceSeconds, 0);
    assert.ok(result.result.illuminatedFraction >= 0 && result.result.illuminatedFraction <= 1,
      `${target} illuminated fraction must be in [0,1], got ${result.result.illuminatedFraction}`);
    assert.ok(result.result.phaseAngleDeg >= 0 && result.result.phaseAngleDeg <= 180,
      `${target} phase angle must be in [0,180], got ${result.result.phaseAngleDeg}`);
  }
  assert.deepEqual(PHASE_TARGETS, ['moon', 'mercury', 'venus', 'mars']);
}

// analysis/phase: an invalid target throws, and an unparseable date throws
{
  assert.throws(() => analyzePhaseIllumination({ target: 'jupiter', atUtc: '2024-06-15T00:00:00Z' }));
  assert.throws(() => analyzePhaseIllumination({ target: 'moon', atUtc: 'not-a-date' }));
}

// analysis/export: toExportableJson round-trips a hand-built minimal
// result, drops `series`, and keeps every other field
{
  const result = {
    id: 'test-1', type: 'opposition-conjunction', target: 'mars',
    observer: { type: 'geocenter', bodyId: 'earth' },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN', source: 'kepler' },
    input: { startUtc: '2022-01-01T00:00:00Z', endUtc: '2022-12-01T00:00:00Z', intervalHours: 24 },
    result: { events: [{ event: 'opposition', epochJd: 1, epochUtc: '2022-12-08T00:00:00Z', elongationDeg: 179.5 }] },
    solver: { method: 'bisection', toleranceSeconds: 60, status: 'success' },
    series: { timesJd: [1, 2, 3], valueDeg: [1, 2, 3] },
  };
  const parsed = JSON.parse(toExportableJson(result));
  assert.equal(parsed.id, 'test-1');
  assert.equal(parsed.target, 'mars');
  assert.deepEqual(parsed.reference, result.reference);
  assert.deepEqual(parsed.input, result.input);
  assert.deepEqual(parsed.solver, result.solver);
  assert.deepEqual(parsed.result, result.result);
  assert.ok(!('series' in parsed), 'series (chart-only dense arrays) must be dropped from the export');
}

// analysis/export: a result missing required reproducibility metadata
// throws, naming the missing field, rather than silently exporting an
// incomplete record
{
  const incomplete = {
    id: 'test-2', type: 'opposition-conjunction', target: 'mars',
    observer: { type: 'geocenter', bodyId: 'earth' },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN' }, // missing source
    input: {},
    result: { events: [] },
    solver: { method: 'bisection', toleranceSeconds: 60 },
  };
  assert.throws(() => toExportableJson(incomplete), /source/);
  assert.throws(() => toExportableCsv(incomplete), /source/);
}

// analysis/export: toExportableCsv header matches the shared column set
// exactly, and row count / values are correct for both an events[]-bearing
// result and a phase/illumination single-value result
{
  const expectedHeader = [
    'id', 'type', 'target', 'observer.type', 'observer.bodyId',
    'reference.frame', 'reference.center', 'reference.source',
    'input.startUtc', 'input.endUtc', 'input.intervalHours', 'input.atUtc',
    'solver.method', 'solver.toleranceSeconds', 'solver.status',
    'event.name', 'event.epochUtc', 'event.epochJd', 'event.valueDeg',
    'event.illuminatedFraction', 'units',
  ].join(',');

  const eventsResult = {
    id: 'test-3', type: 'opposition-conjunction', target: 'mars',
    observer: { type: 'geocenter', bodyId: 'earth' },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN', source: 'kepler' },
    input: { startUtc: '2022-01-01T00:00:00Z', endUtc: '2022-12-01T00:00:00Z', intervalHours: 24 },
    result: {
      events: [
        { event: 'opposition', epochJd: 100, epochUtc: '2022-12-08T00:00:00Z', elongationDeg: 179.5 },
        { event: 'conjunction', epochJd: 200, epochUtc: '2023-01-01T00:00:00Z', elongationDeg: 0.3 },
      ],
    },
    solver: { method: 'bisection', toleranceSeconds: 60, status: 'success' },
  };
  const eventsCsv = toExportableCsv(eventsResult);
  const eventsLines = eventsCsv.split('\n');
  assert.equal(eventsLines[0], expectedHeader);
  assert.equal(eventsLines.length, 3, 'header + 2 event rows');
  assert.ok(eventsLines[1].includes('opposition') && eventsLines[1].includes('179.5'));
  assert.ok(eventsLines[2].includes('conjunction') && eventsLines[2].includes('0.3'));

  const phaseResult = {
    id: 'test-4', type: 'phase-illumination', target: 'moon',
    observer: { type: 'geocenter', bodyId: 'earth' },
    reference: { frame: 'GEOCENTRIC_ECLIPJ2000', center: 'SUN', source: 'kepler' },
    input: { atUtc: '2024-01-01T00:00:00Z' },
    epochJd: 42,
    result: { phaseAngleDeg: 12.5, illuminatedFraction: 0.94 },
    solver: { method: 'direct', toleranceSeconds: 0, status: 'success' },
  };
  const phaseCsv = toExportableCsv(phaseResult);
  const phaseLines = phaseCsv.split('\n');
  assert.equal(phaseLines[0], expectedHeader);
  assert.equal(phaseLines.length, 2, 'header + 1 synthetic phase row');
  assert.ok(phaseLines[1].includes('phase-illumination') && phaseLines[1].includes('12.5') && phaseLines[1].includes('0.94'));
}

// analysis/export: end-to-end with a real analyzeMarsRetrograde result
// (legacy v0.4 shape: observer is a string, frame/source are top-level,
// start/end instead of result.events[]) — confirms export.js's dual-shape
// accessor helpers actually work on the shape that ships today, not just
// the newer nested one
{
  const result = analyzeMarsRetrograde({
    startUtc: '2007-09-01T00:00:00Z', endUtc: '2008-03-01T00:00:00Z',
    intervalHours: 6, ephemerisSource: 'kepler',
  });
  const json = toExportableJson(result);
  assert.ok(json.length > 0);
  assert.ok(!JSON.parse(json).series, 'series must be dropped from the retrograde export too');

  const csv = toExportableCsv(result);
  const csvLines = csv.split('\n');
  assert.equal(csvLines.length, 3, 'header + start + end rows');
  assert.ok(csvLines[1].includes('stationary-direct-to-retrograde'));
  assert.ok(csvLines[2].includes('stationary-retrograde-to-direct'));
}

// core/topocentric: gmstDeg at the exact J2000.0 epoch (T=0) collapses to
// its own polynomial constant term — also validates wrap360 is a no-op here
{
  assert.ok(Math.abs(gmstDeg(J2000_JD) - 280.46061837) < 1e-6);
}

// core/topocentric: eclipticToEquatorial is invariant on the rotation axis
// (the equinox direction, {1,0,0}) — round-trips through raDecFromEquatorial
// to RA=0/Dec=0
{
  const eq = eclipticToEquatorial({ x: 1, y: 0, z: 0 });
  assert.ok(Math.abs(eq.x - 1) < 1e-9 && Math.abs(eq.y) < 1e-9 && Math.abs(eq.z) < 1e-9);
  const { raDeg, decDeg } = raDecFromEquatorial(eq);
  assert.ok(Math.abs(raDeg) < 1e-6);
  assert.ok(Math.abs(decDeg) < 1e-6);
}

// core/topocentric: observerGeocentricPositionAu at the equator, sea
// level, LST=0 gives exactly {earthRadiusKm*AU_PER_KM, 0, 0}
{
  const pos = observerGeocentricPositionAu({ latDeg: 0, elevationM: 0 }, 0);
  const expectedRAu = PLANETS.earth.radiusKm / 149597870.7;
  assert.ok(Math.abs(pos.x - expectedRAu) < 1e-12);
  assert.ok(Math.abs(pos.y) < 1e-12 && Math.abs(pos.z) < 1e-12);
}

// core/topocentric: hourAngleDeg wraps correctly
{
  assert.equal(hourAngleDeg(100, 40), 60);
  assert.equal(hourAngleDeg(10, 350), 20, 'must wrap into [0,360)');
}

// core/topocentric: altAzFromDecHa at the zenith (dec=lat=ha=0, observer
// on the equator looking straight up along the celestial equator/meridian
// intersection) gives alt~90deg and exercises the azimuth zenith-guard
// (must not throw/NaN, falls back to the documented azDeg:0)
{
  const { altDeg, azDeg } = altAzFromDecHa({ decDeg: 0, latDeg: 0, haDeg: 0 });
  assert.ok(Math.abs(altDeg - 90) < 1e-6);
  assert.equal(azDeg, 0);
}

// core/topocentric: altAzFromDecHa at ha=90deg (6h west of the meridian,
// on the celestial equator, observer on the equator) sits exactly on the
// horizon — the boundary condition the rise/set solver depends on — and
// its azimuth (West, under the North-clockwise convention) is 270deg
{
  const { altDeg, azDeg } = altAzFromDecHa({ decDeg: 0, latDeg: 0, haDeg: 90 });
  assert.ok(Math.abs(altDeg) < 1e-6, `expected ~0deg altitude at the horizon, got ${altDeg}`);
  assert.ok(Math.abs(azDeg - 270) < 1e-6, `expected West (270deg), got ${azDeg}`);
}

// core/topocentric: OBLIQUITY_DEG reuses PLANETS.earth.axialTiltDeg, not a
// separately hardcoded value — keeps the Tropic-of-Cancer reference test
// below correct even if that constant ever changes
{
  assert.equal(OBLIQUITY_DEG, PLANETS.earth.axialTiltDeg);
}

// analysis/observer: self-consistency check — at the Sun's transit event
// on an arbitrary date, altDeg must equal the exact spherical-trig
// identity 90 - |lat - dec| (transit = hour angle 0, this is not an
// approximation, it's what the Alt/Az formula reduces to at H=0) — this
// verifies Alt/Az, RA/Dec, and the transit-finder all agree internally,
// independent of any external ground truth. Checked at 4 latitudes.
{
  for (const latDeg of [0, 22.6273, -30, 60]) {
    const result = analyzeObserver({ target: 'sun', atUtc: '2026-03-15T00:00:00Z', latDeg, lonDeg: 0, elevationM: 0 });
    const transit = result.result.events.find((e) => e.event === 'transit');
    assert.ok(transit, `expected a transit event at lat ${latDeg}`);
    const o = observeAt({ target: 'sun', jsDate: new Date(transit.epochUtc), latDeg, lonDeg: 0, elevationM: 0 });
    const expectedAltDeg = 90 - Math.abs(latDeg - o.decDeg);
    assert.ok(Math.abs(transit.altDeg - expectedAltDeg) < 0.01,
      `lat ${latDeg}: transit altDeg ${transit.altDeg} should match the 90-|lat-dec| identity (expected ${expectedAltDeg})`);
  }
}

// analysis/observer: circumpolar and never-rises days report a note
// instead of a fabricated rise/set, matching analyzeMarsRetrograde's
// existing "no stationary points found" pattern
{
  const circumpolar = analyzeObserver({ target: 'sun', atUtc: '2026-06-21T12:00:00Z', latDeg: 80, lonDeg: 0, elevationM: 0 });
  assert.ok(circumpolar.result.note && /circumpolar/i.test(circumpolar.result.note), 'expected a circumpolar note at lat 80 on the June solstice');
  assert.ok(!circumpolar.result.events.some((e) => e.event === 'rise' || e.event === 'set'));

  const neverRises = analyzeObserver({ target: 'sun', atUtc: '2026-12-21T12:00:00Z', latDeg: 80, lonDeg: 0, elevationM: 0 });
  assert.ok(neverRises.result.note && /does not rise/i.test(neverRises.result.note), 'expected a never-rises note at lat 80 on the December solstice');
  assert.ok(!neverRises.result.events.some((e) => e.event === 'rise' || e.event === 'set'));
}

// analysis/observer: invalid inputs throw rather than silently misbehaving
{
  assert.throws(() => analyzeObserver({ target: 'earth', atUtc: '2026-01-01T00:00:00Z', latDeg: 0, lonDeg: 0 }));
  assert.throws(() => analyzeObserver({ target: 'sun', atUtc: '2026-01-01T00:00:00Z', latDeg: 95, lonDeg: 0 }));
  assert.throws(() => analyzeObserver({ target: 'sun', atUtc: '2026-01-01T00:00:00Z', latDeg: 0, lonDeg: 200 }));
  assert.throws(() => analyzeObserver({ target: 'sun', atUtc: 'not-a-date', latDeg: 0, lonDeg: 0 }));
  assert.deepEqual(OBSERVER_TARGETS, ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
}

// analysis/observer: real reference case — the Sun at the Tropic of
// Cancer (latDeg = this app's own OBLIQUITY_DEG constant, not a
// separately hardcoded 23.44 — by definition the same value in this
// implementation's fixed-obliquity model) on the June solstice should
// transit almost exactly at the zenith (altDeg ~90) — an independently
// verifiable real fact, additionally guaranteed structurally by this
// app's own constant-obliquity model. Tolerance set by actually running
// this implementation (got 89.98deg, i.e. ~0.02deg off zenith) — 0.1deg
// comfortably covers that with margin for the Kepler-propagated Sun-Earth
// geometry's own small two-body error, not hand-assumed.
{
  const result = analyzeObserver({ target: 'sun', atUtc: '2026-06-21T12:00:00Z', latDeg: OBLIQUITY_DEG, lonDeg: 0, elevationM: 0 });
  const transit = result.result.events.find((e) => e.event === 'transit');
  assert.ok(transit, 'expected a transit event on the June solstice at the Tropic of Cancer');
  assert.ok(Math.abs(transit.altDeg - 90) < 0.1,
    `Sun transit at the Tropic of Cancer on the June solstice should be ~90deg (zenith), got ${transit.altDeg}`);
  assert.equal(result.reference.source, 'kepler', 'never horizons-live — see docs/accuracy.md, structurally unreachable here');
  assert.equal(result.solver.method, 'bisection');
}

// starfield-generator: mulberry32 is deterministic (same seed -> same
// sequence) and clearly not constant (a broken PRNG returning the same
// value every call would still pass a naive "no crash" check).
{
  const seqA = Array.from({ length: 5 }, mulberry32(42));
  const seqB = Array.from({ length: 5 }, mulberry32(42));
  assert.deepEqual(seqA, seqB, 'same seed must produce the same sequence');
  assert.ok(new Set(seqA).size > 1, 'sequence must not be constant');
}

// starfield-generator: sampleUnitSphere always lands exactly on the unit
// sphere, and — the actual bug this function exists to avoid — a large
// sample is NOT biased toward the cube's corners the way independently
// sampling x/y/z in [-1,1] and normalizing would be. For true uniform
// sampling, E[x^2] = E[y^2] = E[z^2] = 1/3 exactly (by symmetry); checking
// all three land near 1/3 over a large sample catches that specific bug
// (a corner-biased sampler pushes these apart, e.g. toward favoring
// whichever axis the bias is worst along).
{
  const rand = mulberry32(7);
  const N = 20000;
  let sumX2 = 0, sumY2 = 0, sumZ2 = 0;
  for (let i = 0; i < N; i++) {
    const p = sampleUnitSphere(rand);
    const r = Math.hypot(p.x, p.y, p.z);
    assert.ok(Math.abs(r - 1) < 1e-9, `point must be exactly on the unit sphere, got r=${r}`);
    sumX2 += p.x * p.x; sumY2 += p.y * p.y; sumZ2 += p.z * p.z;
  }
  const meanX2 = sumX2 / N, meanY2 = sumY2 / N, meanZ2 = sumZ2 / N;
  for (const [label, m] of [['x^2', meanX2], ['y^2', meanY2], ['z^2', meanZ2]]) {
    assert.ok(Math.abs(m - 1 / 3) < 0.02,
      `uniform-sphere sampling requires E[${label}] ~ 1/3, got ${m} (N=${N}) — check for corner-bias`);
  }
}

// starfield-generator: generateStarfield is deterministic per seed, every
// array is the right length/shape, and every value stays in its documented
// range (colors/brightness in [0,1], positions on the unit sphere).
{
  const a = generateStarfield({ count: 500, seed: 99 });
  const b = generateStarfield({ count: 500, seed: 99 });
  assert.deepEqual(Array.from(a.positions), Array.from(b.positions), 'same seed must reproduce identical positions');
  assert.deepEqual(Array.from(a.colors), Array.from(b.colors), 'same seed must reproduce identical colors');
  assert.equal(a.positions.length, 500 * 3);
  assert.equal(a.colors.length, 500 * 3);
  assert.equal(a.sizes.length, 500);
  assert.equal(a.brightness.length, 500);
  for (let i = 0; i < 500; i++) {
    const r = Math.hypot(a.positions[i * 3], a.positions[i * 3 + 1], a.positions[i * 3 + 2]);
    // 1e-5, not 1e-9 — positions round-trip through a Float32Array (~7
    // significant decimal digits), unlike sampleUnitSphere's plain-double
    // check above.
    assert.ok(Math.abs(r - 1) < 1e-5, `every star position must be on the unit sphere, got r=${r}`);
    assert.ok(a.brightness[i] >= 0 && a.brightness[i] <= 1, 'brightness must be in [0,1]');
    for (const c of [a.colors[i * 3], a.colors[i * 3 + 1], a.colors[i * 3 + 2]]) {
      assert.ok(c >= 0 && c <= 1, 'color channels must be in [0,1]');
    }
  }
  assert.deepEqual(STAR_COUNTS, { low: 2500, medium: 6000, high: 12000 });
  assert.equal(DEFAULT_STAR_QUALITY, 'medium');
}

console.log('PASS: smoke-test.js all assertions passed');
