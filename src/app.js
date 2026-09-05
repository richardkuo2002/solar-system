// Entry point. Step 8: geocentric (Earth-centered) view — the last and
// hardest of the 4 camera modes, and the best end-to-end correctness check
// for the whole project (a real retrograde-motion loop should be visible
// for Mars if steps 2-7's orbital math is right).
import * as THREE from 'three';
import { createRenderer, createScene, createCamera, createAmbientLight, wireResize, createMilkyWaySkySphere } from './render/scene-setup.js';
import { createStarfield } from './render/starfield.js';
import {
  buildPlanetMesh, buildOrbitPath, buildSun, buildMoonMesh, buildSaturnRing, buildAtmosphereShell, toScenePosition,
} from './render/bodies.js';
import { initTextureLoader } from './render/texture-loader.js';
import { createTimeControlsUI, createViewModeUI, createSurfaceControlsUI } from './render/ui-controls.js';
import { createHoverLabels } from './render/hover-labels.js';
import { createAttributionFooter } from './render/attribution-footer.js';
import { createEphemerisHud } from './render/ephemeris-hud.js';
import { createCameraRig } from './render/camera-rig.js';
import { buildAsteroidBelt } from './render/asteroid-belt.js';
import { createEventToolkitPanel } from './render/event-toolkit-panel.js';
import { createObserverPanel } from './render/observer-panel.js';
import { createBodyInfoPanel } from './render/body-info-panel.js';
import { createLineOfSightLine } from './render/retrograde-los-line.js';
import { analyzeObserver } from './analysis/observer.js';
import {
  createTimeController, tick, togglePlayPause, setSpeed, reverse, jumpToDate,
} from './core/time-controller.js';
import { createCameraState, setMode, setFocusBody, enterGeocentric, computePose, CAMERA_MODES } from './core/camera-modes.js';
import { encodeAppStateToParams, decodeAppStateFromParams } from './core/url-state.js';
import {
  julianDateFromDate, dateFromJulianDate, moonLocalPosition, circularOrbitAngle,
  orbitalPeriodDaysFromSemiMajorAxisAu,
} from './core/orbital-elements.js';
import { compressSize } from './core/scale.js';
import { getBodyState, sunBodyState } from './core/ephemeris.js';
import { PLANETS, PLANET_ORDER, SUN } from './data/planets.js';
import { MOONS, MOON_ORDER } from './data/moons.js';
import { COMETS, COMET_ORDER } from './data/comets.js';
import { DWARF_PLANETS, DWARF_PLANET_ORDER, CHARON } from './data/dwarf-planets.js';

const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);
const scene = createScene();
const camera = createCamera();
wireResize(camera, renderer);

// Two independent background layers (see scene-setup.js / render/starfield.js
// for why): the Milky Way sky sphere carries only the large-scale galactic
// band/dust-lane image now, and the procedural starfield carries individual,
// per-star color/brightness/round-falloff detail the 2K/8K photo alone
// can't provide at any zoom level. Both recenter on the camera every frame
// in animate() below — never rebuilt, just repositioned.
const milkyWay = createMilkyWaySkySphere();
scene.add(milkyWay.mesh);
const starfield = createStarfield({ pixelRatio: renderer.getPixelRatio() });
scene.add(starfield.points);

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

// Display name (mesh.name, already set to bodyData.name by the builders in
// render/bodies.js) -> bodyKey, for click-to-select. Built from every data
// table a mesh can come from — Sun and Charon aren't in the four PLANET/
// MOON/COMET/DWARF_PLANET tables the rest come from, so they're added
// explicitly rather than silently missing from a naive four-table loop.
const nameToKey = new Map([[SUN.name, 'sun'], [CHARON.name, 'charon']]);
for (const key of PLANET_ORDER) nameToKey.set(PLANETS[key].name, key);
for (const key of MOON_ORDER) nameToKey.set(MOONS[key].name, key);
for (const key of COMET_ORDER) nameToKey.set(COMETS[key].name, key);
for (const key of DWARF_PLANET_ORDER) nameToKey.set(DWARF_PLANETS[key].name, key);

let selectedBodyKey = 'sun';

// v0.7 Planet Info Panel — click-driven only (see buildBodyInfo above):
// every field it shows is static per body, so nothing here touches the
// animate() loop, unlike ephemerisHud's per-frame time/source updates.
const bodyInfoPanel = createBodyInfoPanel(document.getElementById('ui-root'));

