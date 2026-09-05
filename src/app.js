// Entry point. Step 8: geocentric (Earth-centered) view — the last and
// hardest of the 4 camera modes, and the best end-to-end correctness check
// for the whole project (a real retrograde-motion loop should be visible
// for Mars if steps 2-7's orbital math is right).
import * as THREE from 'three';
import { createRenderer, createScene, createCamera, createAmbientLight, wireResize, createMilkyWaySkySphere } from './render/scene-setup.js';
import { createStarfield } from './render/starfield.js';
import { createConstellationLines } from './render/constellation-lines.js';
import { createConstellationLabels } from './render/constellation-labels.js';
import {
  buildPlanetMesh, buildOrbitPath, buildSun, buildMoonMesh, buildSaturnRing, buildAtmosphereShell, toScenePosition,
} from './render/bodies.js';
import { initTextureLoader } from './render/texture-loader.js';
import { createTimeControlsUI, createViewModeUI, createSurfaceControlsUI, REAL_TIME_DAYS_PER_SECOND } from './render/ui-controls.js';
import { createHoverLabels } from './render/hover-labels.js';
import { createAttributionFooter } from './render/attribution-footer.js';
import { createEphemerisHud } from './render/ephemeris-hud.js';
import { createCameraRig } from './render/camera-rig.js';
import { createTouchControls } from './render/touch-controls.js';
import { buildAsteroidBelt } from './render/asteroid-belt.js';
import { createEventToolkitPanel } from './render/event-toolkit-panel.js';
import { createObserverPanel } from './render/observer-panel.js';
import { createBodyInfoPanel } from './render/body-info-panel.js';
import { createLineOfSightLine } from './render/retrograde-los-line.js';
import { createAnalysisTargetMarker } from './render/analysis-target-marker.js';
import { analyzeObserver } from './analysis/observer.js';
import {
  createTimeController, tick, togglePlayPause, setSpeed, reverse, jumpToDate, pause,
} from './core/time-controller.js';
import { createCameraState, setMode, setFocusBody, enterGeocentric, computePose, CAMERA_MODES } from './core/camera-modes.js';
import { encodeAppStateToParams, decodeAppStateFromParams } from './core/url-state.js';
import {
  julianDateFromDate, dateFromJulianDate, moonLocalPosition, moonLocalPositionMeeus, moonGeocentricJ2000, circularOrbitAngle,
  orbitalPeriodDaysFromSemiMajorAxisAu,
} from './core/orbital-elements.js';
import { compressSize, apparentAngularRadiusRad, SUN_SIZE_CAP } from './core/scale.js';
import { KM_PER_AU } from './core/units.js';
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

// Three independent background layers (see scene-setup.js / render/starfield.js
// / render/constellation-lines.js for why): the Milky Way sky sphere carries
// only the large-scale galactic band/dust-lane image, the real star catalog
// carries individual, per-star color/brightness/round-falloff detail the
// 2K/8K photo alone can't provide at any zoom level, and the constellation
// lines overlay the traditional figures connecting them. All three recenter
// on the camera every frame in animate() below — never rebuilt, just
// repositioned. The latter two are fetched (see starfield.js/
// constellation-lines.js), same top-level-await pattern the texture
// manifest below already uses — this is a plain ES module entry point, no
// bundler/build step to worry about.
const milkyWay = createMilkyWaySkySphere();
scene.add(milkyWay.mesh);
const [starfield, constellationLines, constellationLabels] = await Promise.all([
  createStarfield({ pixelRatio: renderer.getPixelRatio() }),
  createConstellationLines(),
  createConstellationLabels(),
]);
scene.add(starfield.points);
scene.add(constellationLines.lines);

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
  // Each planet's own color (already used as its fallback flat-shaded mesh
  // color, see data/planets.js) reused for its orbit line too, replacing
  // the old shared 0x555566 grey for every planet — the point is telling
  // orbits apart at a glance, not a new color scheme to maintain.
  const orbitLine = buildOrbitPath(planetData.elements, startJD, 256, planetData.color);
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

