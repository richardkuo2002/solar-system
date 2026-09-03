// THREE.Scene / renderer / camera bootstrapping. The only file (besides
// bodies.js/camera-rig.js) that touches THREE directly at this layer —
// app.js stays a thin orchestrator.
import * as THREE from 'three';
import { TEXTURES } from '../data/textures.js';

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

/**
 * Wraps the whole scene in the Milky Way starfield texture as a background
 * sphere — falls back to the plain dark scene.background color (already set
 * in createScene) if the texture fails to load, since TextureLoader's error
 * callback just leaves scene.background untouched rather than throwing.
 */
export function applyStarfield(scene) {
  new THREE.TextureLoader().load(
    TEXTURES.stars,
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      scene.background = texture;
    },
    undefined,
    (err) => console.warn('Starfield texture failed to load, keeping flat background:', err)
  );
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
