// Entry point. Step 3: real time-controller + UI drive the simulated date
// (replaces step 2's placeholder local day counter).
import * as THREE from 'three';
import { createRenderer, createScene, createCamera, wireResize } from './render/scene-setup.js';
import { buildPlanetMesh, buildOrbitPath, toScenePosition } from './render/bodies.js';
import { createTimeControlsUI } from './render/ui-controls.js';
import {
  createTimeController, tick, togglePlayPause, setSpeed, reverse, jumpToDate,
} from './core/time-controller.js';
import { elementsAtDate, julianDateFromDate } from './core/orbital-elements.js';
import { elementsToPosition } from './core/kepler.js';
import { PLANETS, PLANET_ORDER } from './data/planets.js';

const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);
const scene = createScene();
const camera = createCamera();
wireResize(camera, renderer);

// Hardcoded top-down (heliocentric) camera: looking straight down at the
// ecliptic plane from above. Tiny x-offset avoids a degenerate lookAt when
// the camera is exactly on the up axis.
camera.position.set(0.001, 140, 0);
camera.up.set(0, 0, -1);
camera.lookAt(0, 0, 0);

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

function updatePlanetPositions(currentDate) {
  const currentJD = julianDateFromDate(currentDate);
  for (const key of PLANET_ORDER) {
    const planetData = PLANETS[key];
    const els = elementsAtDate(planetData.elements, currentJD);
    const auPos = elementsToPosition(els);
    const scenePos = toScenePosition(auPos);
    planetMeshes[key].position.set(scenePos.x, scenePos.y, scenePos.z);
  }
}

let timeState = createTimeController({ startDate: new Date(), speedDaysPerSecond: 1 });
timeState.playing = true; // starts running so the "faster inner planets" effect is visible immediately

const ui = createTimeControlsUI(document.getElementById('ui-root'), {
  onTogglePlayPause() {
    timeState = togglePlayPause(timeState);
    ui.setPlayPauseLabel(timeState.playing);
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
    ui.setCurrentDateDisplay(timeState.currentDate);
  },
});
ui.setPlayPauseLabel(timeState.playing);
ui.setCurrentDateDisplay(timeState.currentDate);

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  timeState = tick(timeState, delta);
  updatePlanetPositions(timeState.currentDate);
  ui.setCurrentDateDisplay(timeState.currentDate);
  renderer.render(scene, camera);
}
updatePlanetPositions(timeState.currentDate);
animate();
