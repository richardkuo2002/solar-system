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
  network call. An on-screen HUD always shows which source, reference
  center, and frame are currently active (see
  [docs/accuracy.md](docs/accuracy.md) for the model, coverage, and known
  limitations).
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

## Event Toolkit (v0.5)

The "Event Toolkit" panel (right column, below the ephemeris HUD) is the
app's astronomical-phenomenon analysis tool — a dropdown picks the event
type, and one shared results/chart layout renders whichever is selected.

- **Retrograde (Mars)** (v0.4) — computes Mars's geocentric ecliptic
  longitude (`λ = atan2(Δy, Δx)` of the heliocentric Mars-minus-Earth AU
  vector) at each sample point, unwraps it for continuity across the
  0°/360° boundary, takes its rate of change via central difference, then
  finds the two zero-crossings (stationary points) via a coarse scan +
  bisection refinement — never reporting a raw sample time as the answer.
  Visuals: the Earth-to-Mars line-of-sight drawn into the main 3D scene
  (best viewed in Heliocentric or Free-flight camera mode), Mars's
  apparent path plotted against a reference grid, and a λ(t) timeline with
  both stationary points and the retrograde interval marked.
- **Opposition / Conjunction** (Mars, Jupiter, Saturn) — same
  coarse-scan-then-bisect solver, fed elongation's (Sun-Earth-planet
  angle) rate of change instead: a rising-to-falling flip is opposition, a
  falling-to-rising flip is conjunction.
- **Greatest Elongation** (Mercury, Venus) — the same solver again, fed
  *signed* elongation's rate of change (positive = east of the Sun/evening
  sky, negative = west/morning sky); extrema instead of zero-crossings.
- **Inferior / Superior Conjunction** (Mercury, Venus) — feeds the solver
  the raw signed-elongation *values* directly (no derivative); each
  zero-crossing is classified inferior vs. superior by comparing
  Earth-distances.
- **Phase / Illumination** (Moon, Mercury, Venus, Mars) — a single-epoch
  calculation (no solver): phase angle α (Sun-target-observer angle) and
  illuminated fraction `k = (1 + cos(α)) / 2`. The Moon's phase uses a
  second, independent circular-orbit approximation from the live 3D
  scene's Moon animation — see
  [docs/accuracy.md](docs/accuracy.md#the-moons-second-independent-circular-orbit-approximation)
  for why they can show the Moon at different orbital angles for the same
  date, and why neither is calibrated to the real Moon's actual phase.
- **Export** — every event result can be saved as JSON or CSV via the
  panel's Export buttons, with full reproducibility metadata (event type,
  target, observer, frame/center/source, inputs, solver method/tolerance);
  the dense per-sample chart data is intentionally not included.
- **Limitations** — geometric quantities only, no light-time correction;
  the apparent-path view plots raw AU coordinates, not a sky-projected
  RA/Dec view; results outside the Standish table's ~1800–2050 validity
  window are increasingly approximate; every dense scan always uses Kepler
  propagation internally regardless of the source dropdown (see
  [docs/accuracy.md](docs/accuracy.md) for why).

## Observer Mode (v0.6)

The "Observer Mode" panel (left column, below the surface controls) adds
a **topocentric** view — observation from a specific point on Earth's
surface, not the geocenter. Enter a latitude/longitude/elevation (default:
Kaohsiung, Taiwan — 22.6273°N, 120.3014°E, 0m — but freely editable) and
an observation time, pick a target (Sun, Moon, or any of the 8 planets),
and click Observe:

- **RA/Dec** and **Alt/Az** for that instant, with an above/below-horizon
  flag.
- **Rise / transit / set** for the UTC calendar day containing the entered
  time, plus an altitude-vs-time-of-day chart with a horizon line. A
  circumpolar target (never sets) or one that never rises that day is
  reported as such, not faked.
- **Topocentric correction** — starts from the existing geocentric
  position, then subtracts the observer's own position (derived from
  lat/lon/elevation and sidereal time). Uses a **fixed** obliquity (no
  precession/nutation), a **spherical** Earth (no oblateness), and **no**
  aberration or atmospheric refraction — every one of those approximations
  is documented in
  [docs/accuracy.md](docs/accuracy.md#observer-mode-v06).

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
