// THREE.Scene / renderer / camera bootstrapping. The only file (besides
// bodies.js/camera-rig.js) that touches THREE directly at this layer —
// app.js stays a thin orchestrator.
import * as THREE from 'three';
import { TEXTURES } from '../data/textures.js';

// Cap devicePixelRatio at 2 — a 3x/4x phone/retina panel gains little
// visible sharpness here but scales fragment-shader cost (starfield's
// per-pixel circular falloff included) quadratically for no real benefit.
const MAX_PIXEL_RATIO = 2;

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
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

// Comfortably inside the camera's far plane (5000) and just outside the
// procedural star layer's shell radius (render/starfield.js, 3000) — being
// farther out than the star points means normal depth testing draws the
// individually-colored star points in front of this plain textured sphere,
// which is what makes them read as a separate, sharper layer instead of
// disappearing into the low-res image.
const MILKY_WAY_SKY_RADIUS = 4000;

// Multiplies the loaded texture (MeshBasicMaterial.color * .map) so the
// Milky Way band reads dimmer than the procedural star points — otherwise
// a full-brightness 8K photo stretched across the whole sky reads as an
// overexposed background rather than a subtle galactic backdrop.
const MILKY_WAY_DIM_FACTOR = 0.55;

/**
 * Builds the Milky Way background as an actual sky sphere mesh (not a
 * scene.background texture assignment) so it can be explicitly kept unlit
 * (MeshBasicMaterial ignores scene lights), non-depth-writing, and BackSide
 * so it's visible from inside. Starts as a plain dark sphere (matching the
 * old scene.background fallback's appearance) and swaps in the dimmed,
 * sRGB-tagged texture once it loads; a failed load just keeps the dark
 * sphere rather than throwing.
 *
 * `update(camera)` must be called once per frame — it recenters the sphere
 * on the camera (position only, no rotation change) so it never appears to
 * drift as the camera moves through the scene, matching the star layer's
 * own per-frame recentering in render/starfield.js.
 */
export function createMilkyWaySkySphere() {
  const geometry = new THREE.SphereGeometry(MILKY_WAY_SKY_RADIUS, 48, 32);
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);

  new THREE.TextureLoader().load(
    TEXTURES.stars,
    (texture) => {
      // SphereGeometry's default UVs are already equirectangular (u =
      // longitude, v = latitude) — no remapping needed, unlike the Saturn
      // ring's radial UVs in bodies.js.
      texture.colorSpace = THREE.SRGBColorSpace;
      material.color.setScalar(MILKY_WAY_DIM_FACTOR);
      material.map = texture;
      material.needsUpdate = true;
    },
    undefined,
    (err) => console.warn('Milky Way texture failed to load, keeping flat dark sky sphere:', err)
  );

  return {
    mesh,
    update(camera) {
      mesh.position.copy(camera.position);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      material.map?.dispose();
    },
  };
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
