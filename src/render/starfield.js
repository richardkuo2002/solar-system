// Background star layer: THREE.Points on a fixed-radius shell centered on
// the camera, built from a real star catalog (src/core/star-catalog.js —
// see docs/ROADMAP.md's v1.2 closeout) rather than the old procedural
// generator it replaces. This is a second, independent layer on top of the
// Milky Way sky sphere (scene-setup.js#createMilkyWaySkySphere) — that
// sphere only carries the large-scale galactic band/dust-lane texture now;
// individual star points (with color/brightness variety and a real round
// falloff) live here instead of being baked into that 2D image.
import * as THREE from 'three';
import { loadStarCatalog } from '../core/star-catalog.js';

// Comfortably inside the camera's far plane (5000, see scene-setup.js) and
// the Milky Way sky sphere's radius (4000), and far outside every real
// solar-system body/orbit (Neptune/Pluto/comets top out well under 200
// scene units — see src/core/scale.js). Being closer than the sky sphere
// means normal depth testing correctly draws star points in front of the
// Milky Way band, with no z-fighting risk given the wide radius gap.
// Also reused as-is by render/constellation-lines.js so the lines meet
// the stars they connect.
export const STAR_SHELL_RADIUS = 3000;

const VERTEX_SHADER = `
  attribute float aSize;
  attribute float aBrightness;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vBrightness;
  uniform float uPixelRatio;
  void main() {
    vColor = aColor;
    vBrightness = aBrightness;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uPixelRatio;
  }
`;

// gl_PointCoord-based circular falloff: outside the point's inscribed
// circle is discarded outright (no square sprite edges), and the visible
// disc itself fades via smoothstep instead of a hard-edged circle.
const FRAGMENT_SHADER = `
  precision mediump float;
  varying vec3 vColor;
  varying float vBrightness;
  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float dist = length(centered);
    if (dist > 0.5) discard;
    float falloff = smoothstep(0.5, 0.0, dist);
    gl_FragColor = vec4(vColor, falloff * vBrightness);
  }
`;

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`fetch ${path} failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Builds the star point cloud from the vendored real catalog
 * (assets/stars/stars.6.json — ~5000 Hipparcos stars to mag 6.5).
 * `pixelRatio` should be the renderer's actual (already-capped) pixel
 * ratio so point sizes read consistently on high-DPI displays.
 *
 * Async (top-level await is already used elsewhere in app.js for the
 * texture manifest fetch) because the catalog has to be fetched before
 * the star count — and therefore the BufferGeometry size — is known.
 * Geometry/material are then built exactly once and never rebuilt —
 * `update(camera)` only recenters the shell on the camera each frame
 * (position, not rotation, so the star pattern itself never spins with
 * the camera), and resize never touches this at all.
 */
export async function createStarfield({ pixelRatio = 1 } = {}) {
  const starsGeoJson = await fetchJson('assets/stars/stars.6.json');
  const { positions, colors, sizes, brightness } = loadStarCatalog(starsGeoJson);

  const scaledPositions = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) scaledPositions[i] = positions[i] * STAR_SHELL_RADIUS;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(scaledPositions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: pixelRatio } },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    // Normal (not additive) blending: additive would let thousands of
    // overlapping soft discs accumulate toward white across the whole sky.
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geometry, material);

  return {
    points,
    /** Recenter the shell on the camera every frame — no rotation change, so the pattern itself stays fixed while never producing free-flight parallax. */
    update(camera) {
      points.position.copy(camera.position);
    },
    setPixelRatio(ratio) {
      material.uniforms.uPixelRatio.value = ratio;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
