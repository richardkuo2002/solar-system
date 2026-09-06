import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractChangelogSection } from './changelog-excerpt.mjs';
import { loadStarCatalog, constellationLineSegments, constellationLabelPositions } from '../src/core/star-catalog.js';
import { solveEccentricAnomaly, elementsToPosition, normalizeAngle } from '../src/core/kepler.js';
import {
  elementsAtDate, julianDateFromDate, dateFromJulianDate, circularOrbitAngle, moonLocalPosition,
  moonLocalPositionMeeus, moonGeocentricJ2000,
  elementsVelocity, sampleOrbitPath, orbitalPeriodDaysFromSemiMajorAxisAu,
} from '../src/core/orbital-elements.js';
import { compressDistance, compressSize, compressPosition, compressMoonOrbit, spacedMoonOrbitRadii, MOON_MIN_GAP_SCENE, apparentAngularRadiusRad, SATURN_RING_OUTER_KM } from '../src/core/scale.js';
import { PLANETS, PLANET_ORDER } from '../src/data/planets.js';
import { MOONS, MOON_ORDER } from '../src/data/moons.js';
import { COMETS, COMET_ORDER } from '../src/data/comets.js';
import { DWARF_PLANETS, DWARF_PLANET_ORDER, CHARON } from '../src/data/dwarf-planets.js';
import { hasRealTextureFile } from '../src/core/texture-resolution.js';
import { parseVectorsBlock, HorizonsUnavailableError } from '../src/core/horizons-client.js';
import { getBodyState, sunBodyState, isHorizonsAvailable, resetCircuitBreaker, getLightTimeCorrectedState } from '../src/core/ephemeris.js';
import { createBodyState } from '../src/core/body-state.js';
import {
  createTimeController, tick, play, pause, setSpeed, reverse, jumpToDate,
} from '../src/core/time-controller.js';
import {
  createCameraState, setMode, setFocusBody, setSurfaceLocation, setSurfacePlanet,
  moveFreeFlight, enterGeocentric, rotateGeocentricView, cycleGeocentricFocus,
  walkSurface, computePose, analysisVisualState, CAMERA_MODES,
} from '../src/core/camera-modes.js';
import { REAL_TIME_DAYS_PER_SECOND, SPEED_OPTIONS } from '../src/render/ui-controls.js';
import { unwrapAnglesRad, centralDiffAngularVelocityRadPerDay } from '../src/analysis/longitude.js';
import { classifyMotion, findStationaryPoints, analyzeRetrograde } from '../src/analysis/retrograde.js';
import { elongationRad, signedElongationRad } from '../src/analysis/elongation.js';
import { analyzeOppositionConjunction, OUTER_TARGETS } from '../src/analysis/opposition.js';
import { analyzeGreatestElongation, analyzeInnerConjunction, INNER_TARGETS } from '../src/analysis/elongation-events.js';
import { phaseAngleRad, illuminatedFraction, analyzePhaseIllumination, PHASE_TARGETS } from '../src/analysis/phase.js';
import { moonHeliocentricPositionAu } from '../src/core/orbital-elements.js';
import { moonEclipticPosition } from '../src/core/lunar-theory.js';
import { analyzeLunarEclipse, analyzeSolarEclipse, angularSeparationDeg } from '../src/analysis/eclipse.js';
import { analyzeTransit } from '../src/analysis/transit.js';
import { analyzeAppulse, APPULSE_TARGETS } from '../src/analysis/appulse.js';
import { analyzeLunarOccultation, OCCULTATION_TARGETS } from '../src/analysis/occultation.js';
import { analyzeMoonConjunction, MOON_CONJUNCTION_TARGETS } from '../src/analysis/moon-conjunction.js';
import { toExportableJson, toExportableCsv } from '../src/analysis/export.js';
import {
  gmstDeg, eclipticToEquatorial, raDecFromEquatorial, observerGeocentricPositionAu,
  hourAngleDeg, altAzFromDecHa, OBLIQUITY_DEG, equatorialToEcliptic, unitVectorFromRaDec,
  refractionArcmin, precessEquatorialToDate, nutation, nutateEquatorialToTrue, eqEquinoxDeg,
} from '../src/core/topocentric.js';
import { C_AU_PER_DAY } from '../src/core/units.js';
import { J2000_JD } from '../src/core/orbital-elements.js';
import { analyzeObserver, observeAt, OBSERVER_TARGETS } from '../src/analysis/observer.js';
import { encodeAppStateToParams, decodeAppStateFromParams } from '../src/core/url-state.js';
import { applySavedDefaults } from '../src/core/event-toolkit-persistence.js';
import { scoreNight, analyzeBestObservationNight, MAX_NIGHTS_TO_SCAN } from '../src/analysis/best-night.js';

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

// scale: spacedMoonOrbitRadii (v1.8.4) — Jupiter's four Galilean moons'
// raw compressMoonOrbit results render overlapping each other (verified:
// Io's orbit is ~1.02, Europa's ~1.05 — 0.03 apart, less than either
// moon's own ~0.16-0.17 rendered radius) and Io's near side even dips
// back inside Jupiter's own scene radius. After spacing, every pair must
// clear both each other and the planet.
{
  const parentRadiusKm = 69911; // Jupiter
  const parentSceneRadius = compressSize(parentRadiusKm);
  const galileanMoons = [
    { orbitKm: 421700, radiusKm: 1821.6 }, // Io
    { orbitKm: 671034, radiusKm: 1560.8 }, // Europa
    { orbitKm: 1070412, radiusKm: 2634.1 }, // Ganymede
    { orbitKm: 1882709, radiusKm: 2410.3 }, // Callisto
  ].map(({ orbitKm, radiusKm }) => ({
    sizeScene: compressSize(radiusKm),
    rScene: Math.max(compressMoonOrbit(orbitKm, parentRadiusKm, parentSceneRadius), parentSceneRadius + compressSize(radiusKm) + MOON_MIN_GAP_SCENE),
  }));
  const unspacedGap = galileanMoons[1].rScene - galileanMoons[0].rScene - galileanMoons[0].sizeScene - galileanMoons[1].sizeScene;
  assert.ok(unspacedGap < 0, `sanity: Io/Europa really do overlap before spacing, got clearance ${unspacedGap}`);
  const spaced = spacedMoonOrbitRadii(galileanMoons);
  assert.ok(spaced[0].rScene - spaced[0].sizeScene > parentSceneRadius, 'Io must clear Jupiter\'s own surface after spacing');
  for (let i = 1; i < spaced.length; i++) {
    const clearance = spaced[i].rScene - spaced[i - 1].rScene - spaced[i - 1].sizeScene - spaced[i].sizeScene;
    assert.ok(clearance >= MOON_MIN_GAP_SCENE - 1e-9, `moon ${i - 1} and ${i} must not overlap after spacing, got clearance ${clearance}`);
  }
  // A single-moon parent (nothing to collide with) must be untouched.
  const lone = spacedMoonOrbitRadii([{ rScene: 0.65, sizeScene: 0.167 }]);
  assert.equal(lone[0].rScene, 0.65, 'a lone moon\'s orbit radius must pass through unchanged');
}

// scale: apparentAngularRadiusRad (v1.3) — the real Moon's angular radius
// as seen from Earth is the well-known ~0.259deg (i.e. ~0.52deg angular
// diameter), from its real radius/distance, independent of any
// compression curve above.
{
  const moonAngularRadiusDeg = apparentAngularRadiusRad(1737.4, 384400) * (180 / Math.PI);
  assert.ok(Math.abs(moonAngularRadiusDeg - 0.259) < 0.01,
    `expected the Moon's real angular radius ~0.259deg, got ${moonAngularRadiusDeg}`);
}

// scale: apparentAngularRadiusRad (v1.8.6) — a degenerate distance smaller
// than the body's own radius used to return NaN (Math.asin's domain is
// [-1, 1]), which silently zeroed a THREE.js object's scale and made it
// vanish from the scene. Must now clamp to pi/2 (a body "filling the
// whole sky") instead.
{
  const clamped = apparentAngularRadiusRad(696000, 100); // Sun-sized radius, absurdly small distance
  assert.ok(Number.isFinite(clamped), `must not return NaN when radius > distance, got ${clamped}`);
  assert.equal(clamped, Math.PI / 2, 'must clamp to a full pi/2 (90deg), not overflow past it');
}

// scale: compressMoonOrbit (v1.8.6) — parentRadiusKm <= 0 has no current
// data row, but silently produced Infinity here before (then propagated
// through spacedMoonOrbitRadii into every sibling moon, vanishing the
// whole system). Must fail loudly instead — this is a data bug, not a
// value worth quietly tolerating.
{
  assert.throws(() => compressMoonOrbit(400000, 0, 1), /must be positive/, 'parentRadiusKm=0 must throw, not silently return Infinity');
  assert.throws(() => compressMoonOrbit(400000, -1, 1), /must be positive/, 'negative parentRadiusKm must throw too');
}