createHoverLabels(canvas, camera, pickableMeshes, loadFullFor, (mesh) => {
  const key = nameToKey.get(mesh.name);
  if (!key) return;
  selectedBodyKey = key;
  cameraState = setFocusBody(cameraState, key);
  bodyInfoPanel.render(buildBodyInfo(key));
});
createAttributionFooter(document.getElementById('ui-root'));
const ephemerisHud = createEphemerisHud(document.getElementById('ui-root'));
bodyInfoPanel.render(buildBodyInfo(selectedBodyKey)); // shows the Sun immediately on load, matching ephemerisHud's own always-populated-from-load behavior

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
// Unchanged shape/consumer: camera-rig.js/computePose don't know or care
// this now comes from a normalized body-state instead of a raw {x,y,z}.
const scenePositions = { sun: { x: 0, y: 0, z: 0 } };
// bodyKey -> current planetMeshes[key].rotation.y (radians), kept in sync
// inside updateAllPositions — SURFACE_FIRST_PERSON's computePose needs this
// so a "standing on the surface" camera turns with the planet instead of
// staying fixed in world space while the ground spins under it.
const bodyRotations = {};

// Every body with real heliocentric `elements` — everything getBodyState
// can produce a normalized AU body-state for (planets go through Horizons
// when available; comets/dwarf-planets fall through to Kepler for free
// since they have no HORIZONS_CODES entry — see core/ephemeris.js).
const BODY_REGISTRY = [
  ...PLANET_ORDER.map((key) => ({ key, elements: PLANETS[key].elements, object3d: planetGroups[key] })),
  ...COMET_ORDER.map((key) => ({ key, elements: COMETS[key].elements, object3d: cometMeshes[key] })),
  ...DWARF_PLANET_ORDER.map((key) => ({ key, elements: DWARF_PLANETS[key].elements, object3d: dwarfPlanetGroups[key] })),
];

// bodyKey -> latest body-state (see core/body-state.js) — read by the HUD.
// Moons/Charon are intentionally absent (see plan/docs/accuracy.md: they
// stay outside the AU contract, parent-relative scene units only).
let bodyStates = { sun: sunBodyState(new Date()) };

function updateAllPositions(currentDate) {
  const currentJD = julianDateFromDate(currentDate);
  sunMesh.rotation.y = circularOrbitAngle(currentJD - startJD, SUN.rotationPeriodDays);
  bodyStates.sun = sunBodyState(currentDate);

  for (const { key, elements, object3d } of BODY_REGISTRY) {
    const state = getBodyState(key, currentDate, elements);
    const scenePos = toScenePosition(state.positionAu);
    object3d.position.set(scenePos.x, scenePos.y, scenePos.z);
    scenePositions[key] = scenePos;
    bodyStates[key] = state;
  }

  // Axial spin + moons: parent-relative, out of the AU contract (see
  // docs/accuracy.md) — kept as its own loop rather than forced through
  // getBodyState.
  for (const key of PLANET_ORDER) {
    const planetData = PLANETS[key];
    const rotationRad = circularOrbitAngle(currentJD - startJD, planetData.rotationPeriodDays);
    planetMeshes[key].rotation.y = rotationRad;
    bodyRotations[key] = rotationRad;
    const parentSceneRadius = compressSize(planetData.radiusKm);
    for (const { mesh, moonData } of moonMeshesByParent[key]) {
      const localPos = moonLocalPosition(moonData, planetData.radiusKm, parentSceneRadius, currentJD, startJD);
      mesh.position.set(localPos.x, localPos.y, localPos.z);
    }
  }
  const plutoData = DWARF_PLANETS.pluto;
  const plutoSceneRadius = compressSize(plutoData.radiusKm);
  const charonLocalPos = moonLocalPosition(CHARON, plutoData.radiusKm, plutoSceneRadius, currentJD, startJD);
  charonMesh.position.set(charonLocalPos.x, charonLocalPos.y, charonLocalPos.z);
}

/** MOONS/CHARON keyed lookup + display name + parent name for the HUD's
 *  moon branch — the only place moon-vs-AU-body branching logic lives. */
function moonHudInfo(bodyKey) {
  const moonData = MOONS[bodyKey] ?? (bodyKey === 'charon' ? CHARON : null);
  if (!moonData) return null;
  const parentName = moonData.parent === 'pluto' ? DWARF_PLANETS.pluto.name : PLANETS[moonData.parent].name;
  return { name: moonData.name, parentName };
}

