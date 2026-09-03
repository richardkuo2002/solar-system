// Entry point. Step 2: static/animated correct orbits, hardcoded top-down
// camera. No time-controller UI yet (that's step 3) — planets are driven by
// a simple local "simulated day" counter just to visually confirm relative
// orbital speeds (Kepler's third law: inner planets sweep faster).
import * as THREE from 'three';
import { createRenderer, createScene, createCamera, wireResize } from './render/scene-setup.js';
import { buildPlanetMesh, buildOrbitPath, toScenePosition } from './render/bodies.js';
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

// Simple local time driver (placeholder for step 3's time-controller.js):
// simDays advances at a fixed rate so relative orbital speeds are visible.
let simDays = 0;
const SIM_DAYS_PER_SECOND = 20;
const clock = new THREE.Clock();

function updatePlanetPositions() {
  const currentJD = startJD + simDays;
  for (const key of PLANET_ORDER) {
    const planetData = PLANETS[key];
    const els = elementsAtDate(planetData.elements, currentJD);
    const auPos = elementsToPosition(els);
    const scenePos = toScenePosition(auPos);
    planetMeshes[key].position.set(scenePos.x, scenePos.y, scenePos.z);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  simDays += delta * SIM_DAYS_PER_SECOND;
  updatePlanetPositions();
  renderer.render(scene, camera);
}
updatePlanetPositions();
animate();