// orbital-elements: circularOrbitAngle wraps to [0, 2*PI) and completes one
// full revolution after exactly one period
{
  const angleHalf = circularOrbitAngle(13.66, 27.32); // half of the Moon's period
  assert.ok(Math.abs(angleHalf - Math.PI) < 1e-6);
  const angleFull = circularOrbitAngle(27.32, 27.32);
  assert.ok(Math.abs(angleFull) < 1e-6 || Math.abs(angleFull - 2 * Math.PI) < 1e-6);
}

// orbital-elements: orbitalPeriodDaysFromSemiMajorAxisAu is Kepler's third
// law, T(years) = a(AU)^1.5 — at a=1 AU (Earth's own definition of an AU)
// this must come out to EXACTLY 365.25 days, not approximately. A real
// reference case follows: Mars's actual elements.a[0] should derive a
// period within a few days of Mars's real ~687-day orbit (confirmed by
// running this function first — got 686.98 days — not hand-assumed).
{
  assert.equal(orbitalPeriodDaysFromSemiMajorAxisAu(1), 365.25, 'a=1 AU must give exactly one 365.25-day year');
  const marsPeriodDays = orbitalPeriodDaysFromSemiMajorAxisAu(PLANETS.mars.elements.a[0]);
  assert.ok(Math.abs(marsPeriodDays - 686.98) < 1,
    `Mars's real orbital period is ~686.98 days, got ${marsPeriodDays}`);
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

// orbital-elements (v1.5): moonLocalPositionMeeus — THE Moon's 3D-scene
// position now derives from the same Meeus/J2000-aligned source the
// analysis path uses (moonGeocentricJ2000). Drift guard: the scene
// position's ecliptic direction must exactly match the shared helper's
// lon/lat, and the position lands outside Earth's scene radius with a
// real (non-zero) out-of-plane component from the ~5deg inclination.
{
  const jd = julianDateFromDate(new Date('2026-01-01T00:00:00Z'));
  const parentRadiusKm = PLANETS.earth.radiusKm;
  const parentSceneRadius = compressSize(parentRadiusKm);
  const pos = moonLocalPositionMeeus(jd, parentRadiusKm, parentSceneRadius);
  const { lonRad, latRad } = moonGeocentricJ2000(jd);
  assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z));
  const r = Math.hypot(pos.x, pos.y, pos.z);
  assert.ok(r > parentSceneRadius, 'the Moon must render outside Earth');
  // Scene axes: x = cos(lat)cos(lon), y = sin(lat) (ecliptic z -> scene up), z = cos(lat)sin(lon)
  assert.ok(Math.abs(pos.x / r - Math.cos(latRad) * Math.cos(lonRad)) < 1e-12, 'scene direction x must match the shared J2000 lon/lat');
  assert.ok(Math.abs(pos.y / r - Math.sin(latRad)) < 1e-12, 'scene direction y must match the shared J2000 lat');
  assert.ok(Math.abs(pos.z / r - Math.cos(latRad) * Math.sin(lonRad)) < 1e-12, 'scene direction z must match the shared J2000 lon/lat');
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

// camera-modes: surface first-person must turn WITH the planet's spin — a
// "standing observer" stays planted on the same physical point as the
// planet rotates, so the camera's world-space position has to advance as
// bodyRotations[planet] advances (this was the actual bug report: the
// surface camera used to ignore rotation entirely and stay fixed in world
// space while the visible planet mesh spun underneath it).
{
  let state = setMode(createCameraState(), CAMERA_MODES.SURFACE_FIRST_PERSON, { planet: 'earth' });
  state = setSurfaceLocation(state, 0, 0); // equator, prime meridian
  const bodyPositions = { earth: { x: 0, y: 0, z: 0 } };

  const poseAtZero = computePose(state, bodyPositions, { earth: 0 });
  const poseAtQuarterTurn = computePose(state, bodyPositions, { earth: Math.PI / 2 });
  assert.ok(
    Math.hypot(
      poseAtZero.position.x - poseAtQuarterTurn.position.x,
      poseAtZero.position.y - poseAtQuarterTurn.position.y,
      poseAtZero.position.z - poseAtQuarterTurn.position.z
    ) > 0.01,
    'surface camera position must change as the planet rotation angle advances'
  );

  // A full rotation (2*PI) must return to exactly the same pose as R=0 —
  // otherwise the camera would be drifting rather than tracking a fixed
  // physical point through one full spin.
  const poseAfterFullTurn = computePose(state, bodyPositions, { earth: 2 * Math.PI });
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(poseAtZero.position[axis] - poseAfterFullTurn.position[axis]) < 1e-9,
      `one full rotation must return the surface camera to its starting position (axis ${axis})`);
  }

  // Missing bodyRotations (old call sites / other modes) must default to 0,
  // not throw — same pose as explicitly passing rotationRad=0.
  const poseNoRotationsArg = computePose(state, bodyPositions);
  assert.deepEqual(poseNoRotationsArg, poseAtZero, 'omitting bodyRotations must behave like rotation=0, for backward compatibility');
}

// camera-modes: setSurfacePlanet switches which body surface mode stands on
{
  let state = setSurfacePlanet(createCameraState(), 'mars');
  assert.equal(state.surface.planet, 'mars');
}