// v1.8.1 — a single flex-column wrapper for the left-side panel stack
// (view-mode, surface controls, observer, planet-info) so each panel's
// real rendered height pushes the next one down automatically, instead
// of every panel hardcoding its own `position: fixed; top/bottom: Npx`
// guessed from its neighbors' assumed heights — that's exactly how
// .observer-panel ended up silently overlapping .surface-controls's
// "Stand Here" button (see css/style.css's .left-column comment).
// v1.8.3 — .body-info-panel (Planet Info Panel, below) moved in here too:
// it used to be a second, independently-positioned fixed stack growing
// UP from the bottom-left corner while this column grows DOWN from the
// top-left corner, so an expanded Observer Mode result and a shown
// Planet Info Panel could still collide in the middle of the screen —
// the exact "still overlaps when expanded" report v1.8.1/v1.8.2 hadn't
// actually fixed (those only fixed the two most obvious/reported
// instances, not this whole class of "two independently-growing stacks
// share no height budget"). One flex column now bounds everyone sharing
// this corner, with `order`/`margin-top: auto` (see .body-info-panel's
// CSS) keeping the planet-info panel visually last regardless of its
// creation order in this file.
const leftColumn = document.createElement('div');
leftColumn.className = 'left-column';
document.getElementById('ui-root').appendChild(leftColumn);

// v0.7 Planet Info Panel — click-driven only (see buildBodyInfo above):
// every field it shows is static per body, so nothing here touches the
// animate() loop, unlike ephemerisHud's per-frame time/source updates.
const bodyInfoPanel = createBodyInfoPanel(leftColumn);

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
      // v1.5 — THE Moon uses the same Meeus lunar theory the analysis path
      // uses (real phase/inclination/eccentric distance), so the scene and
      // the Event Toolkit/Observer Mode finally show the same Moon for the
      // same date. Every other moon keeps the circular approximation.
      const localPos = moonData === MOONS.moon
        ? moonLocalPositionMeeus(currentJD, planetData.radiusKm, parentSceneRadius)
        : moonLocalPosition(moonData, planetData.radiusKm, parentSceneRadius, currentJD, startJD);
      mesh.position.set(localPos.x, localPos.y, localPos.z);
    }
  }
  const plutoData = DWARF_PLANETS.pluto;
  const plutoSceneRadius = compressSize(plutoData.radiusKm);
  const charonLocalPos = moonLocalPosition(CHARON, plutoData.radiusKm, plutoSceneRadius, currentJD, startJD);
  charonMesh.position.set(charonLocalPos.x, charonLocalPos.y, charonLocalPos.z);
}

// v1.3 — Surface Mode true angular size for the Sun and the current planet's
// moon(s). See docs/accuracy.md's "Surface Mode sky realism" note: the
// compression curves in core/scale.js are tuned for the top-down overview,
// not "look up from ground level" — left alone the Moon would fill ~half the
// sky. compressPosition/compressMoonOrbit preserve DIRECTION, only compress
// MAGNITUDE, so the positions updateAllPositions() already set this frame
// already point the correct real-world direction — only each proxy's
// distance-from-camera and render scale need overriding, using each body's
// real (uncompressed) radius/distance. Called right after updateAllPositions().
const SKY_PROXY_DISTANCE = 2900; // inside the star shell (3000), well outside every real compressed body (starfield.js: all under 200 scene units)
const BAKED_SUN_RADIUS = Math.min(compressSize(SUN.radiusKm), SUN_SIZE_CAP); // matches bodies.js#buildSun's geometry exactly

// v1.4 — real planet angular radii are 1-2 orders of magnitude smaller than
// the Moon's (Jupiter at opposition ~23", Mars typically ~2", vs. the
// Moon's 933") — at this app's FOV that's sub-pixel, so true scale alone
// would make them flicker/vanish rather than just look small. Floor the
// apparent angular radius at a fixed minimum screen-pixel size, computed
// from the camera's actual FOV/canvas height so it stays correct on
// resize. A documented rendering simplification (same spirit as "flat
// color before texture") — real relative sizes still show through
// whenever a planet's true size exceeds the floor.
const MIN_PROXY_PIXEL_RADIUS = 1.5;
/** ecliptic-frame AU vector -> normalized scene-space direction (same axis swap as toScenePosition, without the radial compression — compression is only meaningful measured from the Sun). */
function eclipticDeltaToSceneDirection(dAu) {
  return new THREE.Vector3(dAu.x, dAu.z, dAu.y).normalize();
}

