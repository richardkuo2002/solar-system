// THREE.Scene / renderer / camera bootstrapping. The only file (besides
// bodies.js/camera-rig.js) that touches THREE directly at this layer —
// app.js stays a thin orchestrator.
import * as THREE from 'three';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000005);
  return scene;
}

/** Very low ambient light — just enough that a planet's unlit side isn't pure-black, not physically accurate. */
export function createAmbientLight() {
  return new THREE.AmbientLight(0x404050, 0.6);
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.01,
    5000
  );
  return camera;
}

export function wireResize(camera, renderer) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
