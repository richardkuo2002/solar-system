// Entry point. Step 8: geocentric (Earth-centered) view — the last and
// hardest of the 4 camera modes, and the best end-to-end correctness check
// for the whole project (a real retrograde-motion loop should be visible
// for Mars if steps 2-7's orbital math is right).
import * as THREE from 'three';
import { createRenderer, createScene, createCamera, createAmbientLight, wireResize, applyStarfield } from './render/scene-setup.js';
import {
  buildPlanetMesh, buildOrbitPath, buildSun, buildMoonMesh, buildSaturnRing, buildAtmosphereShell, toScenePosition,
} from './render/bodies.js';
import { initTextureLoader } from './render/texture-loader.js';
import { createTimeControlsUI, createViewModeUI, createSurfaceControlsUI } from './render/ui-controls.js';
import { createHoverLabels } from './render/hover-labels.js';
import { createAttributionFooter } from './render/attribution-footer.js';
import { createCameraRig } from './render/camera-rig.js';
import { buildAsteroidBelt } from './render/asteroid-belt.js';
import {
  createTimeController, tick, togglePlayPause, setSpeed, reverse, jumpToDate,
} from './core/time-controller.js';
import { createCameraState, setMode, enterGeocentric, computePose, CAMERA_MODES } from './core/camera-modes.js';
import { elementsAtDate, julianDateFromDate, moonLocalPosition, circularOrbitAngle } from './core/orbital-elements.js';
import { elementsToPosition } from './core/kepler.js';
import { compressSize } from './core/scale.js';
import { getPositionSync } from './core/ephemeris.js';
import { PLANETS, PLANET_ORDER, SUN } from './data/planets.js';
import { MOONS, MOON_ORDER } from './data/moons.js';
import { COMETS, COMET_ORDER } from './data/comets.js';
import { DWARF_PLANETS, DWARF_PLANET_ORDER, CHARON } from './data/dwarf-planets.js';

const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);
const scene = createScene();
const camera = createCamera();
wireResize(camera, renderer);
applyStarfield(scene);

scene.add(createAmbientLight());

// Top-level await is fine here — this is a plain ES module entry point, no
// bundler/build step to worry about. The texture loader needs the manifest
// (which files are real vs. procedural-only) before any mesh is built.
const textureLoader = await initTextureLoader(renderer);

// mesh -> [{ textureKey, material, property }] — a single registry driving
// every lazy-load trigger (hover, surface-mode pick, geocentric focus, the
// idle background queue) so each of those call sites just does
// `loadFullFor(someMesh)` instead of repeating per-body texture bookkeeping.
const lazyBodies = new Map();
function registerLazy(mesh, entries) {
  lazyBodies.set(mesh, entries);
}
function loadFullFor(mesh) {
  for (const { textureKey, material, property } of lazyBodies.get(mesh) ?? []) {
    textureLoader.ensureFull(textureKey, material, { property });
  }
}

const { mesh: sunMesh, light: sunLight } = buildSun(SUN, textureLoader);
const sunTiltGroup = new THREE.Group();
sunTiltGroup.rotation.z = THREE.MathUtils.degToRad(SUN.axialTiltDeg);
sunTiltGroup.add(sunMesh);
scene.add(sunTiltGroup);
scene.add(sunLight);
textureLoader.ensureFull(SUN.textureKey, sunMesh.material); // Sun always loads full-res immediately

const startJD = julianDateFromDate(new Date());