function bodyDisplayName(bodyKey) {
  return PLANETS[bodyKey]?.name ?? COMETS[bodyKey]?.name ?? DWARF_PLANETS[bodyKey]?.name
    ?? MOONS[bodyKey]?.name ?? (bodyKey === 'charon' ? CHARON.name : null) ?? SUN.name;
}

/**
 * v0.7 Planet Info Panel data — same table-fallback-chain as
 * bodyDisplayName/moonHudInfo above, but returns every displayable field
 * for whichever category bodyKey actually is. src/render/body-info-panel.js
 * is purely presentational; this function owns "which table, which fields
 * exist" so the panel never has to import a data table itself.
 */
function buildBodyInfo(bodyKey) {
  const planetData = PLANETS[bodyKey];
  if (planetData) {
    return {
      name: planetData.name,
      category: 'planet',
      radiusKm: planetData.radiusKm,
      massKg: planetData.massKg,
      massRelativeToEarth: planetData.massKg / PLANETS.earth.massKg,
      rotationPeriodDays: planetData.rotationPeriodDays,
      axialTiltDeg: planetData.axialTiltDeg,
      orbitalPeriodDays: orbitalPeriodDaysFromSemiMajorAxisAu(planetData.elements.a[0]),
      orbitalPeriodSource: 'kepler-derived',
      semiMajorAxisAu: planetData.elements.a[0],
      eccentricity: planetData.elements.e[0],
      inclinationDeg: planetData.elements.i[0],
    };
  }
  const cometData = COMETS[bodyKey];
  if (cometData) {
    return {
      name: cometData.name,
      category: 'comet',
      radiusKm: cometData.radiusKm,
      radiusNote: 'exaggerated for visibility — see ATTRIBUTION.md',
      orbitalPeriodDays: orbitalPeriodDaysFromSemiMajorAxisAu(cometData.elements.a[0]),
      orbitalPeriodSource: 'kepler-derived',
      semiMajorAxisAu: cometData.elements.a[0],
      eccentricity: cometData.elements.e[0],
      inclinationDeg: cometData.elements.i[0],
    };
  }
  const dwarfData = DWARF_PLANETS[bodyKey];
  if (dwarfData) {
    return {
      name: dwarfData.name,
      category: 'dwarf',
      radiusKm: dwarfData.radiusKm,
      orbitalPeriodDays: orbitalPeriodDaysFromSemiMajorAxisAu(dwarfData.elements.a[0]),
      orbitalPeriodSource: 'kepler-derived',
      semiMajorAxisAu: dwarfData.elements.a[0],
      eccentricity: dwarfData.elements.e[0],
      inclinationDeg: dwarfData.elements.i[0],
    };
  }
  const moonData = MOONS[bodyKey] ?? (bodyKey === 'charon' ? CHARON : null);
  if (moonData) {
    const parentName = moonData.parent === 'pluto' ? DWARF_PLANETS.pluto.name : PLANETS[moonData.parent].name;
    return {
      name: moonData.name,
      category: 'moon',
      radiusKm: moonData.radiusKm,
      orbitalPeriodDays: moonData.periodDays,
      orbitalPeriodSource: 'data',
      orbitRadiusKm: moonData.orbitKm,
      parentName,
    };
  }
  // Falls through here only for 'sun' (SUN has no key in any table above,
  // same as bodyDisplayName's own fallback).
  return {
    name: SUN.name,
    category: 'sun',
    radiusKm: SUN.radiusKm,
    massKg: SUN.massKg,
    massRelativeToEarth: SUN.massKg / PLANETS.earth.massKg,
    rotationPeriodDays: SUN.rotationPeriodDays,
    axialTiltDeg: SUN.axialTiltDeg,
  };
}

// v0.8 shareable URL state — parsed once here (date only; mode/focus/surface
// need real scenePositions/data-table validation, so those are applied
// further down, right after the first updateAllPositions call). See
// core/url-state.js for exactly what is/isn't included and why.
const urlRestored = decodeAppStateFromParams(new URLSearchParams(window.location.search));
// The one URL field that's actually unsafe to use unvalidated —
// computePose's SURFACE_FIRST_PERSON branch does PLANETS[planet].radiusKm,
// which throws on a bad key (unlike focus, whose consumers already fall
// back to a safe {0,0,0} for an unknown body).
const restoredSurfacePlanet = PLANET_ORDER.includes(urlRestored.planet) ? urlRestored.planet : 'earth';

