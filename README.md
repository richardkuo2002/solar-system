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
- **4 camera modes** — WASD works in all of them, but only Free-flight is a
  true fly-anywhere move; in the other three it repositions that mode's own
  "starting point" instead:
  - **Heliocentric top-down** — the classic solar-system-diagram view, with
    mouse-orbit controls; WASD pans the point the view orbits around.
  - **Free-flight** — WASD + mouse-look, fly anywhere in the scene.
  - **Surface first-person** — stand on any planet at a chosen latitude/
    longitude and look up at the sky; WASD walks that latitude/longitude
    (W/S = north/south, A/D = west/east).
  - **Geocentric** — camera fixed at Earth, holding a fixed look direction
    while Earth itself moves along its real orbit. This is what actually
    produces Mars's retrograde loop — it's real orbital dynamics, not a
    scripted animation. WASD cycles which planet it's tracking, re-aiming
    at the new target.
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
npm run lint   # ESLint, recommended ruleset (v0.9)
```

Both run automatically on every push/PR via GitHub Actions
(`.github/workflows/ci.yml`); a separate workflow
(`.github/workflows/deploy.yml`) deploys `main` to GitHub Pages the same
way, gated on the same lint+test job passing first.

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
  Meeus lunar-theory position, separate from the live 3D scene's Moon
  animation (which still uses a simpler circular approximation) — see
  [docs/accuracy.md](docs/accuracy.md#the-moons-analysis-position-v11-meeus-lunar-theory)
  for why they can show the Moon at slightly different orbital angles for
  the same date.
- **Lunar / Solar Eclipse** (v1.1) — real eclipse geometry on top of the
  Meeus lunar theory above: lunar eclipses classify none/penumbral/
  partial/total from the Moon's offset from Earth's shadow axis vs. the
  umbra/penumbra cone radii at its distance; solar eclipses classify
  none/partial/annular/total *for a specific observer location*
  (lat/lon/elevation), using topocentric parallax correction the same way
  Observer Mode does. Tested against two real historical eclipses (the
  2022-11-08 total lunar eclipse, the 2024-04-08 total solar eclipse) —
  see [docs/accuracy.md](docs/accuracy.md#eclipses-v11) for the exact
  geometric simplifications (spherical bodies, no atmospheric shadow
  enlargement, magnitude + one peak time rather than a full 4/5-contact
  circumstance table).
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

## Planet Info Panel (v0.7)

Click any body (planet, moon, comet, dwarf planet, or the Sun) and the
bottom-left panel shows its physical/orbital characteristics from data
already in the app — no new astronomy, pure display:

- **Mass** — shown only for the Sun and the 8 planets (well-known NASA
  fact-sheet values); moons/comets/dwarf planets don't get a guessed
  number, the field is simply omitted.
- **Rotation period / axial tilt** — Sun and planets only.
- **Orbital period** — for planets/comets/dwarf planets this is *derived*
  via Kepler's third law (`T ≈ a^1.5`, the same approximation
  `data/comets.js` already used for Halley's Comet) from their orbital
  elements, since none of them store a period directly; for moons/Charon
  it's their real `periodDays` value, used as-is. The panel labels which
  is which.
- **Orbital elements** (semi-major axis, eccentricity, inclination) for
  anything with them; **orbit radius + parent body name** instead for
  moons/Charon, which use a simpler circular-orbit model.

## URL Shareable State (v0.8)

The address bar always reflects the current simulated date and camera
view — copy it at any time to get a link that restores the same scene:

- **Included**: simulated date, camera mode, focus body (Top-Down/
  Geocentric), Surface mode's planet/latitude/longitude.
- **Not included**: playback speed/direction/paused state, Free-flight's
  position/look direction, Event Toolkit or Observer Mode inputs.
- Updated live via `history.replaceState` — no new browser-history entries
  pile up as you play through time or fly around.
- A hand-edited or stale URL (unknown mode, out-of-range coordinates, an
  invalid date) silently falls back to defaults instead of crashing the
  page.

## Mobile Touch Controls (v0.10)

On a touch device (detected via `(pointer: coarse)`), a virtual joystick
and Prev/Next buttons appear automatically — desktop stays exactly as
before with zero extra UI.

- **Free-flight / Surface** — a bottom-left virtual joystick drives
  movement (forward/strafe, or lat/lon walking), working alongside WASD
  rather than replacing it.
- **Free-flight / Geocentric** — drag anywhere on the scene to look
  around, same as a mouse-drag.
- **Geocentric** — bottom-right ◀/▶ buttons cycle the tracked planet
  (WASD's touch equivalent).
- **Top-Down** — unchanged: this mode already used `OrbitControls`, which
  has built-in touch support (one-finger rotate, two-finger pinch/pan).
- Tapping a body to select it (Planet Info Panel) now works on touch too
  — previously it silently did nothing, since selection was wired only to
  mouse-hover state.
- **Known limits**: Free-flight's vertical (Q/E) movement has no touch
  control; a touchscreen laptop with a mouse as its primary pointer won't
  show the touch UI even though touch works.

## Data sources

- Orbital elements: JPL Solar System Dynamics low-precision Keplerian
  element tables (Standish 1992), valid ~1800–2050 AD.
- Live positions: [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
  (no API key required).
- Textures: see [Assets](#assets) below.

## Desktop App (Tauri)

Wraps the same static site in a native window via [Tauri](https://tauri.app/)
(not Electron — uses the OS's own WebView, no bundled Chromium). Requires
the [Rust toolchain](https://rustup.rs/) to build.

```bash
npm install
npm run tauri:dev     # native window, live against the source tree
npm run tauri:build   # produces a real .app/.dmg (macOS) bundle
```

- **Offline by default** — this is exactly why THREE.js is vendored
  locally (see [Assets](#assets) below) instead of loaded from a CDN: a
  packaged desktop app with no network shouldn't white-screen.
- **Window title/icon** and **window size/position** (remembered across
  launches, via the official `tauri-plugin-window-state` plugin) are set
  in `src-tauri/tauri.conf.json` / `src-tauri/src/lib.rs`.
- The app icon (`assets/icon-source.png`) is a placeholder — swap it for
  real artwork and re-run `npx tauri icon assets/icon-source.png` any
  time.
- **Out of scope for now**: auto-update, native menus/tray/notifications,
  code-signing/notarization for distribution, and mobile targets.

## Status

v1 — desktop packaging via Tauri is implemented (see above); an installer/
auto-update pipeline for distributing signed builds is not.

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

[three.js](https://threejs.org/) is vendored at `assets/vendor/three/`
(pinned to `0.160.0`, [MIT licensed](https://github.com/mrdoob/three.js/blob/dev/LICENSE))
rather than loaded from a CDN — needed for the desktop app to actually
work offline (see [Desktop App](#desktop-app-tauri) below). Only the exact
files this project imports are vendored: `build/three.module.js` and the
one addon in use, `examples/jsm/controls/OrbitControls.js`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — local setup, code conventions
(unit-bearing names, explicit coordinate provenance, test requirements for
new analysis features), and asset/licensing rules.

## License

MIT (code only — see [Assets](#assets) above)