const planetGroups = {};
const planetMeshes = {}; // key -> mesh (the group also holds Saturn's ring, which must not spin with the planet)
const moonMeshesByParent = {}; // parentKey -> [{ key, mesh, moonData }]
const pickableMeshes = [sunMesh]; // bodies the hover-label raycaster tests against — rings/orbit lines excluded
for (const key of PLANET_ORDER) {
  const planetData = PLANETS[key];
  const orbitLine = buildOrbitPath(planetData.elements, startJD);
  scene.add(orbitLine);

  const group = new THREE.Group();
  // Static axial tilt, applied once — the planet spins (rotation.y, every
  // frame) as a *child* of this tilted group, so its spin axis stays fixed
  // and tilted instead of wobbling every frame if tilt and spin were both
  // set directly on the same object. Saturn's ring and Earth/Venus's
  // cloud/atmosphere shells share the tilt (same equatorial plane) but not
  // the spin.
  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.z = THREE.MathUtils.degToRad(planetData.axialTiltDeg);
  const mesh = buildPlanetMesh(planetData, textureLoader);
  tiltGroup.add(mesh);

  const lazyEntries = [{ textureKey: planetData.textureKey, material: mesh.material, property: 'map' }];
  if (planetData.nightTextureKey) {
    lazyEntries.push({ textureKey: planetData.nightTextureKey, material: mesh.material, property: 'emissiveMap' });
  }
  if (planetData.cloudsTextureKey) {
    const cloudsMesh = buildAtmosphereShell(planetData, planetData.cloudsTextureKey, textureLoader, { opacity: 0.5 });
    tiltGroup.add(cloudsMesh);
    lazyEntries.push({ textureKey: planetData.cloudsTextureKey, material: cloudsMesh.material, property: 'alphaMap' });
  }
  if (planetData.atmosphereTextureKey) {
    const atmosphereMesh = buildAtmosphereShell(planetData, planetData.atmosphereTextureKey, textureLoader, { opacity: 0.45 });
    tiltGroup.add(atmosphereMesh);
    lazyEntries.push({ textureKey: planetData.atmosphereTextureKey, material: atmosphereMesh.material, property: 'alphaMap' });
  }
  if (key === 'saturn') {
    const ring = buildSaturnRing(planetData, textureLoader);
    tiltGroup.add(ring);
    lazyEntries.push({ textureKey: 'saturnRing', material: ring.material, property: 'map' });
  }
  registerLazy(mesh, lazyEntries);

  group.add(tiltGroup);
  scene.add(group);
  planetGroups[key] = group;
  planetMeshes[key] = mesh;
  moonMeshesByParent[key] = [];
  pickableMeshes.push(mesh);
}
loadFullFor(planetMeshes.earth); // Earth always loads full-res immediately (map + night lights + clouds)

for (const moonKey of MOON_ORDER) {
  const moonData = MOONS[moonKey];
  const mesh = buildMoonMesh(moonData, textureLoader);
  planetGroups[moonData.parent].add(mesh);
  moonMeshesByParent[moonData.parent].push({ key: moonKey, mesh, moonData });
  pickableMeshes.push(mesh);
  registerLazy(mesh, [{ textureKey: moonData.textureKey, material: mesh.material, property: 'map' }]);
}
loadFullFor(moonMeshesByParent.earth[0].mesh); // the Moon always loads full-res immediately

// Comets — same [value,rate] element shape as planets, so this reuses
// buildOrbitPath/buildPlanetMesh unchanged (see data/comets.js).
const cometMeshes = {};
for (const key of COMET_ORDER) {
  const cometData = COMETS[key];
  // More segments than a planet orbit: much larger and far more eccentric,
  // so the default 256 undersamples the tight turn at perihelion.
  const orbitLine = buildOrbitPath(cometData.elements, startJD, 512, 0x88aacc);
  scene.add(orbitLine);
  const mesh = buildPlanetMesh(cometData, textureLoader);
  scene.add(mesh);
  cometMeshes[key] = mesh;
  pickableMeshes.push(mesh);
  registerLazy(mesh, [{ textureKey: cometData.textureKey, material: mesh.material, property: 'map' }]);
}

// Dwarf planets — same element shape as planets, reusing buildOrbitPath/
// buildPlanetMesh unchanged. Distinct orbit-line color: the point of adding
// Pluto is to make its ~17° inclination visually pop against the major
// planets' near-coplanar orbits. Each gets a THREE.Group wrapper (planets
// already have one; Pluto didn't) so Charon — Pluto's moon, not a generic
// "any dwarf planet can have moons" system — can be added as its child.
const dwarfPlanetGroups = {};
const dwarfPlanetMeshes = {};
for (const key of DWARF_PLANET_ORDER) {
  const dwarfData = DWARF_PLANETS[key];
  const orbitLine = buildOrbitPath(dwarfData.elements, startJD, 256, 0x996644);
  scene.add(orbitLine);
  const group = new THREE.Group();
  const mesh = buildPlanetMesh(dwarfData, textureLoader);
  group.add(mesh);
  scene.add(group);
  dwarfPlanetGroups[key] = group;
  dwarfPlanetMeshes[key] = mesh;
  pickableMeshes.push(mesh);
  registerLazy(mesh, [{ textureKey: dwarfData.textureKey, material: mesh.material, property: 'map' }]);
}
const charonMesh = buildMoonMesh(CHARON, textureLoader);
dwarfPlanetGroups.pluto.add(charonMesh);
pickableMeshes.push(charonMesh);
registerLazy(charonMesh, [{ textureKey: CHARON.textureKey, material: charonMesh.material, property: 'map' }]);