let timeState = createTimeController({ startDate: urlRestored.date ?? new Date(), speedDaysPerSecond: 1 });
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
    updateAllPositions(timeState.currentDate);
    timeUI.setCurrentDateDisplay(timeState.currentDate);
  },
});
timeUI.setPlayPauseLabel(timeState.playing);
timeUI.setCurrentDateDisplay(timeState.currentDate);

// GEOCENTRIC's WASD cycles through these — every planet except Earth,
// since the camera always sits at Earth (see camera-rig.js#updateGeocentricCycle).
const GEOCENTRIC_CYCLE_TARGETS = PLANET_ORDER.filter((key) => key !== 'earth');

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
    cameraRig.applyPose(computePose(cameraState, scenePositions, bodyRotations));
    viewModeUI.setActiveMode(cameraState.mode);
    if (mode === CAMERA_MODES.GEOCENTRIC) loadFullFor(planetMeshes.mars);
  },
  [CAMERA_MODES.HELIOCENTRIC_TOPDOWN, CAMERA_MODES.FREE_FLIGHT, CAMERA_MODES.SURFACE_FIRST_PERSON, CAMERA_MODES.GEOCENTRIC]
);
viewModeUI.setActiveMode(cameraState.mode);

createSurfaceControlsUI(
  document.getElementById('ui-root'),
  PLANET_ORDER,
  (planet, lat, lon) => {
    cameraState = setMode(cameraState, CAMERA_MODES.SURFACE_FIRST_PERSON, { planet, lat, lon });
    cameraRig.setMode(cameraState.mode);
    cameraRig.applyPose(computePose(cameraState, scenePositions, bodyRotations));
    viewModeUI.setActiveMode(cameraState.mode);
    loadFullFor(planetMeshes[planet]);
  },
  urlRestored.mode === CAMERA_MODES.SURFACE_FIRST_PERSON
    ? { planet: restoredSurfacePlanet, lat: urlRestored.lat ?? 0, lon: urlRestored.lon ?? 0 }
    : undefined
);

// Observer Mode (v0.6) — pure 2D-panel feature, no 3D-scene visual
// (unlike the Event Toolkit's line-of-sight line): RA/Dec, Alt/Az,
// above/below-horizon, and rise/transit/set are all panel-only outputs.
// Sits in the same left-column region createSurfaceControlsUI occupies,
// just below it (see css/style.css's .observer-panel top:96px).
const observerPanel = createObserverPanel(document.getElementById('ui-root'), {
  onObserve(params) {
    try {
      const result = analyzeObserver(params);
      observerPanel.renderResult(result);
    } catch (err) {
      observerPanel.setError(err.message);
    }
  },
});

// Event Toolkit (v0.5, replaces v0.4's single-purpose Retrograde Lab) —
// visual block 1 (line-of-sight) lives in the main scene (see
// render/retrograde-los-line.js's docstring for why there's no second
// camera/viewport). Follows the live simulation clock's Earth/target
// positions each frame by default; scrubbing a lab's timeline instead
// freezes it at the scrubbed epoch until the next Analyze run. Only one
// lab can be scrubbing at a time, so one shared override variable covers
// every event type — `activeTargetKey` tracks which body the currently
// displayed result is about (set on every successful analysis).
const lineOfSight = createLineOfSightLine(scene);
let scrubOverrideScenePositions = null; // {earth, [activeTargetKey]} or null (= follow live time)
let activeTargetKey = 'mars';

createEventToolkitPanel(document.getElementById('ui-root'), {
  onAnalyzed(result, targetKey) {
    activeTargetKey = targetKey;
    scrubOverrideScenePositions = null;
    // Phase/illumination's 'moon' target has no heliocentric-AU scenePositions
    // entry (moons are parent-relative scene positions only, see
    // core/orbital-elements.js) — the shared line-of-sight visual only
    // applies to targets that do.
    lineOfSight.line.visible = targetKey in scenePositions;
  },
  onCursorChange(cursorJd) {
    if (!(activeTargetKey in PLANETS)) return; // e.g. 'moon' — nothing to scrub the line-of-sight visual to
    const jsDate = dateFromJulianDate(cursorJd);
    const earthState = getBodyState('earth', jsDate, PLANETS.earth.elements, { forceSource: 'kepler' });
    const targetState = getBodyState(activeTargetKey, jsDate, PLANETS[activeTargetKey].elements, { forceSource: 'kepler' });
    scrubOverrideScenePositions = {
      earth: toScenePosition(earthState.positionAu),
      [activeTargetKey]: toScenePosition(targetState.positionAu),
    };
  },
});

