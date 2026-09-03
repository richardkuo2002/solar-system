// Moon + the 4 Galilean moons. Elements are simplified relative to the
// parent planet (orbit radius + period, near-circular approximation) —
// full Standish-grade precision isn't needed for v1 moons.
// radiusKm/orbitKm/periodDays: NASA planetary fact sheets.

export const MOONS = {
  moon: {
    name: 'Moon', parent: 'earth',
    radiusKm: 1737.4, orbitKm: 384400, periodDays: 27.32,
    textureKey: 'moon', color: 0xaaaaaa,
  },
  io: {
    name: 'Io', parent: 'jupiter',
    radiusKm: 1821.6, orbitKm: 421700, periodDays: 1.769,
    textureKey: 'io', color: 0xe8d27a,
  },
  europa: {
    name: 'Europa', parent: 'jupiter',
    radiusKm: 1560.8, orbitKm: 671034, periodDays: 3.551,
    textureKey: 'europa', color: 0xcbb89d,
  },
  ganymede: {
    name: 'Ganymede', parent: 'jupiter',
    radiusKm: 2634.1, orbitKm: 1070412, periodDays: 7.155,
    textureKey: 'ganymede', color: 0x9a9a9a,
  },
  callisto: {
    name: 'Callisto', parent: 'jupiter',
    radiusKm: 2410.3, orbitKm: 1882709, periodDays: 16.69,
    textureKey: 'callisto', color: 0x6e6a5e,
  },
};

export const MOON_ORDER = ['moon', 'io', 'europa', 'ganymede', 'callisto'];