scene.add(buildAsteroidBelt());

createHoverLabels(canvas, camera, pickableMeshes, loadFullFor);
createAttributionFooter(document.getElementById('ui-root'));

// Background idle queue — everything not already eager-loaded (Sun/Earth/
// Moon) or triggered by user interaction eventually loads full-res anyway,
// one body per idle tick, so a patient viewer isn't stuck at preview
// quality forever even if they never hover/select a given body.
{
  const remaining = pickableMeshes.filter((mesh) => mesh !== sunMesh && mesh !== planetMeshes.earth && mesh !== moonMeshesByParent.earth[0].mesh);
  const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 200);
  function stepIdleLoad() {
    const mesh = remaining.shift();
    if (!mesh) return;
    loadFullFor(mesh);
    idle(stepIdleLoad);
  }
  idle(stepIdleLoad);
}

// Scene-space positions of every body this frame (planets + Sun), keyed by
// bodyKey — the `bodyPositions` map camera-modes.js#computePose expects.
const scenePositions = { sun: { x: 0, y: 0, z: 0 } };

/** Local Kepler fallback — also what ephemeris.js uses when Horizons is unavailable. */
function localPlanetPosition(bodyKey, jsDate) {
  const els = elementsAtDate(PLANETS[bodyKey].elements, julianDateFromDate(jsDate));
  return elementsToPosition(els);
}

function updateBodyPositions(currentDate) {
  const currentJD = julianDateFromDate(currentDate);
  sunMesh.rotation.y = circularOrbitAngle(currentJD - startJD, SUN.rotationPeriodDays);
  for (const key of PLANET_ORDER) {
    const planetData = PLANETS[key];
    const auPos = getPositionSync(key, currentDate, localPlanetPosition);
    const scenePos = toScenePosition(auPos);
    planetGroups[key].position.set(scenePos.x, scenePos.y, scenePos.z);
    scenePositions[key] = scenePos;
    // Axial spin — on the planet mesh itself, not the group, so Saturn's
    // ring doesn't spin along with it.
    planetMeshes[key].rotation.y = circularOrbitAngle(currentJD - startJD, planetData.rotationPeriodDays);

    const parentSceneRadius = compressSize(planetData.radiusKm);
    for (const { mesh, moonData } of moonMeshesByParent[key]) {
      const localPos = moonLocalPosition(moonData, planetData.radiusKm, parentSceneRadius, currentJD, startJD);
      mesh.position.set(localPos.x, localPos.y, localPos.z);
    }
  }
}

/** Comets always use local Kepler math directly — no Horizons lookup (out of scope for v1). */
function updateCometPositions(currentDate) {
  const currentJD = julianDateFromDate(currentDate);
  for (const key of COMET_ORDER) {
    const els = elementsAtDate(COMETS[key].elements, currentJD);
    const scenePos = toScenePosition(elementsToPosition(els));
    cometMeshes[key].position.set(scenePos.x, scenePos.y, scenePos.z);
    scenePositions[key] = scenePos;
  }
}

/** Dwarf planets, same treatment as comets — local Kepler math, no Horizons lookup. Charon orbits Pluto locally, same helper moons use. */
function updateDwarfPlanetPositions(currentDate) {
  const currentJD = julianDateFromDate(currentDate);
  for (const key of DWARF_PLANET_ORDER) {
    const els = elementsAtDate(DWARF_PLANETS[key].elements, currentJD);
    const scenePos = toScenePosition(elementsToPosition(els));
    dwarfPlanetGroups[key].position.set(scenePos.x, scenePos.y, scenePos.z);
    scenePositions[key] = scenePos;
  }
  const plutoData = DWARF_PLANETS.pluto;
  const plutoSceneRadius = compressSize(plutoData.radiusKm);
  const charonLocalPos = moonLocalPosition(CHARON, plutoData.radiusKm, plutoSceneRadius, currentJD, startJD);
  charonMesh.position.set(charonLocalPos.x, charonLocalPos.y, charonLocalPos.z);
}