updateAllPositions(timeState.currentDate);

// Apply the restored camera mode/focus/surface now — enterGeocentric needs
// real scenePositions to snapshot its look direction (see its docstring),
// which only exist after the updateAllPositions call above.
if (urlRestored.mode === CAMERA_MODES.SURFACE_FIRST_PERSON) {
  cameraState = setMode(cameraState, CAMERA_MODES.SURFACE_FIRST_PERSON, {
    planet: restoredSurfacePlanet,
    lat: urlRestored.lat ?? 0,
    lon: urlRestored.lon ?? 0,
  });
} else if (urlRestored.mode === CAMERA_MODES.GEOCENTRIC) {
  cameraState = enterGeocentric(cameraState, scenePositions, urlRestored.focus ?? 'mars');
} else if (urlRestored.mode) {
  cameraState = setMode(cameraState, urlRestored.mode);
  if (urlRestored.focus) cameraState = setFocusBody(cameraState, urlRestored.focus);
}
cameraRig.setMode(cameraState.mode);
viewModeUI.setActiveMode(cameraState.mode);

cameraRig.applyPose(computePose(cameraState, scenePositions, bodyRotations));
ephemerisHud.update(timeState.currentDate, bodyDisplayName(selectedBodyKey), bodyStates[selectedBodyKey] ?? null, moonHudInfo(selectedBodyKey)?.parentName ?? null);

// v0.8 — keeps the address bar live-updated to a shareable URL for the
// current date/camera state (history.replaceState: no new history entries).
// Called unconditionally every frame below, but only actually touches the
// URL when the encoded string changes (see url-state.js's rounding comment
// for why this doesn't churn every frame during WASD-walking).
let lastUrlQuery = '';
function syncUrl() {
  const query = encodeAppStateToParams({ currentDate: timeState.currentDate, cameraState }).toString();
  if (query === lastUrlQuery) return;
  lastUrlQuery = query;
  window.history.replaceState(null, '', `?${query}`);
}
syncUrl();

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  milkyWay.update(camera);
  starfield.update(camera);

  timeState = tick(timeState, delta);
  updateAllPositions(timeState.currentDate);
  timeUI.setCurrentDateDisplay(timeState.currentDate);
  ephemerisHud.update(timeState.currentDate, bodyDisplayName(selectedBodyKey), bodyStates[selectedBodyKey] ?? null, moonHudInfo(selectedBodyKey)?.parentName ?? null);

  if (activeTargetKey in scenePositions) {
    if (scrubOverrideScenePositions) {
      lineOfSight.update(scrubOverrideScenePositions.earth, scrubOverrideScenePositions[activeTargetKey]);
    } else {
      lineOfSight.update(scenePositions.earth, scenePositions[activeTargetKey]);
    }
  }

  if (cameraState.mode === CAMERA_MODES.FREE_FLIGHT) {
    cameraState = cameraRig.updateFreeFlight(cameraState, delta);
    cameraRig.applyPose(computePose(cameraState, scenePositions, bodyRotations));
  } else if (cameraState.mode === CAMERA_MODES.HELIOCENTRIC_TOPDOWN) {
    // WASD pans the orbit-around point (a new "starting point" for
    // drag-to-orbit) — this mode otherwise never calls applyPose per
    // frame, since OrbitControls owns camera position/target once entered.
    cameraRig.updateTopDownPan(delta);
    cameraRig.orbitControls.update();
  } else if (cameraState.mode === CAMERA_MODES.SURFACE_FIRST_PERSON) {
    // WASD "walks" (lat, lon) to a new standing point; the planet under
    // our feet also keeps moving along its orbit either way, so re-derive
    // the pose every frame rather than once on mode entry.
    cameraState = cameraRig.updateSurfaceWalk(cameraState, delta);
    cameraRig.applyPose(computePose(cameraState, scenePositions, bodyRotations));
  } else if (cameraState.mode === CAMERA_MODES.GEOCENTRIC) {
    cameraState = cameraRig.updateGeocentricLook(cameraState);
    // WASD cycles which body Earth is tracking — a discrete pick of a new
    // "observation starting point", re-aiming exactly like enterGeocentric.
    cameraState = cameraRig.updateGeocentricCycle(cameraState, scenePositions, GEOCENTRIC_CYCLE_TARGETS);
    cameraRig.applyPose(computePose(cameraState, scenePositions, bodyRotations));
  }

  syncUrl();
  renderer.render(scene, camera);
}
animate();
