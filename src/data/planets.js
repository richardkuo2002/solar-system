// Low-precision Keplerian elements for the 8 planets (Standish 1992 /
// JPL "Keplerian Elements for Approximate Positions of the Planets" table,
// valid ~1800-2050 AD). Angles in degrees, a in AU, each element is
// [value_at_J2000, rate_per_Julian_century] — see core/orbital-elements.js
// for how these are propagated to a given date.
//
// Source: JPL Solar System Dynamics low-precision element tables.
// radiusKm: mean equatorial radius. color: fallback flat color before
// textures land (step 5). rotationPeriodDays: sidereal axial rotation
// period (NASA planetary fact sheet); negative = retrograde spin (Venus,
// Uranus) — reuses core/orbital-elements.js#circularOrbitAngle unchanged,
// same math as an orbit angle, just applied to the body's own spin instead.
// axialTiltDeg: obliquity to orbit, paired with the *signed* rotation-period
// convention above (so Venus/Uranus use the small "flipped-axis" angle,
// e.g. Venus is 2.64° here, not the 177.4° figure that pairs with an
// always-positive rotation rate instead).

export const PLANETS = {
  mercury: {
    name: 'Mercury',
    radiusKm: 2439.7,
    color: 0x8c7853,
    textureKey: 'mercury',
    rotationPeriodDays: 58.646,
    axialTiltDeg: 0.034,
    elements: {
      a: [0.38709927, 0.00000037],
      e: [0.20563593, 0.00001906],
      i: [7.00497902, -0.00594749],
      L: [252.25032350, 149472.67411175],
      wBar: [77.45779628, 0.16047689],
      om: [48.33076593, -0.12534081],
    },
  },
  venus: {
    name: 'Venus',
    radiusKm: 6051.8,
    color: 0xe8cda2,
    textureKey: 'venus',
    atmosphereTextureKey: 'venusAtmosphere', // translucent shell over the surface map — see render/bodies.js#buildAtmosphereShell
    rotationPeriodDays: -243.025,
    axialTiltDeg: 2.64,
    elements: {
      a: [0.72333566, 0.00000390],
      e: [0.00677672, -0.00004107],
      i: [3.39467605, -0.00078890],
      L: [181.97909950, 58517.81538729],
      wBar: [131.60246718, 0.00268329],
      om: [76.67984255, -0.27769418],
    },
  },
  earth: {
    name: 'Earth',
    radiusKm: 6371.0,
    color: 0x2a6ebb,
    textureKey: 'earth',
    nightTextureKey: 'earthNight', // city-lights emissive map — see render/bodies.js#buildBodyMesh
    cloudsTextureKey: 'earthClouds', // translucent shell over the day map — see render/bodies.js#buildAtmosphereShell
    rotationPeriodDays: 0.99727,
    axialTiltDeg: 23.44,
    elements: {
      a: [1.00000261, 0.00000562],
      e: [0.01671123, -0.00004392],
      i: [-0.00001531, -0.01294668],
      L: [100.46457166, 35999.37244981],
      wBar: [102.93768193, 0.32327364],
      om: [0.0, 0.0],
    },
  },
  mars: {
    name: 'Mars',
    radiusKm: 3389.5,
    color: 0xc1440e,
    textureKey: 'mars',
    rotationPeriodDays: 1.025957,
    axialTiltDeg: 25.19,
    elements: {
      a: [1.52371034, 0.00001847],
      e: [0.09339410, 0.00007882],
      i: [1.84969142, -0.00813131],
      L: [-4.55343205, 19140.30268499],
      wBar: [-23.94362959, 0.44441088],
      om: [49.55953891, -0.29257343],
    },
  },
  jupiter: {
    name: 'Jupiter',
    radiusKm: 69911,
    color: 0xd8ca9d,
    textureKey: 'jupiter',
    rotationPeriodDays: 0.41354,
    axialTiltDeg: 3.13,
    elements: {
      a: [5.20288700, -0.00011607],
      e: [0.04838624, -0.00013253],
      i: [1.30439695, -0.00183714],
      L: [34.39644051, 3034.74612775],
      wBar: [14.72847983, 0.21252668],
      om: [100.47390909, 0.20469106],
    },
  },
  saturn: {
    name: 'Saturn',
    radiusKm: 58232,
    color: 0xead6b8,
    textureKey: 'saturn',
    rotationPeriodDays: 0.44401,
    axialTiltDeg: 26.73,
    elements: {
      a: [9.53667594, -0.00125060],
      e: [0.05386179, -0.00050991],
      i: [2.48599187, 0.00193609],
      L: [49.95424423, 1222.49362201],
      wBar: [92.59887831, -0.41897216],
      om: [113.66242448, -0.28867794],
    },
  },
  uranus: {
    name: 'Uranus',
    radiusKm: 25362,
    color: 0xace5ee,
    textureKey: 'uranus',
    rotationPeriodDays: -0.71833,
    axialTiltDeg: 82.23,
    elements: {
      a: [19.18916464, -0.00196176],
      e: [0.04725744, -0.00004397],
      i: [0.77263783, -0.00242939],
      L: [313.23810451, 428.48202785],
      wBar: [170.95427630, 0.40805281],
      om: [74.01692503, 0.04240589],
    },
  },
  neptune: {
    name: 'Neptune',
    radiusKm: 24622,
    color: 0x3f54ba,
    textureKey: 'neptune',
    rotationPeriodDays: 0.67125,
    axialTiltDeg: 28.32,
    elements: {
      a: [30.06992276, 0.00026291],
      e: [0.00859048, 0.00005105],
      i: [1.77004347, 0.00035372],
      L: [-55.12002969, 218.45945325],
      wBar: [44.96476227, -0.32241464],
      om: [131.78422574, -0.00508664],
    },
  },
};

export const PLANET_ORDER = [
  'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune',
];

export const SUN = {
  name: 'Sun',
  radiusKm: 696000,
  color: 0xffdd88,
  textureKey: 'sun',
  rotationPeriodDays: 25.05, // equatorial sidereal rotation
  axialTiltDeg: 7.25,
};
