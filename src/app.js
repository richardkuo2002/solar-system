// Entry point. Step 5: real textures (solarsystemscope.com) replace flat
// colors where available, Sun gets a PointLight + ambient fill light, and
// the 5 v1 moons render orbiting their parent planet via a THREE.Group per
// planet (so a moon inherits its parent's world position for free).
import * as THREE from 'three';
import { createRenderer, createScene, createCamera, createAmbientLight, wireResize } from './render/scene-setup.js';
import {
  buildPlanetMesh, buildOrbitPath, buildSun, buildMoonMesh, toScenePosition,
} from './render/bodies.js';
import { createTimeControlsUI, createViewModeUI, createSurfaceControlsUI } from './render/ui-controls.js';
import { createCameraRig } from './render/camera-rig.js';
import {
  createTimeController, tick, togglePlayPause, setSpeed, reverse, jumpToDate,
} from './core/time-controller.js';
import { createCameraState, setMode, computePose, CAMERA_MODES } from './core/camera-modes.js';
import { elementsAtDate, julianDateFromDate, moonLocalPosition } from './core/orbital-elements.js';
import { elementsToPosition } from './core/kepler.js';
import { compressSize } from './core/scale.js';
import { PLANETS, PLANET_ORDER, SUN } from './data/planets.js';
import { MOONS, MOON_ORDER } from './data/moons.js';

const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);
const scene = createScene();
const camera = createCamera();
wireResize(camera, renderer);

scene.add(createAmbientLight());

const { mesh: sunMesh, light: sunLight } = buildSun(SUN);
scene.add(sunMesh);
scene.add(sunLight);

const startJD = julianDateFromDate(new Date());

const planetGroups = {};
const moonMeshesByParent = {}; // parentKey -> [{ key, mesh, moonData }]
for (const key of PLANET_ORDER) {
  const planetData = PLANETS[key];
  const orbitLine = buildOrbitPath(planetData.elements, startJD);
  scene.add(orbitLine);

  const group = new THREE.Group();
  const mesh = buildPlanetMesh(planetData);
  group.add(mesh);
  scene.add(group);
  planetGroups[key] = group;
  moonMeshesByParent[key] = [];
}

for (const moonKey of MOON_ORDER) {
  const moonData = MOONS[moonKey];
  const mesh = buildMoonMesh(moonData);
  planetGroups[moonData.parent].add(mesh);
  moonMeshesByParent[moonData.parent].push({ key: moonKey, mesh, moonData });
}

// Scene-space positions of every body this frame (planets + Sun), keyed by
// bodyKey — the `bodyPositions` map camera-modes.js#computePose expects.
const scenePositions = { sun: { x: 0, y: 0, z: 0 } };

function updateBodyPositions(currentDate) {
  const currentJD = julianDateFromDate(currentDate);
  for (const key of PLANET_ORDER) {
    const planetData = PLANETS[key];
    const els = elementsAtDate(planetData.elements, currentJD);
    const auPos = elementsToPosition(els);
    const scenePos = toScenePosition(auPos);
    planetGroups[key].position.set(scenePos.x, scenePos.y, scenePos.z);
    scenePositions[key] = scenePos;

    const parentSceneRadius = compressSize(planetData.radiusKm);
    for (const { mesh, moonData } of moonMeshesByParent[key]) {
      const localPos = moonLocalPosition(moonData, planetData.radiusKm, parentSceneRadius, currentJD, startJD);
      mesh.position.set(localPos.x, localPos.y, localPos.z);
    }
  }
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
    cameraState = setMode(cameraState, mode);
    cameraRig.setMode(cameraState.mode);
    cameraRig.applyPose(computePose(cameraState, scenePositions));
    viewModeUI.setActiveMode(cameraState.mode);
  },
  [CAMERA_MODES.HELIOCENTRIC_TOPDOWN, CAMERA_MODES.FREE_FLIGHT, CAMERA_MODES.SURFACE_FIRST_PERSON]
);
viewModeUI.setActiveMode(cameraState.mode);

createSurfaceControlsUI(document.getElementById('ui-root'), PLANET_ORDER, (planet, lat, lon) => {
  cameraState = setMode(cameraState, CAMERA_MODES.SURFACE_FIRST_PERSON, { planet, lat, lon });
  cameraRig.setMode(cameraState.mode);
  cameraRig.applyPose(computePose(cameraState, scenePositions));
  viewModeUI.setActiveMode(cameraState.mode);
});

updateBodyPositions(timeState.currentDate);
cameraRig.applyPose(computePose(cameraState, scenePositions));

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  timeState = tick(timeState, delta);
  updateBodyPositions(timeState.currentDate);
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
  }

  renderer.render(scene, camera);
}
animate();