function applySurfaceSkyProxies() {
  const surfacePlanet = cameraState.mode === CAMERA_MODES.SURFACE_FIRST_PERSON ? cameraState.surface.planet : null;

  if (surfacePlanet) {
    const originAu = bodyStates[surfacePlanet].positionAu;
    const sunDistanceKm = Math.hypot(originAu.x, originAu.y, originAu.z) * KM_PER_AU;
    const angularRadiusRad = apparentAngularRadiusRad(SUN.radiusKm, sunDistanceKm);
    const dir = eclipticDeltaToSceneDirection({ x: -originAu.x, y: -originAu.y, z: -originAu.z });
    sunMesh.position.copy(dir).multiplyScalar(SKY_PROXY_DISTANCE);
    sunMesh.scale.setScalar((SKY_PROXY_DISTANCE * Math.tan(angularRadiusRad)) / BAKED_SUN_RADIUS);
  } else {
    sunMesh.position.set(0, 0, 0);
    sunMesh.scale.setScalar(1);
  }

  // Moons: reset every planet's moons to base scale first — undoes any
  // leftover scale override from a previous Surface Mode visit (position
  // self-corrects for free every frame via updateAllPositions's own
  // unconditional moonLocalPosition call above, but nothing else ever
  // resets mesh.scale, so scale needs an explicit reset here).
  for (const key of PLANET_ORDER) {
    for (const { mesh } of moonMeshesByParent[key]) {
      mesh.scale.setScalar(1);
    }
  }
  if (surfacePlanet) {
    for (const { mesh, moonData } of moonMeshesByParent[surfacePlanet]) {
      // v1.5 — THE Moon's rendered position now uses its real time-varying
      // distance (see moonLocalPositionMeeus), so its rendered angular size
      // uses the same real distance too (perigee/apogee is a real ±5.5%
      // size swing); other moons keep their constant circular orbitKm.
      const distanceKm = moonData === MOONS.moon
        ? moonGeocentricJ2000(julianDateFromDate(timeState.currentDate)).distanceKm
        : moonData.orbitKm;
      const angularRadiusRad = apparentAngularRadiusRad(moonData.radiusKm, distanceKm);
      const dir = mesh.position.clone().normalize();
      const bakedMoonRadius = compressSize(moonData.radiusKm);
      mesh.position.copy(dir).multiplyScalar(SKY_PROXY_DISTANCE);
      mesh.scale.setScalar((SKY_PROXY_DISTANCE * Math.tan(angularRadiusRad)) / bakedMoonRadius);
    }
  }

  // Other planets: same true-angular-size treatment, applied to the whole
  // group (not just the mesh) so rings/atmosphere/moons move as one rigid
  // body. Reset scale for all planets first (position self-corrects for
  // free, same reasoning as moons above — updateAllPositions always sets
  // it before this function runs).
  for (const key of PLANET_ORDER) {
    planetGroups[key].scale.setScalar(1);
  }
  if (surfacePlanet) {
    const originAu = bodyStates[surfacePlanet].positionAu;
    const radPerPixel = THREE.MathUtils.degToRad(camera.fov) / renderer.domElement.clientHeight;
    const minAngularRadiusRad = MIN_PROXY_PIXEL_RADIUS * radPerPixel;
    for (const key of PLANET_ORDER) {
      if (key === surfacePlanet) continue;
      const targetAu = bodyStates[key].positionAu;
      const dAu = { x: targetAu.x - originAu.x, y: targetAu.y - originAu.y, z: targetAu.z - originAu.z };
      const distanceKm = Math.hypot(dAu.x, dAu.y, dAu.z) * KM_PER_AU;
      const realAngularRadiusRad = apparentAngularRadiusRad(PLANETS[key].radiusKm, distanceKm);
      const angularRadiusRad = Math.max(realAngularRadiusRad, minAngularRadiusRad);
      const dir = eclipticDeltaToSceneDirection(dAu);
      const bakedRadius = compressSize(PLANETS[key].radiusKm);
      planetGroups[key].position.copy(dir).multiplyScalar(SKY_PROXY_DISTANCE);
      planetGroups[key].scale.setScalar((SKY_PROXY_DISTANCE * Math.tan(angularRadiusRad)) / bakedRadius);
    }
  }
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

// v1.7 follow-up: the simulated clock STARTS at true real time (1
// simulated second per real second), not the previous 1 simulated DAY per
// real second (~86400x) default — "the timeline should basically be real
// time." v1.8.2 replaced the old days/second speed dropdown with a
// real-time-anchored multiplier ladder (render/ui-controls.js's
// SPEED_OPTIONS) whose own default option is this same constant, so the
// dropdown and the actual starting speed now agree (previously a known,
// documented mismatch).
let timeState = createTimeController({ startDate: urlRestored.date ?? new Date(), speedDaysPerSecond: REAL_TIME_DAYS_PER_SECOND });
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

// v1.8.2 — .left-column and .body-info-panel (css/style.css) must stop
// above the time-controls bar; its real height can change (font/zoom,
// the bar's own content) so it's measured live via ResizeObserver into a
// CSS custom property instead of a second hardcoded guess — the same
// staleness bug v1.8.1 already fixed once for .left-column's own top
// offsets, here applied to the shared bottom edge instead.
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--time-bar-clearance', `${entry.target.getBoundingClientRect().height + 24}px`); // +12px margin below the bar (css) + 12px gap above it
}).observe(timeUI.element);
timeUI.setPlayPauseLabel(timeState.playing);
timeUI.setCurrentDateDisplay(timeState.currentDate);

