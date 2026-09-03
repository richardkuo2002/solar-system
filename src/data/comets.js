// Comet orbital elements, same [value, rate/century] shape as planets.js so
// this reuses core/orbital-elements.js + core/kepler.js completely
// unchanged — a comet is just a body with a far more eccentric, inclined
// orbit than a planet.
//
// Halley's Comet (1P/Halley), J2000 osculating elements from the JPL
// Small-Body Database (a, e, i, om, w). L (mean longitude) and its rate
// aren't published in Standish-table form for comets, so they're derived
// here from the 1986-02-09.66 UT perihelion passage + a Kepler-3rd-law
// period (T ≈ a^1.5 years) — good enough to reproduce the ~76-year loop
// visually, not research-grade for exact perihelion timing.
//
// radiusKm is deliberately fake/exaggerated: Halley's real nucleus (~11 km)
// would compress to a sub-pixel dot under scale.js's curve — same
// reasoning as SUN_SIZE_CAP capping the Sun in the other direction.

export const COMETS = {
  halley: {
    name: 'Halley',
    radiusKm: 8980, // exaggerated for visibility — see file comment
    color: 0xcfd6dd,
    elements: {
      a: [17.834, 0],
      e: [0.96658, 0],
      i: [162.26, 0], // >90°: retrograde orbit — elementsToPosition's math handles this unchanged
      L: [236.15, 477.9], // derived from perihelion date + period, see file comment
      wBar: [169.75, 0],
      om: [58.42, 0],
    },
  },
};

export const COMET_ORDER = ['halley'];