// camera-modes: walkSurface moves (lat, lon) by a fixed compass heading,
// clamps latitude short of the poles, and wraps longitude into (-180, 180]
{
  let state = setSurfaceLocation(createCameraState(), 0, 0);
  state = walkSurface(state, { dLatDeg: 10, dLonDeg: -5 });
  assert.equal(state.surface.lat, 10, 'north (+dLatDeg) must increase latitude');
  assert.equal(state.surface.lon, -5, 'west (-dLonDeg) must decrease longitude');

  const clamped = walkSurface(setSurfaceLocation(createCameraState(), 89, 0), { dLatDeg: 5 });
  assert.ok(clamped.surface.lat < 90, 'latitude must stay clamped short of the north pole');

  const wrapped = walkSurface(setSurfaceLocation(createCameraState(), 0, 179), { dLonDeg: 5 });
  assert.ok(wrapped.surface.lon >= -180 && wrapped.surface.lon <= 180, 'longitude must wrap, not run off past 180');
  assert.ok(wrapped.surface.lon < 0, 'wrapping east past 180 must land on the negative (western) side, not jump back to 179');
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

// camera-modes: cycleGeocentricFocus steps through a candidate list forward
// and backward, wrapping at both ends, and re-aims (via enterGeocentric)
// at whatever the new focus body is
{
  const candidates = ['mercury', 'venus', 'mars'];
  const bodyPositions = {
    earth: { x: 0, y: 0, z: 0 },
    mercury: { x: 1, y: 0, z: 0 },
    venus: { x: 0, y: 1, z: 0 },
    mars: { x: 0, y: 0, z: 1 },
  };
  let state = enterGeocentric(createCameraState(), bodyPositions, 'mercury');

  state = cycleGeocentricFocus(state, bodyPositions, candidates, 1);
  assert.equal(state.geocentric.focusBody, 'venus', 'cycling +1 from mercury must land on venus');
  state = cycleGeocentricFocus(state, bodyPositions, candidates, 1);
  assert.equal(state.geocentric.focusBody, 'mars', 'cycling +1 from venus must land on mars');
  state = cycleGeocentricFocus(state, bodyPositions, candidates, 1);
  assert.equal(state.geocentric.focusBody, 'mercury', 'cycling +1 past the end must wrap back to the start');

  state = cycleGeocentricFocus(state, bodyPositions, candidates, -1);
  assert.equal(state.geocentric.focusBody, 'mars', 'cycling -1 before the start must wrap to the end');

  // Re-aiming: after cycling to mars (at +z from earth here), the look
  // direction must point mostly along +z, not wherever it was pointing
  // for the previous focus body.
  const pose = computePose(state, bodyPositions);
  const dir = { x: pose.target.x - pose.position.x, y: pose.target.y - pose.position.y, z: pose.target.z - pose.position.z };
  const dirLen = Math.hypot(dir.x, dir.y, dir.z);
  assert.ok(dir.z / dirLen > 0.99, 'cycling to a new focus body must re-aim toward it');
}

// camera-modes: analysisVisualState (v1.8.5, extracted from app.js's
// animate() in v1.8.1) — the line-of-sight line and the Surface Mode
// target marker must never both be true, and never both be false while an
// analysis is active outside the analyzed body itself.
{
  const heliocentric = createCameraState(CAMERA_MODES.HELIOCENTRIC_TOPDOWN);
  const onMars = setMode(createCameraState(), CAMERA_MODES.SURFACE_FIRST_PERSON, { planet: 'mars' });
  const onJupiter = setMode(createCameraState(), CAMERA_MODES.SURFACE_FIRST_PERSON, { planet: 'jupiter' });

  assert.deepEqual(analysisVisualState(heliocentric, false, 'mars'), { showLineOfSight: false, showTargetMarker: false }, 'no active analysis: neither visual shows, in any mode');
  assert.deepEqual(analysisVisualState(heliocentric, true, 'mars'), { showLineOfSight: true, showTargetMarker: false }, 'active analysis outside Surface Mode: line only');
  assert.deepEqual(analysisVisualState(onMars, true, 'mars'), { showLineOfSight: false, showTargetMarker: false }, 'standing on the analyzed body itself: neither (nothing to point at)');
  assert.deepEqual(analysisVisualState(onJupiter, true, 'mars'), { showLineOfSight: false, showTargetMarker: true }, 'Surface Mode, analyzing a different body: marker only');
}

// render/ui-controls: SPEED_OPTIONS's default-selected option (v1.8.2)
// must equal REAL_TIME_DAYS_PER_SECOND, the same constant app.js passes
// to createTimeController's initial state — this is the exact mismatch
// v1.8.2 fixed (the dropdown's old default didn't match the clock's real
// starting speed); a regression here would silently reintroduce it.
{
  assert.equal(SPEED_OPTIONS[0].daysPerSecond, REAL_TIME_DAYS_PER_SECOND, 'the first (default-selected) speed option must be real time');
  for (let i = 1; i < SPEED_OPTIONS.length; i++) {
    assert.ok(SPEED_OPTIONS[i].daysPerSecond > SPEED_OPTIONS[i - 1].daysPerSecond, 'speed options must be in strictly ascending order');
  }
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

// analysis/retrograde: analyzeRetrograde offline reference case — a
// real historical Mars retrograde window (Nov 2007-Jan 2008), forced to
// ephemerisSource:'kepler' so this is fully deterministic and needs no
// network (see docs/ROADMAP.md's v0.4 acceptance criterion re: an offline
// reference dataset). Dates below were captured by actually running this
// implementation against the window, not assumed in advance — they land
// within a few days of the real astronomical stationary points for this
// well-documented 2007-2008 retrograde, which is the point of the test.
{
  const result = analyzeRetrograde({
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
  const result = analyzeRetrograde({
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

// core/lunar-theory: Meeus's own worked example (2nd ed., p.342, Example
// 47.a) at JDE=2448724.5 (1992-04-12 0h TD, treated here as UTC — this
// project ignores the sub-minute UTC/TT difference throughout, see
// docs/accuracy.md). Independently published/cross-checked reference
// values: lambda=133.162655deg, beta=-3.229126deg, distance=368409.7km.
{
  const { lonDeg, latDeg, distanceKm } = moonEclipticPosition(2448724.5);
  assert.ok(Math.abs(lonDeg - 133.162655) < 0.001, `lonDeg = ${lonDeg}, expected ~133.162655`);
  assert.ok(Math.abs(latDeg - (-3.229126)) < 0.001, `latDeg = ${latDeg}, expected ~-3.229126`);
  assert.ok(Math.abs(distanceKm - 368409.7) < 1, `distanceKm = ${distanceKm}, expected ~368409.7`);
}

// core/orbital-elements: moonHeliocentricPositionAu adds the Moon's real
// (Meeus-theory) geocentric ecliptic offset onto the parent's heliocentric
// position — round-trip consistency check against moonEclipticPosition
// directly (including the mean-equinox-of-date -> J2000 precession
// correction moonHeliocentricPositionAu applies on top of it — see that
// function's docstring for why this correction exists at all), not a
// re-implementation of the conversion math.
{
  const moonData = MOONS.moon;
  const parentPositionAu = { x: 1.0, y: 0.2, z: -0.01 };
  const jd = julianDateFromDate(new Date('2024-06-15T00:00:00Z'));
  const pos = moonHeliocentricPositionAu(moonData, parentPositionAu, jd);
  const { lonDeg: lonOfDateDeg, latDeg, distanceKm } = moonEclipticPosition(jd);
  const T = (jd - J2000_JD) / 36525;
  const precessionDeg = (5029.0966 / 3600) * T + (1.11113 / 3600) * T * T;
  const lonRad = (lonOfDateDeg - precessionDeg) * Math.PI / 180, latRad = latDeg * Math.PI / 180;
  const distanceAu = distanceKm / 149597870.7;
  const expectedX = parentPositionAu.x + distanceAu * Math.cos(latRad) * Math.cos(lonRad);
  const expectedY = parentPositionAu.y + distanceAu * Math.cos(latRad) * Math.sin(lonRad);
  const expectedZ = parentPositionAu.z + distanceAu * Math.sin(latRad);
  assert.ok(Math.abs(pos.x - expectedX) < 1e-9);
  assert.ok(Math.abs(pos.y - expectedY) < 1e-9);
  assert.ok(Math.abs(pos.z - expectedZ) < 1e-9);
}

// analysis/phase: analyzePhaseIllumination real-date checks. Range/shape
// validity for every supported target, plus (since v1.1's Meeus lunar
// theory swap — see core/lunar-theory.js) a real calibration check for the
// Moon specifically: a solar eclipse can only happen at new moon and a
// lunar eclipse only at full moon, so these two real historical eclipse
// dates double as independently-verifiable new-moon/full-moon reference
// points (see the eclipse reference-case tests below for the same dates'
// sourcing).
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

  const newMoonDay = analyzePhaseIllumination({ target: 'moon', atUtc: '2024-04-08T18:00:00Z', ephemerisSource: 'kepler' });
  assert.ok(newMoonDay.result.illuminatedFraction < 0.05,
    `Moon illuminated fraction on a known new-moon (solar eclipse) day should be near 0, got ${newMoonDay.result.illuminatedFraction}`);

  const fullMoonDay = analyzePhaseIllumination({ target: 'moon', atUtc: '2022-11-08T11:00:00Z', ephemerisSource: 'kepler' });
  assert.ok(fullMoonDay.result.illuminatedFraction > 0.95,
    `Moon illuminated fraction on a known full-moon (lunar eclipse) day should be near 1, got ${fullMoonDay.result.illuminatedFraction}`);
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
    'event.illuminatedFraction', 'event.classification', 'event.magnitude', 'units',
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

// analysis/export: end-to-end with a real analyzeRetrograde result
// (legacy v0.4 shape: observer is a string, frame/source are top-level,
// start/end instead of result.events[]) — confirms export.js's dual-shape
// accessor helpers actually work on the shape that ships today, not just
// the newer nested one
{
  const result = analyzeRetrograde({
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

// core/topocentric: observerGeocentricPositionAu (v1.3, WGS-84 oblate
// Earth) at the equator, sea level, LST=0 gives exactly
// {equatorialRadiusKm*AU_PER_KM, 0, 0} — the real WGS-84 equatorial
// radius (6378.137km), not the app's rendering-only mean radius
// (PLANETS.earth.radiusKm, 6371km) the pre-v1.3 spherical model used.
{
  const pos = observerGeocentricPositionAu({ latDeg: 0, elevationM: 0 }, 0);
  const expectedRAu = 6378.137 / 149597870.7;
  assert.ok(Math.abs(pos.x - expectedRAu) < 1e-12, `expected equatorial radius, got x=${pos.x}`);
  assert.ok(Math.abs(pos.y) < 1e-12 && Math.abs(pos.z) < 1e-12);
}

// core/topocentric: observerGeocentricPositionAu at the pole (lat=90) —
// u=atan(0.99664719*tan(90deg))=90deg, rhoSinPhiPrime=0.99664719,
// rhoCosPhiPrime=0 — gives the WGS-84 POLAR radius (b = a*(1-f) =
// 6356.752km), on the z-axis only, independent of LST (a pole has no
// meaningful longitude).
{
  const pos = observerGeocentricPositionAu({ latDeg: 90, elevationM: 0 }, 123);
  const expectedPolarRadiusKm = 6378.137 * (1 - 1 / 298.257223563);
  const expectedZAu = expectedPolarRadiusKm / 149597870.7;
  assert.ok(Math.abs(pos.z - expectedZAu) < 1e-9, `expected polar radius, got z=${pos.z}`);
  assert.ok(Math.abs(pos.x) < 1e-9 && Math.abs(pos.y) < 1e-9, 'x/y must vanish at the pole');
}

// core/topocentric (v1.5): precessEquatorialToDate — Meeus's own worked
// example (2nd ed., Example 21.b): theta Persei, proper-motion-corrected
// J2000 position RA 41.054063deg / Dec +49.227750deg, precessed to
// JD 2462088.69 (2028 Nov 13.19 TD), expected RA 41.547214deg /
// Dec +49.348483deg. Matches to ~1e-6 deg (verified by running it).
{
  const v = unitVectorFromRaDec(41.054063, 49.227750);
  const { raDeg, decDeg } = raDecFromEquatorial(precessEquatorialToDate(v, 2462088.69));
  assert.ok(Math.abs(raDeg - 41.547214) < 1e-5, `Meeus 21.b RA: expected 41.547214, got ${raDeg}`);
  assert.ok(Math.abs(decDeg - 49.348483) < 1e-5, `Meeus 21.b Dec: expected 49.348483, got ${decDeg}`);
  // At exactly J2000 the rotation must be the identity.
  const same = precessEquatorialToDate({ x: 0.3, y: -0.4, z: 0.86 }, J2000_JD);
  assert.ok(Math.abs(same.x - 0.3) < 1e-15 && Math.abs(same.y - -0.4) < 1e-15 && Math.abs(same.z - 0.86) < 1e-15, 'precession at J2000 must be identity');
}

// core/topocentric (v1.6): nutation — Meeus's own worked example (2nd
// ed., Example 22.a): 1987 April 10.0 TD = JD 2446895.5, expected
// dPsi = -3.788", dEps = +9.443" (full IAU 1980 series values). This
// abbreviated series measured -3.783"/+9.454" when actually run —
// tolerance 0.05" covers that truncation gap, not hand-assumed.
{
  const { dPsiDeg, dEpsDeg } = nutation(2446895.5);
  assert.ok(Math.abs(dPsiDeg * 3600 - -3.788) < 0.05, `Meeus 22.a dPsi: expected -3.788", got ${dPsiDeg * 3600}"`);
  assert.ok(Math.abs(dEpsDeg * 3600 - 9.443) < 0.05, `Meeus 22.a dEps: expected +9.443", got ${dEpsDeg * 3600}"`);
}

// core/topocentric (v1.6): nutateEquatorialToTrue preserves vector length
// (pure rotation) and moves a vector by roughly the nutation magnitude
// (~arcseconds), never by degrees.
{
  const jd = 2446895.5;
  const v = { x: 0.5, y: 0.5, z: Math.SQRT1_2 };
  const rotated = nutateEquatorialToTrue(v, jd);
  const lenBefore = Math.hypot(v.x, v.y, v.z);
  const lenAfter = Math.hypot(rotated.x, rotated.y, rotated.z);
  assert.ok(Math.abs(lenBefore - lenAfter) < 1e-14, 'nutation rotation must preserve length');
  const dot = (v.x * rotated.x + v.y * rotated.y + v.z * rotated.z) / (lenBefore * lenAfter);
  const angleArcsec = Math.acos(Math.min(1, dot)) * (180 / Math.PI) * 3600;
  assert.ok(angleArcsec > 0.1 && angleArcsec < 30, `nutation should move a vector by arcseconds, got ${angleArcsec}"`);
}

// core/topocentric (v1.6): eqEquinoxDeg = dPsi*cos(eps) — for Meeus 22.a's
// dPsi = -3.788", expect about -3.48" (cos 23.44deg ~ 0.917), tiny but
// nonzero, and consistent with nutation()'s own dPsi.
{
  const expectedDeg = nutation(2446895.5).dPsiDeg * Math.cos(OBLIQUITY_DEG * Math.PI / 180);
  assert.ok(Math.abs(eqEquinoxDeg(2446895.5) - expectedDeg) < 1e-15, 'eqEquinoxDeg must equal dPsi*cos(eps)');
  assert.ok(Math.abs(eqEquinoxDeg(2446895.5) * 3600 - -3.47) < 0.1, `expected ~-3.47", got ${eqEquinoxDeg(2446895.5) * 3600}"`);
}

// core/units + analysis/observer (v1.6): the aberration constant — a unit
// direction perpendicular to a velocity of Earth's mean orbital speed
// (~29.79 km/s = 0.0172 AU/day) is displaced by ~20.5" (kappa, the
// classical annual aberration constant).
{
  const vEarthAuPerDay = 29.7859 * 86400 / 149597870.7;
  const kappaArcsec = (vEarthAuPerDay / C_AU_PER_DAY) * (180 / Math.PI) * 3600;
  assert.ok(Math.abs(kappaArcsec - 20.5) < 0.1, `aberration constant: expected ~20.5", got ${kappaArcsec}"`);
}

// core/topocentric: refractionArcmin — 0 at zenith, Bennett's well-known
// ~34' figure at the true-altitude horizon, and 0 (not extrapolated into
// the formula's singularity) below -1deg.
{
  assert.ok(Math.abs(refractionArcmin(90)) < 0.01, `expected ~0' at zenith, got ${refractionArcmin(90)}'`);
  // ~28.2' at h=0, not the more commonly quoted ~34' figure — that's
  // Bennett's APPARENT-altitude form (different coefficients); this is the
  // TRUE-altitude form (Meeus's 1.02/10.3/5.11 version), the one that maps
  // in the direction this codebase actually needs (geometric -> apparent).
  assert.ok(Math.abs(refractionArcmin(0) - 28.2) < 1, `expected ~28.2' at the horizon, got ${refractionArcmin(0)}'`);
  assert.equal(refractionArcmin(-5), 0, 'clamped to 0 well below the horizon');
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
// instead of a fabricated rise/set, matching analyzeRetrograde's
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

// analysis/observer: real reference case (v1.3) — Kaohsiung (this app's
// own Observer Mode default lat/lon), sunrise/sunset per timeanddate.com's
// published table for 2026-03-20 local time: sunrise 06:02 (UTC+8 ->
// 2026-03-19T22:02Z), sunset 18:09 (-> 2026-03-20T10:09Z). Each is checked
// against the UTC calendar day that actually contains it (a UTC+8
// location's local-evening event and the next local-morning event don't
// share a UTC day, so this is two separate day-scans, not one). Tolerance
// set by actually running this implementation (v1.3 measured ~26s and ~4s;
// after v1.5's precession-to-of-date the gaps re-measured at ~49s and ~79s
// — the old J2000/of-date equinox mixing happened to partially cancel
// other error terms here, so a frame-consistent answer moves individual
// numbers slightly while being more correct overall; v1.6's nutation/
// aberration re-measured identically at ~49s/~79s — their ~1-15" effects
// are below the solver's 60s bisection tolerance quantization) — 3
// minutes comfortably covers that with margin for this app's remaining
// documented approximation (low-precision Kepler Sun position), not
// hand-assumed. Before v1.3 (no refraction/oblateness), this same case
// was off by several minutes.
{
  const kaohsiung = { latDeg: 22.6273, lonDeg: 120.3014, elevationM: 0 };
  const riseDay = analyzeObserver({ target: 'sun', atUtc: '2026-03-19T00:00:00Z', ...kaohsiung });
  const setDay = analyzeObserver({ target: 'sun', atUtc: '2026-03-20T00:00:00Z', ...kaohsiung });
  const rise = riseDay.result.events.find((e) => e.event === 'rise');
  const set = setDay.result.events.find((e) => e.event === 'set');
  assert.ok(rise, 'expected a sunrise event');
  assert.ok(set, 'expected a sunset event');
  const riseGapSeconds = Math.abs(new Date(rise.epochUtc) - new Date('2026-03-19T22:02:00Z')) / 1000;
  const setGapSeconds = Math.abs(new Date(set.epochUtc) - new Date('2026-03-20T10:09:00Z')) / 1000;
  assert.ok(riseGapSeconds < 180, `sunrise should be within 3min of the published almanac time, got ${riseGapSeconds}s off`);
  assert.ok(setGapSeconds < 180, `sunset should be within 3min of the published almanac time, got ${setGapSeconds}s off`);
}

// analysis/eclipse: real reference case — the 2022-11-08 total lunar
// eclipse (greatest eclipse 10:59 UT per NASA/Espenak eclipse predictions,
// central/umbral magnitude 1.359). Peak-time tolerance is a few hours, not
// minutes — this model finds the elongation-extremum (full moon) instant,
// not the true minimum-shadow-axis-distance instant (see eclipse.js's
// documented simplification).
{
  const result = analyzeLunarEclipse({ startUtc: '2022-11-01T00:00:00Z', endUtc: '2022-11-15T00:00:00Z' });
  assert.equal(result.result.events.length, 1, 'expected exactly one (real) eclipse in this window');
  const [event] = result.result.events;
  assert.equal(event.classification, 'total');
  assert.ok(event.magnitude > 0.9, `expected umbral magnitude > 0.9 (real value 1.359), got ${event.magnitude}`);
  const deltaHours = Math.abs(new Date(event.epochUtc) - new Date('2022-11-08T11:00:00Z')) / 3600000;
  assert.ok(deltaHours < 6, `greatest-eclipse time should be within a few hours of the real 2022-11-08 11:00 UT, off by ${deltaHours}h`);

  // v1.9 contact-time table — NASA/Espenak published times for this
  // eclipse: P1 08:02, U1 09:09, U2 10:16, U3 11:42, U4 12:49, P4 13:56 UT.
  // 30-minute tolerance is generous headroom over the few minutes this
  // model actually lands within (see docs/accuracy.md).
  const CONTACT_TOLERANCE_MIN = 30;
  const expectedLunarContacts = {
    p1Utc: '2022-11-08T08:02:00Z', u1Utc: '2022-11-08T09:09:00Z',
    u2Utc: '2022-11-08T10:16:00Z', u3Utc: '2022-11-08T11:42:00Z',
    u4Utc: '2022-11-08T12:49:00Z', p4Utc: '2022-11-08T13:56:00Z',
  };
  for (const [key, expectedUtc] of Object.entries(expectedLunarContacts)) {
    assert.ok(event.contacts[key] != null, `expected non-null lunar contact ${key} for a total eclipse`);
    const diffMin = Math.abs(new Date(event.contacts[key]) - new Date(expectedUtc)) / 60000;
    assert.ok(diffMin < CONTACT_TOLERANCE_MIN, `lunar contact ${key} should be within ${CONTACT_TOLERANCE_MIN}min of ${expectedUtc}, off by ${diffMin}min`);
  }
}

// analysis/eclipse: a full moon with no real eclipse (Aug 2022) correctly
// reports no events, not a false positive — the actual point of replacing
// the old zero-inclination Moon model.
{
  const result = analyzeLunarEclipse({ startUtc: '2022-08-01T00:00:00Z', endUtc: '2022-08-20T00:00:00Z' });
  assert.equal(result.result.events.length, 0, 'August 2022 has a full moon but no real lunar eclipse');
  assert.equal(result.solver.status, 'no-events-in-range');
}

// analysis/eclipse: real reference case — the 2024-04-08 total solar
// eclipse, evaluated from Dallas, TX (in the path of totality per NASA)
// and from Tokyo (night-time there at eclipse instant — Sun below the
// horizon, a location/time guaranteed to see nothing regardless of any
// model imprecision, not just "far from the path").
{
  const dallas = analyzeSolarEclipse({
    startUtc: '2024-04-01T00:00:00Z', endUtc: '2024-04-15T00:00:00Z',
    latDeg: 32.7767, lonDeg: -96.7970, elevationM: 130,
  });
  assert.equal(dallas.result.events.length, 1, 'expected exactly one solar eclipse visible from Dallas in this window');
  assert.equal(dallas.result.events[0].classification, 'total');
  assert.ok(dallas.result.events[0].magnitude > 0.9, `expected magnitude > 0.9 for totality, got ${dallas.result.events[0].magnitude}`);

  // v1.9 contact-time table — NASA published local circumstances for
  // Dallas, TX: C1 ~17:23, C2 ~18:40, C3 ~18:44, C4 ~20:01 UT.
  const dallasContacts = dallas.result.events[0].contacts;
  const expectedSolarContacts = {
    c1Utc: '2024-04-08T17:23:00Z', c2Utc: '2024-04-08T18:40:00Z',
    c3Utc: '2024-04-08T18:44:00Z', c4Utc: '2024-04-08T20:01:00Z',
  };
  for (const [key, expectedUtc] of Object.entries(expectedSolarContacts)) {
    assert.ok(dallasContacts[key] != null, `expected non-null solar contact ${key} for a total eclipse`);
    const diffMin = Math.abs(new Date(dallasContacts[key]) - new Date(expectedUtc)) / 60000;
    assert.ok(diffMin < 30, `solar contact ${key} should be within 30min of ${expectedUtc}, off by ${diffMin}min`);
  }

  const tokyo = analyzeSolarEclipse({
    startUtc: '2024-04-01T00:00:00Z', endUtc: '2024-04-15T00:00:00Z',
    latDeg: 35.6762, lonDeg: 139.6503, elevationM: 0,
  });
  assert.equal(tokyo.result.events.length, 0, 'the 2024-04-08 eclipse happens at night in Tokyo — nothing observable there');
}

// analysis/eclipse: invalid observer lat/lon throws
{
  assert.throws(() => analyzeSolarEclipse({
    startUtc: '2024-01-01T00:00:00Z', endUtc: '2024-02-01T00:00:00Z', latDeg: 999, lonDeg: 0,
  }));
}

// analysis/retrograde (v1.5, generalized): real reference case — Jupiter's
// 2022 retrograde loop (station retrograde 2022-07-28, station direct
// 2022-11-23, per Nolle's retrograde tables / astro-seek). Same
// calendar-window assertion style as the Mars case above.
{
  const result = analyzeRetrograde({
    target: 'jupiter', startUtc: '2022-06-01T00:00:00Z', endUtc: '2023-01-15T00:00:00Z',
    intervalHours: 6, ephemerisSource: 'kepler',
  });
  assert.equal(result.target, 'jupiter');
  assert.ok(result.start && result.end, 'expected both stationary points in this known Jupiter retrograde window');
  assert.equal(result.start.event, 'stationary-direct-to-retrograde');
  assert.equal(result.end.event, 'stationary-retrograde-to-direct');
  const firstDate = new Date(result.start.epochUtc);
  const secondDate = new Date(result.end.epochUtc);
  assert.ok(firstDate >= new Date('2022-07-01T00:00:00Z') && firstDate <= new Date('2022-08-15T00:00:00Z'),
    `Jupiter station retrograde ${result.start.epochUtc} expected around late July 2022 (real: 2022-07-28)`);
  assert.ok(secondDate >= new Date('2022-11-01T00:00:00Z') && secondDate <= new Date('2022-12-15T00:00:00Z'),
    `Jupiter station direct ${result.end.epochUtc} expected around late Nov 2022 (real: 2022-11-23)`);
}

// analysis/retrograde (v1.5): invalid target throws; earth excluded.
{
  assert.throws(() => analyzeRetrograde({ target: 'earth', startUtc: '2022-01-01T00:00:00Z', endUtc: '2022-06-01T00:00:00Z' }));
}

// analysis/eclipse: angularSeparationDeg (v1.4, exported for reuse by
// analysis/occultation.js) — spherical law of cosines, sanity-checked
// against two trivial cases.
{
  assert.equal(angularSeparationDeg(10, 20, 10, 20), 0, 'separation between identical RA/Dec should be 0');
  assert.ok(Math.abs(angularSeparationDeg(0, 0, 90, 0) - 90) < 1e-9, 'two points 90 deg apart on the celestial equator should separate by 90 deg');
}

// analysis/transit: real reference case — the 2019-11-11 Mercury transit
// (Espenak/eclipsewise.com: geocentric greatest transit 15:19:48 UT,
// separation 75.9"), evaluated from New York (in the visibility path for
// the whole transit per Espenak's table).
{
  const result = analyzeTransit({
    target: 'mercury', startUtc: '2019-11-01T00:00:00Z', endUtc: '2019-12-01T00:00:00Z',
    latDeg: 40.7128, lonDeg: -74.0060, elevationM: 0,
  });
  assert.equal(result.result.events.length, 1, 'expected exactly one Mercury transit visible from New York in this window');
  const [event] = result.result.events;
  assert.equal(event.classification, 'transit', 'Mercury\'s disk (~76" from Sun center) should be fully within the Sun\'s disk');
  const deltaMinutes = Math.abs(new Date(event.epochUtc) - new Date('2019-11-11T15:19:48Z')) / 60000;
  assert.ok(deltaMinutes < 10, `greatest-transit time should be within ~10 min of the real 2019-11-11 15:19:48 UT (measured gap ~4 min — topocentric parallax alone accounts for up to ~2 min per Espenak), off by ${deltaMinutes}min`);
}

// analysis/transit: an ordinary Mercury inferior conjunction with no real
// transit (~2020-03-24, next transit isn't until 2032) correctly reports
// no events — same "no false positive" discipline as the eclipse tests.
{
  const result = analyzeTransit({
    target: 'mercury', startUtc: '2020-03-01T00:00:00Z', endUtc: '2020-04-15T00:00:00Z',
    latDeg: 40.7128, lonDeg: -74.0060, elevationM: 0,
  });
  assert.equal(result.result.events.length, 0, 'March 2020 has a Mercury inferior conjunction but no real transit');
  assert.equal(result.solver.status, 'no-events-in-range');
}

// analysis/transit: real reference case — the 2012-06-05/06 Venus transit
// (NASA/Espenak: geocentric greatest transit 2012-06-06 01:29:36 UT,
// separation 553"), evaluated from Los Angeles (saw the beginning of the
// transit through greatest transit before it continued past local
// midnight, per NASA's visibility notes).
{
  const result = analyzeTransit({
    target: 'venus', startUtc: '2012-06-01T00:00:00Z', endUtc: '2012-06-15T00:00:00Z',
    latDeg: 34.0522, lonDeg: -118.2437, elevationM: 0,
  });
  assert.equal(result.result.events.length, 1, 'expected exactly one Venus transit visible from Los Angeles in this window');
  const [event] = result.result.events;
  assert.equal(event.classification, 'transit', 'Venus\'s disk (~553" from Sun center) should be fully within the Sun\'s disk');
  const deltaMinutes = Math.abs(new Date(event.epochUtc) - new Date('2012-06-06T01:29:36Z')) / 60000;
  assert.ok(deltaMinutes < 10, `greatest-transit time should be within ~10 min of the real 2012-06-06 01:29:36 UT (measured gap ~2 min — topocentric parallax alone accounts for up to ~7 min per NASA), off by ${deltaMinutes}min`);
}

// analysis/transit: an ordinary Venus inferior conjunction with no real
// transit (~2014-01, next transit isn't until 2117).
{
  const result = analyzeTransit({
    target: 'venus', startUtc: '2013-12-01T00:00:00Z', endUtc: '2014-02-01T00:00:00Z',
    latDeg: 34.0522, lonDeg: -118.2437, elevationM: 0,
  });
  assert.equal(result.result.events.length, 0, 'this window has a Venus inferior conjunction but no real transit');
}

// analysis/appulse: real reference case — the 2020-12-21 "Great
// Conjunction" of Jupiter and Saturn, the closest appulse of the two since
// 1623, separation ~0.1° (~6 arcminutes, widely reported).
{
  const result = analyzeAppulse({
    planetA: 'jupiter', planetB: 'saturn', startUtc: '2020-11-01T00:00:00Z', endUtc: '2021-01-15T00:00:00Z',
  });
  assert.equal(result.result.events.length, 1, 'expected exactly one Jupiter-Saturn closest approach in this window');
  const [event] = result.result.events;
  assert.ok(event.separationDeg < 0.15, `expected the Great Conjunction's separation to be close to the real ~0.1 deg, got ${event.separationDeg}`);
  const deltaHours = Math.abs(new Date(event.epochUtc) - new Date('2020-12-21T18:00:00Z')) / 3600000;
  assert.ok(deltaHours < 24, `closest-approach time should be within ~1 day of the widely-reported 2020-12-21 ~18:00 UT, off by ${deltaHours}h (measured ~10h)`);
}

// analysis/appulse: invalid target combinations throw rather than silently
// misbehaving.
{
  assert.throws(() => analyzeAppulse({ planetA: 'earth', planetB: 'mars', startUtc: '2020-01-01T00:00:00Z', endUtc: '2020-02-01T00:00:00Z' }), 'Earth cannot be an appulse target (it is the observer)');
  assert.throws(() => analyzeAppulse({ planetA: 'mars', planetB: 'mars', startUtc: '2020-01-01T00:00:00Z', endUtc: '2020-02-01T00:00:00Z' }), 'planetA and planetB must differ');
  assert.ok(!APPULSE_TARGETS.includes('earth'));
}

// analysis/occultation: real reference case — the 2021-11-08 lunar
// occultation of Venus, visible from Japan roughly 04:40-05:59 UTC
// (in-the-sky.org), evaluated from Tokyo.
{
  const result = analyzeLunarOccultation({
    target: 'venus', startUtc: '2021-11-01T00:00:00Z', endUtc: '2021-11-15T00:00:00Z',
    latDeg: 35.6762, lonDeg: 139.6503, elevationM: 0,
  });
  assert.equal(result.result.events.length, 1, 'expected exactly one lunar occultation of Venus visible from Tokyo in this window');
  const [event] = result.result.events;
  assert.equal(event.classification, 'total', 'Venus should be fully hidden behind the Moon\'s much larger disk');
  const deltaMinutes = Math.abs(new Date(event.epochUtc) - new Date('2021-11-08T05:20:00Z')) / 60000;
  assert.ok(deltaMinutes < 30, `closest-approach time should be within the real ~04:40-05:59 UTC visibility window (measured ~3 min from its midpoint), off by ${deltaMinutes}min`);
}

// analysis/occultation: an ordinary month with no real occultation of
// Venus visible from Tokyo correctly reports no events.
{
  const result = analyzeLunarOccultation({
    target: 'venus', startUtc: '2021-09-01T00:00:00Z', endUtc: '2021-09-15T00:00:00Z',
    latDeg: 35.6762, lonDeg: 139.6503, elevationM: 0,
  });
  assert.equal(result.result.events.length, 0, 'September 2021 has no real lunar occultation of Venus visible from Tokyo');
}

// analysis/occultation: invalid target (Moon can't occult itself or the
// Sun in this event type's scope) throws.
{
  assert.throws(() => analyzeLunarOccultation({ target: 'moon', startUtc: '2021-01-01T00:00:00Z', endUtc: '2021-02-01T00:00:00Z', latDeg: 0, lonDeg: 0 }));
  assert.ok(!OCCULTATION_TARGETS.includes('moon') && !OCCULTATION_TARGETS.includes('sun'));
}

// core/topocentric: equatorialToEcliptic is the exact inverse of
// eclipticToEquatorial (round-trips an arbitrary vector back to itself),
// and unitVectorFromRaDec is the exact inverse of raDecFromEquatorial
// (round-trips RA/Dec back to itself) — the two new v1.2 helpers agree
// with the pair they mirror.
{
  const v = { x: 0.4, y: -0.6, z: 0.7 };
  const roundTripped = equatorialToEcliptic(eclipticToEquatorial(v));
  assert.ok(Math.abs(roundTripped.x - v.x) < 1e-12);
  assert.ok(Math.abs(roundTripped.y - v.y) < 1e-12);
  assert.ok(Math.abs(roundTripped.z - v.z) < 1e-12);

  const { raDeg, decDeg } = raDecFromEquatorial(unitVectorFromRaDec(101.2872, -16.7161));
  assert.ok(Math.abs(raDeg - 101.2872) < 1e-9);
  assert.ok(Math.abs(decDeg - (-16.7161)) < 1e-9);
}

// core/star-catalog: loadStarCatalog on a small fixture — array shapes
// match the star count, every position is on the unit sphere, and
// brightness/size correctly order brighter (lower/more-negative mag)
// stars above fainter ones. Fixture includes Sirius's real id/mag/bv/
// coordinates (HIP 32349, RA 101.2872deg/Dec -16.7161deg) as an
// independent real-world anchor, not just internally-consistent fake data.
{
  const fixture = {
    features: [
      { id: 32349, properties: { mag: -1.44, bv: '0.009' }, geometry: { type: 'Point', coordinates: [101.2872, -16.7161] } },
      { id: 1, properties: { mag: 3.0, bv: '1.2' }, geometry: { type: 'Point', coordinates: [10, 20] } },
      { id: 2, properties: { mag: 6.4, bv: undefined }, geometry: { type: 'Point', coordinates: [-90, -45] } },
    ],
  };
  const cat = loadStarCatalog(fixture);
  assert.equal(cat.positions.length, 3 * 3);
  assert.equal(cat.colors.length, 3 * 3);
  assert.equal(cat.sizes.length, 3);
  assert.equal(cat.brightness.length, 3);
  for (let i = 0; i < 3; i++) {
    const r = Math.hypot(cat.positions[i * 3], cat.positions[i * 3 + 1], cat.positions[i * 3 + 2]);
    assert.ok(Math.abs(r - 1) < 1e-6, `star ${i} must be on the unit sphere, got r=${r}`);
  }
  assert.ok(cat.brightness[0] > cat.brightness[1], 'Sirius (mag -1.44) must be brighter than mag 3.0');
  assert.ok(cat.brightness[1] > cat.brightness[2], 'mag 3.0 must be brighter than mag 6.4');
  assert.ok(cat.sizes[0] > cat.sizes[1] && cat.sizes[1] > cat.sizes[2], 'point size must track brightness');
  // no-bv star (index 2) falls back to white rather than throwing/NaN
  assert.deepEqual([cat.colors[6], cat.colors[7], cat.colors[8]], [1, 1, 1]);

  // Sirius's own position matches an independently-computed expected
  // ecliptic-frame unit vector for its real RA/Dec.
  const expected = equatorialToEcliptic(unitVectorFromRaDec(101.2872, -16.7161));
  assert.ok(Math.abs(cat.positions[0] - expected.x) < 1e-5);
  assert.ok(Math.abs(cat.positions[1] - expected.y) < 1e-5);
  assert.ok(Math.abs(cat.positions[2] - expected.z) < 1e-5);
}

// core/star-catalog: constellationLineSegments produces exactly 2 points
// (6 floats) per line segment — one segment per consecutive coordinate
// pair across every MultiLineString part, and every point lands on the
// unit sphere.
{
  const fixture = {
    features: [
      { id: 'Fix', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [10, 0], [10, 10]], [[50, 50], [60, 60]]] } },
    ],
  };
  // part 1 has 3 points -> 2 segments; part 2 has 2 points -> 1 segment; 3 segments * 6 floats each
  const segs = constellationLineSegments(fixture);
  assert.equal(segs.length, 3 * 6);
  for (let i = 0; i < segs.length; i += 3) {
    const r = Math.hypot(segs[i], segs[i + 1], segs[i + 2]);
    assert.ok(Math.abs(r - 1) < 1e-6, `segment endpoint must be on the unit sphere, got r=${r}`);
  }
}

// core/star-catalog: constellationLabelPositions filters to maxRank (default
// 1, the ~22 most recognizable constellations — labeling all 88 would
// recreate the clutter this was added to fix), and every returned position
// is on the unit sphere.
{
  const fixture = {
    features: [
      { id: 'Ori', properties: { name: 'Orion', rank: '1' }, geometry: { type: 'Point', coordinates: [83, 5] } },
      { id: 'Lac', properties: { name: 'Lacerta', rank: '3' }, geometry: { type: 'Point', coordinates: [340, 46] } },
    ],
  };
  const defaultRank = constellationLabelPositions(fixture);
  assert.equal(defaultRank.length, 1, 'default maxRank=1 keeps only rank-1 constellations');
  assert.equal(defaultRank[0].name, 'Orion');
  const r = Math.hypot(defaultRank[0].x, defaultRank[0].y, defaultRank[0].z);
  assert.ok(Math.abs(r - 1) < 1e-6, `label position must be on the unit sphere, got r=${r}`);

  const allRanks = constellationLabelPositions(fixture, 3);
  assert.equal(allRanks.length, 2, 'maxRank=3 keeps both');
}

// url-state (v0.8): round-trip encode->decode for each camera mode that
// carries extra fields, and malformed/out-of-range/missing input degrades
// to an empty (all-default) result rather than throwing.
{
  const date = new Date('2026-09-05T00:00:00Z');

  // Heliocentric top-down + focus body round-trips.
  let state = setFocusBody(createCameraState(CAMERA_MODES.HELIOCENTRIC_TOPDOWN), 'jupiter');
  let params = encodeAppStateToParams({ currentDate: date, cameraState: state });
  let decoded = decodeAppStateFromParams(params);
  assert.equal(decoded.date.toISOString().slice(0, 10), '2026-09-05');
  assert.equal(decoded.mode, CAMERA_MODES.HELIOCENTRIC_TOPDOWN);
  assert.equal(decoded.focus, 'jupiter');

  // Geocentric + focus body round-trips (focus lives at .geocentric.focusBody, not .focusBody).
  state = enterGeocentric(createCameraState(), { earth: { x: 1, y: 0, z: 0 }, saturn: { x: 5, y: 0, z: 0 } }, 'saturn');
  decoded = decodeAppStateFromParams(encodeAppStateToParams({ currentDate: date, cameraState: state }));
  assert.equal(decoded.mode, CAMERA_MODES.GEOCENTRIC);
  assert.equal(decoded.focus, 'saturn');

  // Surface + planet/lat/lon round-trips (rounded to 2 decimals).
  state = setMode(createCameraState(), CAMERA_MODES.SURFACE_FIRST_PERSON, { planet: 'mars', lat: 22.6273, lon: 120.3014 });
  decoded = decodeAppStateFromParams(encodeAppStateToParams({ currentDate: date, cameraState: state }));
  assert.equal(decoded.mode, CAMERA_MODES.SURFACE_FIRST_PERSON);
  assert.equal(decoded.planet, 'mars');
  assert.equal(decoded.lat, 22.63);
  assert.equal(decoded.lon, 120.3);

  // Malformed/garbage input: every field silently omitted, never thrown.
  decoded = decodeAppStateFromParams(new URLSearchParams('mode=bogus&lat=999&lon=0&date=not-a-date'));
  assert.deepEqual(decoded, {}, `garbage input must decode to no overrides, got ${JSON.stringify(decoded)}`);

  // Missing params entirely.
  decoded = decodeAppStateFromParams(new URLSearchParams(''));
  assert.deepEqual(decoded, {});
}

// core/ephemeris (v1.7): getLightTimeCorrectedState actually retards the
// target — Neptune's light-time (~4 light-hours, ~0.17 day at ~30 AU) is
// large enough that the corrected position measurably differs from the
// uncorrected one, and the implied light-time itself falls in the
// expected physical range (Neptune's Earth-distance ranges ~29-31 AU
// across its orbit, i.e. ~0.167-0.179 light-day).
{
  const jsDate = new Date('2026-01-01T00:00:00Z');
  const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource: 'kepler' });
  const uncorrected = getBodyState('neptune', jsDate, PLANETS.neptune.elements, { forceSource: 'kepler' });
  const corrected = getLightTimeCorrectedState('neptune', jsDate, PLANETS.neptune.elements, earthState.positionAu, { forceSource: 'kepler' });

  const shiftAu = Math.hypot(
    corrected.positionAu.x - uncorrected.positionAu.x,
    corrected.positionAu.y - uncorrected.positionAu.y,
    corrected.positionAu.z - uncorrected.positionAu.z,
  );
  assert.ok(shiftAu > 0.0003, `expected a measurable light-time shift for Neptune, got ${shiftAu} AU`);

  const distAu = Math.hypot(
    corrected.positionAu.x - earthState.positionAu.x,
    corrected.positionAu.y - earthState.positionAu.y,
    corrected.positionAu.z - earthState.positionAu.z,
  );
  const lightTimeDays = distAu / C_AU_PER_DAY;
  assert.ok(lightTimeDays > 0.15 && lightTimeDays < 0.2, `Neptune's light-time should be roughly 0.167-0.179 day at this range, got ${lightTimeDays}`);

  // Convergence: one more manual iteration past what getLightTimeCorrectedState
  // already did (2 fixed iterations) should move the position by a
  // negligible amount — confirms 2 iterations is already converged, not
  // an arbitrary cutoff.
  const retardedDate = new Date(jsDate.getTime() - lightTimeDays * 86400000);
  const oneMoreIteration = getBodyState('neptune', retardedDate, PLANETS.neptune.elements, { forceSource: 'kepler' });
  const driftAu = Math.hypot(
    oneMoreIteration.positionAu.x - corrected.positionAu.x,
    oneMoreIteration.positionAu.y - corrected.positionAu.y,
    oneMoreIteration.positionAu.z - corrected.positionAu.z,
  );
  assert.ok(driftAu < 1e-9, `expected the 2-iteration result to already be converged, got a further drift of ${driftAu} AU`);
}

// analysis/moon-conjunction (v1.7): real reference case — the same
// 2021-11-08 Moon-Venus event analysis/occultation.js tests (visible from
// Tokyo ~04:40-05:59 UTC per in-the-sky.org) should also show up here as
// a close conjunction whose disks actually overlap (wouldOccult: true) —
// the two event types agreeing on the same real event.
{
  const result = analyzeMoonConjunction({
    target: 'venus', startUtc: '2021-11-01T00:00:00Z', endUtc: '2021-11-15T00:00:00Z',
    latDeg: 35.6762, lonDeg: 139.6503, elevationM: 0,
  });
  assert.equal(result.result.events.length, 1, 'expected exactly one Moon-Venus conjunction in this window');
  const [event] = result.result.events;
  assert.ok(event.wouldOccult, 'this real occultation should also register as a conjunction whose disks overlap');
  const deltaMinutes = Math.abs(new Date(event.epochUtc) - new Date('2021-11-08T05:20:00Z')) / 60000;
  assert.ok(deltaMinutes < 30, `closest-approach time should be within the real ~04:40-05:59 UTC window, off by ${deltaMinutes}min`);
}

// analysis/moon-conjunction: real reference case — the 2022-05-27
// Moon-Venus conjunction (in-the-sky.org: Moon passes 12' / 0.2deg south
// of Venus at the RA-match moment, visible from Tehran at dawn). Loose
// tolerance since this topocentric closest-approach differs slightly from
// the geocentric RA-match circumstance quoted by the source.
{
  const result = analyzeMoonConjunction({
    target: 'venus', startUtc: '2022-05-20T00:00:00Z', endUtc: '2022-06-01T00:00:00Z',
    latDeg: 35.6892, lonDeg: 51.3890, elevationM: 0,
  });
  assert.equal(result.result.events.length, 1, 'expected exactly one Moon-Venus conjunction in this window');
  const [event] = result.result.events;
  assert.ok(event.separationDeg < 1.0, `expected a close approach near the real ~0.2deg, got ${event.separationDeg}deg`);
  const deltaHours = Math.abs(new Date(event.epochUtc) - new Date('2022-05-27T02:00:00Z')) / 3600000;
  assert.ok(deltaHours < 24, `closest-approach time should be within ~1 day of the real 2022-05-27 event, off by ${deltaHours}h`);
}

// analysis/moon-conjunction: invalid target (Moon/Sun excluded, same
// scope as OCCULTATION_TARGETS) throws.
{
  assert.throws(() => analyzeMoonConjunction({ target: 'moon', startUtc: '2021-01-01T00:00:00Z', endUtc: '2021-02-01T00:00:00Z', latDeg: 0, lonDeg: 0 }));
  assert.throws(() => analyzeMoonConjunction({ target: 'sun', startUtc: '2021-01-01T00:00:00Z', endUtc: '2021-02-01T00:00:00Z', latDeg: 0, lonDeg: 0 }));
  assert.deepEqual(MOON_CONJUNCTION_TARGETS, OCCULTATION_TARGETS);
}

// scripts/changelog-excerpt (v1.8.7): pulls one version's section out of
// CHANGELOG.md for release.yml's GitHub Release body — must stop at the
// next "## " heading (not bleed into the following version) and throw a
// clear error for a version with no section, rather than release.yml
// silently publishing an empty or wrong-version Release.
{
  const fakeChangelog = [
    '# Changelog',
    '',
    '## v2.0 — 2030-01-01',
    '',
    '- second entry line one',
    '- second entry line two',
    '',
    '## v1.0 — 2029-01-01',
    '',
    '- first entry',
  ].join('\n');
  assert.equal(extractChangelogSection(fakeChangelog, 'v2.0'), '- second entry line one\n- second entry line two', 'must extract only the named version\'s lines, stopping before the next heading');
  assert.equal(extractChangelogSection(fakeChangelog, 'v1.0'), '- first entry', 'must also work for the last section in the file (no following heading to stop at)');
  assert.throws(() => extractChangelogSection(fakeChangelog, 'v9.9'), /No CHANGELOG\.md section found/, 'a version with no heading must throw, not silently return an empty/wrong section');
  // And against the real file: every version this session actually shipped must still be found.
  const realChangelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  for (const version of ['v1.0.0', 'v1.8', 'v1.8.6']) {
    assert.ok(extractChangelogSection(realChangelog, version).length > 0, `CHANGELOG.md must have a non-empty section for ${version}`);
  }
}

// event-toolkit-persistence (v1.9): applySavedDefaults is the pure logic
// behind Event Toolkit input persistence — only the DOM-facing
// localStorage read/write wrappers are untested here (thin browser-API
// shim, no localStorage in Node, same carve-out as other DOM-only code).
{
  const selectField = { key: 'target', type: 'select', default: 'mars', options: [{ value: 'mars' }, { value: 'venus' }] };
  const numberField = { key: 'intervalHours', type: 'number', default: 6, min: 1, max: 100 };
  const dateField = { key: 'startUtc', type: 'date', default: '2022-01-01' };
  const fields = [selectField, numberField, dateField];

  // No saved values at all: fields pass through unchanged.
  assert.deepEqual(applySavedDefaults(fields, null), fields, 'null saved must return fields unchanged');

  // Valid override for every field type.
  let result = applySavedDefaults(fields, { target: 'venus', intervalHours: 24, startUtc: '2023-06-15' });
  assert.equal(result[0].default, 'venus');
  assert.equal(result[1].default, 24);
  assert.equal(result[2].default, '2023-06-15');

  // Invalid select value (not one of this field's options) falls through to the original default.
  result = applySavedDefaults(fields, { target: 'jupiter' });
  assert.equal(result[0].default, 'mars', 'an unknown select option must not override the default');

  // Out-of-range number is clamped, not rejected outright.
  result = applySavedDefaults(fields, { intervalHours: 500 });
  assert.equal(result[1].default, 100, 'a saved number above max must clamp to max, not pass through raw');
  result = applySavedDefaults(fields, { intervalHours: 0.001 });
  assert.equal(result[1].default, 1, 'a saved number below min must clamp to min');

  // Non-finite number and empty date string are both ignored.
  result = applySavedDefaults(fields, { intervalHours: NaN, startUtc: '' });
  assert.equal(result[1].default, 6);
  assert.equal(result[2].default, '2022-01-01');

  // A key this field set doesn't have is simply ignored, not an error.
  result = applySavedDefaults(fields, { nonexistentKey: 'whatever' });
  assert.deepEqual(result, fields);
}

// analysis/best-night (v1.11): scoreNight is pure — no ephemeris call — so
// every scoring rule is directly checkable with synthetic inputs.
{
  const base = { peakAltitudeDeg: 45, moonAboveHorizon: false, moonIlluminatedFraction: 0.5, distanceAu: 1, minDistanceAu: 0.5, maxDistanceAu: 2 };

  // Moon below horizon gives full darkness credit regardless of illuminated fraction.
  const belowFull = scoreNight({ ...base, moonAboveHorizon: false, moonIlluminatedFraction: 1 });
  const belowNew = scoreNight({ ...base, moonAboveHorizon: false, moonIlluminatedFraction: 0 });
  assert.equal(belowFull, belowNew, 'moon below horizon must score identically regardless of phase');

  // Moon above horizon at full illumination gives zero darkness credit (lower than new moon above horizon).
  const aboveFull = scoreNight({ ...base, moonAboveHorizon: true, moonIlluminatedFraction: 1 });
  const aboveNew = scoreNight({ ...base, moonAboveHorizon: true, moonIlluminatedFraction: 0 });
  assert.ok(aboveFull < aboveNew, 'a risen full moon must score worse than a risen new moon');
  assert.ok(aboveNew <= belowFull + 1e-9, 'a risen new moon must not out-score a set moon (both should tie at max darkness credit)');

  // Distance at the bounds gives max/zero closeness credit.
  const closest = scoreNight({ ...base, distanceAu: 0.5 });
  const farthest = scoreNight({ ...base, distanceAu: 2 });
  assert.ok(closest > farthest, 'distance at minDistanceAu must score higher than at maxDistanceAu');

  // Altitude of 90deg/0deg gives max/zero altitude credit.
  const highAlt = scoreNight({ ...base, peakAltitudeDeg: 90 });
  const lowAlt = scoreNight({ ...base, peakAltitudeDeg: 0 });
  assert.ok(highAlt > lowAlt, 'higher peak altitude must score higher');

  // Output always in [0, 100] across a spread of inputs, including the
  // degenerate minDistanceAu===maxDistanceAu case (closeness undefined -> 0).
  for (const input of [
    { peakAltitudeDeg: 90, moonAboveHorizon: false, moonIlluminatedFraction: 0, distanceAu: 0.5, minDistanceAu: 0.5, maxDistanceAu: 2 },
    { peakAltitudeDeg: 0, moonAboveHorizon: true, moonIlluminatedFraction: 1, distanceAu: 2, minDistanceAu: 0.5, maxDistanceAu: 2 },
    { peakAltitudeDeg: 45, moonAboveHorizon: true, moonIlluminatedFraction: 0.5, distanceAu: 1, minDistanceAu: 1, maxDistanceAu: 1 },
  ]) {
    const score = scoreNight(input);
    assert.ok(score >= 0 && score <= 100, `score must be in [0,100], got ${score} for ${JSON.stringify(input)}`);
  }
}

// analysis/best-night: integration run over a real (short) range for a
// real target/location — no NASA-almanac-grade reference case exists for
// "best observation night" (unlike eclipses/transits), so this checks
// structural invariants instead of exact dates. Jupiter Oct-Dec 2024
// spans its real 2024-12-07 opposition, so a non-empty, well-scored
// result is expected, not just "doesn't crash."
{
  const result = analyzeBestObservationNight({
    target: 'jupiter', startUtc: '2024-10-01T00:00:00Z', endUtc: '2024-12-01T00:00:00Z',
    latDeg: 35.6892, lonDeg: 51.3890, elevationM: 1200,
  });
  assert.ok(result.result.events.length > 0, 'expected at least one candidate night for Jupiter approaching its real Dec 2024 opposition');
  const scores = result.result.events.map((e) => e.score);
  for (let i = 1; i < scores.length; i += 1) {
    assert.ok(scores[i] <= scores[i - 1], 'events must be sorted descending by score');
  }
  for (const event of result.result.events) {
    assert.ok(event.score >= 0 && event.score <= 100, `event score must be in [0,100], got ${event.score}`);
    assert.ok(event.distanceAu > 0, 'distanceAu must be a positive real distance');
  }
  assert.equal(result.series.timesJd.length, result.series.valueDeg.length, 'series arrays must be the same length');
  const expectedNights = Math.round((new Date('2024-12-01') - new Date('2024-10-01')) / 86400000);
  assert.equal(result.series.timesJd.length, expectedNights, 'must scan exactly one point per calendar night in range');
}

// analysis/best-night: guards — oversized range fails fast, invalid lat/lon throws.
{
  assert.throws(() => analyzeBestObservationNight({
    target: 'saturn', startUtc: '2000-01-01T00:00:00Z', endUtc: '2030-01-01T00:00:00Z',
    latDeg: 40.71, lonDeg: -74.0, elevationM: 10,
  }), new RegExp(`max ${MAX_NIGHTS_TO_SCAN}`), 'an oversized range must throw naming the MAX_NIGHTS_TO_SCAN cap');

  assert.throws(() => analyzeBestObservationNight({
    target: 'mars', startUtc: '2024-01-01T00:00:00Z', endUtc: '2024-02-01T00:00:00Z',
    latDeg: 999, lonDeg: 0,
  }), /latDeg/, 'an invalid latitude must throw');
}

console.log('PASS: smoke-test.js all assertions passed');