// GEOCENTRIC's WASD cycles through these — every planet except Earth,
// since the camera always sits at Earth (see camera-rig.js#updateGeocentricCycle).
const GEOCENTRIC_CYCLE_TARGETS = PLANET_ORDER.filter((key) => key !== 'earth');

let cameraState = createCameraState(CAMERA_MODES.HELIOCENTRIC_TOPDOWN);
const cameraRig = createCameraRig(camera, renderer.domElement);
cameraRig.setMode(cameraState.mode);
// v0.10 — no-op on desktop (mouse-primary pointer), builds a virtual
// joystick/look-drag/Prev-Next-buttons UI on touch devices. See
// render/touch-controls.js's docstring for exactly which modes get which.
const touchControls = createTouchControls(document.getElementById('ui-root'), canvas, cameraRig);
touchControls.setMode(cameraState.mode);

// leftColumn created earlier, alongside bodyInfoPanel (see its comment above).
const viewModeUI = createViewModeUI(
  leftColumn,
  (mode) => {
    // Geocentric needs bodyPositions to snapshot its initial look direction
    // (see enterGeocentric's docstring) — every other mode is a plain
    // mode switch.
    cameraState = mode === CAMERA_MODES.GEOCENTRIC
      ? enterGeocentric(cameraState, scenePositions, 'mars') // Mars: the classic retrograde-motion example
      : setMode(cameraState, mode);
    cameraRig.setMode(cameraState.mode);
    touchControls.setMode(cameraState.mode);
    cameraRig.applyPose(computePose(cameraState, scenePositions, bodyRotations));
    viewModeUI.setActiveMode(cameraState.mode);
    if (mode === CAMERA_MODES.GEOCENTRIC) loadFullFor(planetMeshes.mars);
  },
  [CAMERA_MODES.HELIOCENTRIC_TOPDOWN, CAMERA_MODES.FREE_FLIGHT, CAMERA_MODES.SURFACE_FIRST_PERSON, CAMERA_MODES.GEOCENTRIC]
);
viewModeUI.setActiveMode(cameraState.mode);

