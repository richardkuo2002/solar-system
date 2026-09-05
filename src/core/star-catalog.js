// Real star catalog + constellation-line parsing for the v1.2 sky
// background (see docs/ROADMAP.md's v1.2 closeout). Replaces the old
// procedural starfield-generator.js: instead of a seeded PRNG, positions
// come from a real Hipparcos-numbered catalog (ofrohn/d3-celestial,
// BSD-3-Clause — see assets/stars/manifest.json), converted from
// equatorial RA/Dec to this project's ecliptic scene frame via
// core/topocentric.js's equatorialToEcliptic. Pure math, zero THREE/DOM,
// Node-testable like core/.
//
// Output shape intentionally matches the old generateStarfield()
// contract ({positions, colors, sizes, brightness} flat Float32Arrays)
// so render/starfield.js needed only a data-source swap, not a
// structural rewrite.
//
// Coordinate convention (confirmed against Sirius, HIP 32349, real
// RA=101.2872deg/Dec=-16.7161deg, which matches this catalog's feature
// id 32349 exactly): `geometry.coordinates` is `[raDeg, decDeg]`, raDeg
// wrapped to GeoJSON's [-180,180] range rather than [0,360) — the same
// angle either way, so no sign flip or offset is needed, just treating
// raDeg as an ordinary (possibly negative) RA before the unit-vector
// conversion below.

import { unitVectorFromRaDec, equatorialToEcliptic } from './topocentric.js';

// Real Vmag spans roughly -1.44 (Sirius) to 6.5 (this catalog's limit) —
// an ~8-magnitude range. Mapping mag linearly to a 0..1 "brightness" (as
// the old procedural field did with a synthetic value) needs a clamp
// range to map within; this isn't a photometric brightness model, just a
// readable visual spread, matching this feature's actual goal (a
// recognizable sky), not real photometry.
const MAG_BRIGHT_CLAMP = -1.5; // just past Sirius, this catalog's brightest star
const MAG_FAINT_CLAMP = 6.5;

const MIN_POINT_SIZE_PX = 0.6;
// Raised from the old procedural field's 3.2px ceiling: that value was
// tuned for a narrow synthetic brightness curve, not Sirius-to-mag-6.5's
// much wider real range.
const MAX_POINT_SIZE_PX = 5.5;

function magToBrightness(mag) {
  const clamped = Math.min(MAG_FAINT_CLAMP, Math.max(MAG_BRIGHT_CLAMP, mag));
  return 1 - (clamped - MAG_BRIGHT_CLAMP) / (MAG_FAINT_CLAMP - MAG_BRIGHT_CLAMP);
}

// B-V color index -> RGB, piecewise-linear between a few anchor colors.
// Real stellar color runs blue (B-V ~ -0.4, hot O/B stars) through white
// (B-V ~ 0.3) to deep red (B-V ~ 2.0, cool M giants) — this is a visual
// approximation, not a blackbody radiation model, same "plausible-
// looking, not radiometric" spirit as the old STAR_PALETTE it replaces.
const BV_STOPS = [
  { bv: -0.4, r: 0.65, g: 0.75, b: 1.0 },
  { bv: 0.0, r: 0.85, g: 0.9, b: 1.0 },
  { bv: 0.3, r: 1.0, g: 1.0, b: 1.0 },
  { bv: 0.6, r: 1.0, g: 0.94, b: 0.82 },
  { bv: 1.0, r: 1.0, g: 0.8, b: 0.6 },
  { bv: 2.0, r: 1.0, g: 0.55, b: 0.4 },
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// A small number of catalog entries have no bv value at all — default to
// white rather than dropping the star.
function bvToColor(bv) {
  if (!Number.isFinite(bv)) return { r: 1, g: 1, b: 1 };
  if (bv <= BV_STOPS[0].bv) return BV_STOPS[0];
  for (let i = 1; i < BV_STOPS.length; i++) {
    if (bv <= BV_STOPS[i].bv) {
      const a = BV_STOPS[i - 1];
      const b = BV_STOPS[i];
      const t = (bv - a.bv) / (b.bv - a.bv);
      return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
    }
  }
  return BV_STOPS[BV_STOPS.length - 1];
}

/**
 * Parses a d3-celestial-format stars GeoJSON (FeatureCollection of Point
 * features, `properties.mag`/`properties.bv`) into the same flat-typed-
 * array shape the old generateStarfield() returned: unit-sphere ecliptic
 * positions, per-star RGB (0..1), brightness (0..1), and a point size in
 * pixels correlated with brightness. `magLimit` filters out anything
 * fainter (the vendored stars.6.json is already limited to mag<=6.5, so
 * the default is a no-op unless a wider-range file is swapped in later).
 */
export function loadStarCatalog(starsGeoJson, magLimit = 6.5) {
  const features = starsGeoJson.features.filter((f) => f.properties.mag <= magLimit);
  const count = features.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);

  features.forEach((f, i) => {
    const [raDeg, decDeg] = f.geometry.coordinates;
    const p = equatorialToEcliptic(unitVectorFromRaDec(raDeg, decDeg));
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;

    const b = magToBrightness(f.properties.mag);
    brightness[i] = b;
    sizes[i] = MIN_POINT_SIZE_PX + (MAX_POINT_SIZE_PX - MIN_POINT_SIZE_PX) * b;

    const color = bvToColor(parseFloat(f.properties.bv));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  });

  return { positions, colors, sizes, brightness };
}

/**
 * Parses a d3-celestial-format constellation-lines GeoJSON (FeatureCollection
 * of MultiLineString features, coordinates as [raDeg,decDeg] pairs, same
 * convention as loadStarCatalog) into a flat Float32Array of
 * [x,y,z, x,y,z, ...] unit-sphere segment endpoint pairs — one consecutive
 * pair per line segment, ready for THREE.LineSegments.
 */
export function constellationLineSegments(linesGeoJson) {
  const points = [];
  for (const feature of linesGeoJson.features) {
    for (const line of feature.geometry.coordinates) {
      for (let i = 0; i < line.length - 1; i++) {
        const [ra1, dec1] = line[i];
        const [ra2, dec2] = line[i + 1];
        const p1 = equatorialToEcliptic(unitVectorFromRaDec(ra1, dec1));
        const p2 = equatorialToEcliptic(unitVectorFromRaDec(ra2, dec2));
        points.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    }
  }
  return new Float32Array(points);
}
