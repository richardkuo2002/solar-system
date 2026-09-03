// Entry point. Step 4: camera-modes state machine + camera-rig replace the
// hardcoded top-down camera; adds free-flight. Heliocentric top-down and
// free-flight are the 2 of 4 modes implemented so far — surface/geocentric
// buttons exist but stay disabled until steps 6/8.
import * as THREE from 'three';
import { createRenderer, createScene, createCamera, wireResize } from './render/scene-setup.js';
import { buildPlanetMesh, buildOrbitPath, toScenePosition } from './render/bodies.js';
import { createTimeControlsUI, createViewModeUI } from './render/ui-controls.js';
import { createCameraRig } from './render/camera-rig.js';
import {
  createTimeController, tick, togglePlayPause, setSpeed, reverse, jumpToDate,
} from './core/time-controller.js';
import { createCameraState, setMode, computePose, CAMERA_MODES } from './core/camera-modes.js';
import { elementsAtDate, julianDateFromDate } from './core/orbital-elements.js';
import { elementsToPosition } from './core/kepler.js';
import { PLANETS, PLANET_ORDER } from './data/planets.js';

const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);
const scene = createScene();
const camera = createCamera();
wireResize(camera, renderer);

const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(2, 32, 32),
  new THREE.MeshBasicMaterial({ color: 0xffdd88 })
);
scene.add(sunMesh);

const startJD = julianDateFromDate(new Date());
const planetMeshes = {};
for (const key of PLANET_ORDER) {
  const planetData = PLANETS[key];
  const orbitLine = buildOrbitPath(planetData.elements, startJD);
  scene.add(orbitLine);

  const mesh = buildPlanetMesh(planetData);
  scene.add(mesh);
  planetMeshes[key] = mesh;
}

// Scene-space positions of every body this frame, keyed by bodyKey — this is
// the `bodyPositions` map camera-modes.js#computePose expects. Kept in sync
// by updatePlanetPositions() below.
const scenePositions = { sun: { x: 0, y: 0, z: 0 } };

function updatePlanetPositions(currentDate) {
  const currentJD = julianDateFromDate(currentDate);
  for (const key of PLANET_ORDER) {
    const planetData = PLANETS[key];
    const els = elementsAtDate(planetData.elements, currentJD);
    const auPos = elementsToPosition(els);
    const scenePos = toScenePosition(auPos);
    planetMeshes[key].position.set(scenePos.x, scenePos.y, scenePos.z);
    scenePositions[key] = scenePos;
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
    updatePlanetPositions(timeState.currentDate);
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
  [CAMERA_MODES.HELIOCENTRIC_TOPDOWN, CAMERA_MODES.FREE_FLIGHT]
);
viewModeUI.setActiveMode(cameraState.mode);

updatePlanetPositions(timeState.currentDate);
cameraRig.applyPose(computePose(cameraState, scenePositions));

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  timeState = tick(timeState, delta);
  updatePlanetPositions(timeState.currentDate);
  timeUI.setCurrentDateDisplay(timeState.currentDate);

  if (cameraState.mode === CAMERA_MODES.FREE_FLIGHT) {
    cameraState = cameraRig.updateFreeFlight(cameraState, delta);
    cameraRig.applyPose(computePose(cameraState, scenePositions));
  } else if (cameraState.mode === CAMERA_MODES.HELIOCENTRIC_TOPDOWN) {
    cameraRig.orbitControls.update();
  }

  renderer.render(scene, camera);
}
animate();