createSurfaceControlsUI(
  leftColumn,
  PLANET_ORDER,
  (planet, lat, lon) => {
    cameraState = setMode(cameraState, CAMERA_MODES.SURFACE_FIRST_PERSON, { planet, lat, lon });
    cameraRig.setMode(cameraState.mode);
    touchControls.setMode(cameraState.mode);
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
// Sits in the same `leftColumn` flex stack createSurfaceControlsUI
// occupies, just below it — see css/style.css's .left-column comment.
const observerPanel = createObserverPanel(leftColumn, {
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
// camera/viewport). `activeTargetKey` tracks which body the currently
// displayed result is about (set on every successful analysis);
// `analysisHasScenePosition` tracks whether that target is one the shared
// visuals below can actually draw to (false for e.g. Phase/Illumination's
// 'moon' target — moons are parent-relative scene positions only, see
// core/orbital-elements.js, not a top-level scenePositions entry).
//
// v1.7: scrubbing a lab's chart now pauses AND jumps the actual simulated
// clock (`timeState`) to the scrubbed epoch, staying there after the drag
// ends — not a separate line-of-sight-only override like pre-v1.7. Once
// the master clock itself is at the scrubbed date, `scenePositions` (filled
// every frame from `timeState.currentDate`) already reflects it directly,
// so the line-of-sight line below just reads scenePositions like normal —
// no second position source to keep in sync.
//
// v1.8.1: the line-of-sight line is built from compressed scenePositions —
// while standing in Surface Mode, that direction has nothing to do with
// applySurfaceSkyProxies's true-angular-direction proxies (see
// docs/accuracy.md), so drawing it there would be actively misleading, not
// just unhelpful. Hidden in Surface Mode; a screen-space marker
// (analysisTargetMarker) points at the analyzed body's actual sky proxy
// instead — Surface Mode floors sub-pixel planets to a ~1.5px dot
// (MIN_PROXY_PIXEL_RADIUS), indistinguishable from any other faint point
// without one.
const lineOfSight = createLineOfSightLine(scene);
const analysisTargetMarker = createAnalysisTargetMarker();
let activeTargetKey = 'mars';
let analysisHasScenePosition = false;

createEventToolkitPanel(document.getElementById('ui-root'), {
  onAnalyzed(result, targetKey) {
    activeTargetKey = targetKey;
    analysisHasScenePosition = targetKey in scenePositions;
    analysisTargetMarker.setLabel(bodyDisplayName(targetKey));
  },
  onCursorChange(cursorJd) {
    timeState = jumpToDate(pause(timeState), dateFromJulianDate(cursorJd));
    updateAllPositions(timeState.currentDate);
    timeUI.setPlayPauseLabel(timeState.playing);
    timeUI.setCurrentDateDisplay(timeState.currentDate);
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
touchControls.setMode(cameraState.mode);
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
  constellationLines.update(camera);
  constellationLabels.update(camera);

  timeState = tick(timeState, delta);
  updateAllPositions(timeState.currentDate);
  applySurfaceSkyProxies();
  timeUI.setCurrentDateDisplay(timeState.currentDate);
  ephemerisHud.update(timeState.currentDate, bodyDisplayName(selectedBodyKey), bodyStates[selectedBodyKey] ?? null, moonHudInfo(selectedBodyKey)?.parentName ?? null);

  // v1.8.1: the two analysis visuals are mutually exclusive by camera
  // mode — line-of-sight everywhere except Surface Mode (where its
  // compressed-scenePositions direction would be wrong, see the comment
  // above createEventToolkitPanel), the screen-space marker only in
  // Surface Mode (and only when NOT standing on the analyzed body itself
  // — nothing meaningful to point at then).
  const surfacePlanetKey = cameraState.mode === CAMERA_MODES.SURFACE_FIRST_PERSON ? cameraState.surface.planet : null;
  const showLineOfSight = analysisHasScenePosition && !surfacePlanetKey;
  lineOfSight.line.visible = showLineOfSight;
  if (showLineOfSight) {
    lineOfSight.update(scenePositions.earth, scenePositions[activeTargetKey]);
  }
  const showTargetMarker = analysisHasScenePosition && surfacePlanetKey && activeTargetKey !== surfacePlanetKey;
  analysisTargetMarker.update(camera, showTargetMarker ? planetGroups[activeTargetKey] : null);

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