let timeState = createTimeController({ startDate: new Date(), speedDaysPerSecond: 1 });
timeState.playing = true; // starts running so the "faster inner planets" effect is visible immediately

const timeUI = createTimeControlsUI(document.getElementById('ui-root'), {
  onTogglePlayPause() {
    timeState = togglePlayPause(timeState);
    timeUI.setPlayPauseLabel(timeState.playing);
  },
  onSpeedChange(daysPerSecond) {
    timeState = setSpeed(timeState, daysPerSecond);
  },
  onReverse() {
    timeState = reverse(timeState);
  },
  onJumpToDate(date) {
    timeState = jumpToDate(timeState, date);
    updateBodyPositions(timeState.currentDate);
    updateCometPositions(timeState.currentDate);
    updateDwarfPlanetPositions(timeState.currentDate);
    timeUI.setCurrentDateDisplay(timeState.currentDate);
  },
});
timeUI.setPlayPauseLabel(timeState.playing);
timeUI.setCurrentDateDisplay(timeState.currentDate);

let cameraState = createCameraState(CAMERA_MODES.HELIOCENTRIC_TOPDOWN);
const cameraRig = createCameraRig(camera, renderer.domElement);
cameraRig.setMode(cameraState.mode);

const viewModeUI = createViewModeUI(
  document.getElementById('ui-root'),
  (mode) => {
    // Geocentric needs bodyPositions to snapshot its initial look direction
    // (see enterGeocentric's docstring) — every other mode is a plain
    // mode switch.
    cameraState = mode === CAMERA_MODES.GEOCENTRIC
      ? enterGeocentric(cameraState, scenePositions, 'mars') // Mars: the classic retrograde-motion example
      : setMode(cameraState, mode);
    cameraRig.setMode(cameraState.mode);
    cameraRig.applyPose(computePose(cameraState, scenePositions));
    viewModeUI.setActiveMode(cameraState.mode);
    if (mode === CAMERA_MODES.GEOCENTRIC) loadFullFor(planetMeshes.mars);
  },
  [CAMERA_MODES.HELIOCENTRIC_TOPDOWN, CAMERA_MODES.FREE_FLIGHT, CAMERA_MODES.SURFACE_FIRST_PERSON, CAMERA_MODES.GEOCENTRIC]
);
viewModeUI.setActiveMode(cameraState.mode);

createSurfaceControlsUI(document.getElementById('ui-root'), PLANET_ORDER, (planet, lat, lon) => {
  cameraState = setMode(cameraState, CAMERA_MODES.SURFACE_FIRST_PERSON, { planet, lat, lon });
  cameraRig.setMode(cameraState.mode);
  cameraRig.applyPose(computePose(cameraState, scenePositions));
  viewModeUI.setActiveMode(cameraState.mode);
  loadFullFor(planetMeshes[planet]);
});

updateBodyPositions(timeState.currentDate);
updateCometPositions(timeState.currentDate);
updateDwarfPlanetPositions(timeState.currentDate);
cameraRig.applyPose(computePose(cameraState, scenePositions));

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  timeState = tick(timeState, delta);
  updateBodyPositions(timeState.currentDate);
  updateCometPositions(timeState.currentDate);
  updateDwarfPlanetPositions(timeState.currentDate);
  timeUI.setCurrentDateDisplay(timeState.currentDate);

  if (cameraState.mode === CAMERA_MODES.FREE_FLIGHT) {
    cameraState = cameraRig.updateFreeFlight(cameraState, delta);
    cameraRig.applyPose(computePose(cameraState, scenePositions));
  } else if (cameraState.mode === CAMERA_MODES.HELIOCENTRIC_TOPDOWN) {
    cameraRig.orbitControls.update();
  } else if (cameraState.mode === CAMERA_MODES.SURFACE_FIRST_PERSON) {
    // The planet under our feet keeps moving along its orbit — re-derive
    // the pose every frame rather than once on mode entry.
    cameraRig.applyPose(computePose(cameraState, scenePositions));
  } else if (cameraState.mode === CAMERA_MODES.GEOCENTRIC) {
    cameraState = cameraRig.updateGeocentricLook(cameraState);
    cameraRig.applyPose(computePose(cameraState, scenePositions));
  }

  renderer.render(scene, camera);
}
animate();
