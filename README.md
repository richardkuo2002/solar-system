# Solar System

[English](README.md) | [繁體中文](README.zh-TW.md)

**Live demo: https://richardkuo2002.github.io/solar-system/**

An interactive 3D solar system simulation, in the browser, with zero build
step. Real orbital mechanics, real textures, and four different ways to
look at the sky — top-down, free-flight, standing on a planet's surface, or
sitting on Earth watching the other planets drift (including real
retrograde motion).

## Features

- **8 planets** (Mercury–Neptune) + **Pluto** + **7 moons** (the Moon, Io,
  Europa, Ganymede, Callisto, Titan, Triton) + **Charon** (Pluto's moon) +
  **Halley's Comet** + a static asteroid belt, positioned using real
  low-precision Keplerian orbital elements (Standish 1992 / JPL SSD).
- Real axial rotation and axial tilt per planet (NASA planetary fact sheet
  values), including Venus's/Uranus's real retrograde spin.
- **Live position data** from [NASA JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)
  when online, falling back silently to local Kepler-equation math when
  offline or the API is unavailable — the render loop never blocks on a
  network call.
- **4 camera modes**:
  - **Heliocentric top-down** — the classic solar-system-diagram view, with
    mouse-orbit controls.
  - **Free-flight** — WASD + mouse-look, fly anywhere in the scene.
  - **Surface first-person** — stand on any planet at a chosen latitude/
    longitude and look up at the sky.
  - **Geocentric** — camera fixed at Earth, holding a fixed look direction
    while Earth itself moves along its real orbit. This is what actually
    produces Mars's retrograde loop — it's real orbital dynamics, not a
    scripted animation.
- **Time controls** — play/pause, speed multiplier, reverse, jump to any
  date.
- Distances and sizes are **compressed on a power-law curve** (not
  true-to-scale) so the whole system fits on screen at once — a standard
  approach for web solar-system visualizations.

## Running it

No build step, no dependencies. Just serve the directory (a plain `file://`
open won't work — ES modules need an actual origin):

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`.

## Project structure

```
src/
├── app.js              # entry point / orchestrator, animation loop
├── core/                # pure logic, zero DOM or THREE imports — Node-testable
│   ├── kepler.js          # Kepler-equation solver, elements → position
│   ├── orbital-elements.js
│   ├── scale.js           # distance/size compression curves
│   ├── time-controller.js
│   ├── camera-modes.js    # 4-mode state machine, pure pose computation
│   ├── horizons-client.js # JPL Horizons REST fetch + parsing
│   └── ephemeris.js       # Horizons-vs-local fallback, circuit breaker
├── data/                # planet/moon orbital elements, texture table
└── render/               # THREE.js scene, meshes, camera rig, UI (DOM layer)
```

`src/core/` has no THREE or DOM dependency, so `scripts/smoke-test.js` runs
the orbital math, scale curves, time controller, camera pose math, and
Horizons parsing/fallback logic directly under Node:

```bash
npm test
```

## Data sources

- Orbital elements: JPL Solar System Dynamics low-precision Keplerian
  element tables (Standish 1992), valid ~1800–2050 AD.
- Live positions: [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
  (no API key required).
- Textures: see [Assets](#assets) below.

## Status

v1 — desktop packaging (Tauri/Electron) is a possible future phase, not part
of this build.

## Assets

Code is MIT licensed (see [License](#license) below), but the third-party
planet/moon textures under `assets/textures/` keep their own original
licenses — MIT doesn't relicense them. Full per-file breakdown, sources, and
credits: **[ATTRIBUTION.md](ATTRIBUTION.md)**.

Planetary textures based on [Solar System Scope](https://www.solarsystemscope.com/textures/)
assets, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Modified for web rendering where noted. Selected moon imagery (Io, Europa,
Ganymede, Titan, Triton, Charon) from Steve Albers / NOAA Science On a
Sphere, compiled from NASA source imagery. Textures are downloaded by
`scripts/fetch-textures.mjs` (`npm run fetch-textures`), not committed by
hand — re-run it any time to refresh them or pick up a body that had no
working source URL yet (see the TODO list in `ATTRIBUTION.md`).

## License

MIT (code only — see [Assets](#assets) above)
