// Dwarf planets. Same [value, rate/century] element shape and Standish
// source as data/planets.js — Pluto was in fact still on that original JPL
// table (it just predates the 2006 IAU reclassification), so these are the
// real, unmodified table values, not an approximation like comets.js.
//
// Kept as a separate table from PLANETS rather than folded in: PLANET_ORDER
// drives Horizons lookups (data/comets.js's docstring explains why comets
// skip that — same reasoning here) and the surface-mode planet picker,
// neither of which apply to Pluto for v1. The point of adding it is purely
// visual — its ~17° inclination stands out sharply next to the 8 major
// planets' near-coplanar orbits.

export const DWARF_PLANETS = {
  pluto: {
    name: 'Pluto',
    radiusKm: 1188.3,
    color: 0xc9b29b,
    elements: {
      a: [39.48211675, -0.00031596],
      e: [0.24882730, 0.00005170],
      i: [17.14001206, 0.00004818],
      L: [238.92903833, 145.20780515],
      wBar: [224.06891629, -0.04062942],
      om: [110.30393684, -0.01183482],
    },
  },
};

export const DWARF_PLANET_ORDER = ['pluto'];
