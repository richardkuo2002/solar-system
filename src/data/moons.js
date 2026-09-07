// Moon + the 4 Galilean moons + Titan + Triton. Elements are simplified
// relative to the parent planet (orbit radius + period, near-circular
// approximation) — full Standish-grade precision isn't needed for v1 moons.
// v1.5: THE Moon's 3D-scene position no longer uses these orbitKm/periodDays
// values (it's driven by the Meeus lunar theory, same as the analysis path
// — see core/orbital-elements.js#moonLocalPositionMeeus); its radiusKm is
// still used for rendering, and orbitKm/periodDays remain for the other
// moons' circular approximation.
// radiusKm/orbitKm/periodDays: NASA planetary fact sheets. Negative
// periodDays = retrograde orbit (Triton) — same sign trick already used for
// Venus/Uranus retrograde axial spin in planets.js, reusing
// core/orbital-elements.js#circularOrbitAngle unchanged.
//
// textureKey: real texture if one exists in data/textures.js (see
// ATTRIBUTION.md for sourcing); proceduralPalette: fallback used by
// src/render/procedural-textures.js when there's no real file (Callisto —
// see ATTRIBUTION.md for why).
// v1.11.3 risk audit — dropped each moon's `color` field: dead, same as
// comets.js/dwarf-planets.js (buildBodyMesh never applies bodyData.color
// as a material tint, and moons have no orbit line to read it either).

export const MOONS = {
  moon: {
    name: 'Moon', parent: 'earth',
    radiusKm: 1737.4, orbitKm: 384400, periodDays: 27.32,
    textureKey: 'moon',
  },
  io: {
    name: 'Io', parent: 'jupiter',
    radiusKm: 1821.6, orbitKm: 421700, periodDays: 1.769,
    textureKey: 'io',
  },
  europa: {
    name: 'Europa', parent: 'jupiter',
    radiusKm: 1560.8, orbitKm: 671034, periodDays: 3.551,
    textureKey: 'europa',
  },
  ganymede: {
    name: 'Ganymede', parent: 'jupiter',
    radiusKm: 2634.1, orbitKm: 1070412, periodDays: 7.155,
    textureKey: 'ganymede',
  },
  callisto: {
    name: 'Callisto', parent: 'jupiter',
    radiusKm: 2410.3, orbitKm: 1882709, periodDays: 16.69,
    proceduralPalette: 'callisto',
  },
  titan: {
    name: 'Titan', parent: 'saturn',
    radiusKm: 2574.7, orbitKm: 1221870, periodDays: 15.945,
    textureKey: 'titan',
  },
  triton: {
    name: 'Triton', parent: 'neptune',
    radiusKm: 1353.4, orbitKm: 354759, periodDays: -5.877, // retrograde
    textureKey: 'triton',
  },
};

export const MOON_ORDER = ['moon', 'io', 'europa', 'ganymede', 'callisto', 'titan', 'triton'];
