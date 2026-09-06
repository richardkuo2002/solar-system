# Changelog

All notable changes to this project. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions map 1:1 to the
milestones in `docs/ROADMAP.md` (local-only), with each version's exact
scope and accuracy notes in [docs/accuracy.md](docs/accuracy.md).

## v1.8.4 — 2026-09-06

- **Fixed Jupiter's four Galilean moons rendering overlapping each other
  (and dipping inside Jupiter itself)** — their real orbital-radius
  ratios span under 5x of each other, which compressed into a scene-unit
  spread narrower than the moons' own rendered sizes. Added
  `scale.js#spacedMoonOrbitRadii`, which orders a parent's moons by real
  orbit radius and pushes any orbit that would overlap its inner
  neighbor (or the parent itself) further out by the minimum needed —
  computed once at startup, a no-op for every other current moon system
  (0-1 moons each), and driven by the actual per-parent moon list so it
  automatically covers any future planet with 2+ real moons.

## v1.8.3 — 2026-09-06

- **Added 100x and 1000x to the speed dropdown**, between 5x and the two
  previous fixed rates (≈8640x, ≈86400x).
- **Fixed the Planet Info Panel still overlapping when expanded** —
  `.body-info-panel` was its own independent `position: fixed` stack
  growing upward from the bottom-left corner while `.left-column`
  (view-mode/surface/observer) grows downward from the top-left corner,
  sharing no combined height budget; a long Observer Mode result and a
  shown Planet Info Panel could still collide in the middle of the
  screen. It's now a flex item inside `.left-column` itself (`order: 1`
  + `margin-top: auto` keep it visually last regardless of DOM order),
  so the whole left-side stack shares one bounded height.

## v1.8.2 — 2026-09-06

- **Fixed bottom-left panels overlapping the time-controls bar** —
  `.left-column` and `.body-info-panel` measure the bar's real height via
  `ResizeObserver` instead of a hardcoded guess (`--time-bar-clearance`
  CSS custom property), the same fix class as v1.8.1's `.left-column`
  top offsets, applied to the shared bottom edge.
- **Redesigned the time-controls bar** as a centered floating card
  (border, rounded corners, width shrunk to content) matching every
  other panel's look, instead of a borderless bar stretched to the full
  viewport width.
- **Speed dropdown is now a real-time-anchored multiplier ladder**
  (1x/2x/5x, plus the previous two fixed rates relabeled as ≈8640x and
  ≈86400x) instead of raw days/second values — the default option now
  matches the clock's actual real-time starting speed (previously a
  known, documented mismatch since v1.8).

## v1.8.1 — 2026-09-05

- **Fixed overlapping left-side UI panels** — the view-mode, surface
  controls, and Observer Mode panels previously each hardcoded their own
  `position: fixed; top: Npx`, guessed from every sibling's height above
  it; that guess had gone stale since v1.3 added hint text, letting
  Observer Mode silently overlap and eat clicks meant for the surface
  panel's "Stand Here" button. Replaced with a single flex-column
  wrapper so each panel's real rendered height pushes the next one down
  automatically — this class of bug can't recur.
- **Fixed unreadable Event Toolkit analysis visuals in Surface Mode** —
  the existing Earth-to-target line-of-sight line is built from
  compressed scene coordinates, a different direction than Surface
  Mode's true-angular-direction sky proxies, and the Surface camera sits
  almost on top of the line's own endpoint; showing it there was actively
  misleading, not just unhelpful. Added a screen-space marker (orange
  badge, reuses the constellation-label projection technique) that
  points at the analyzed body's actual on-screen position instead,
  shown only in Surface Mode; the line-of-sight line is now shown only
  outside Surface Mode.

## v1.8 — 2026-09-05

- **Event Toolkit scrub now locks the whole scene, not just the
  line-of-sight line** — dragging a result's chart scrubber pauses the
  main simulated clock and jumps every planet/camera-relevant position to
  the scrubbed epoch, staying there after release. Previously only the
  line-of-sight visual froze while the rest of the scene kept advancing on
  the live clock, so the two could visibly disagree.
- **Simulated clock now starts at true real time** (1 simulated second
  per real second), not the previous default of 1 simulated day per real
  second (~86400x). The speed dropdown's presets are unchanged; a
  real-time-anchored multiplier ladder is a separate future follow-up.

## v1.7 — 2026-09-05

- **Light-time correction** — Observer Mode, Planetary Appulse, Phase/
  Illumination, and Retrograde's refined stationary-point epochs now
  evaluate the target at the retarded epoch its light actually left
  (`core/ephemeris.js#getLightTimeCorrectedState`), not "now" — a
  distinct effect from v1.6's annual aberration (target motion vs.
  observer motion). Skipped where it's below solver tolerance: the Sun,
  the Moon, Opposition/Conjunction, Greatest Elongation, and the
  lunar-eclipse path.
- **Moon Conjunction event type** — the general case Lunar Occultation is
  the special case of: how close a planet gets to the Moon in a specific
  observer's sky. Topocentric (unlike geocentric Planetary Appulse) since
  the Moon's own parallax exceeds many of the separations reported here.
  Tested against the real 2021-11-08 occultation of Venus and the real
  2022-05-27 Moon-Venus conjunction.
- **Free-flight vertical touch controls** — ▲/▼ buttons, press-and-hold,
  closing a documented gap since v0.10.
- **Chart PNG export** — every visible Event Toolkit chart can now be
  saved as a PNG alongside the existing JSON/CSV export.

## v1.6 — 2026-09-05

- **Nutation + annual aberration in Observer Mode** — RA/Dec is now a
  complete apparent place (true equinox of date): Meeus Ch. 22 abbreviated
  nutation series (verified against Meeus's worked Example 22.a),
  velocity-form annual aberration (Earth's velocity vector was already on
  every body-state — the old doc claim that this needed new plumbing was
  wrong, and is corrected), and apparent (GAST) sidereal time so hour
  angles stay equinox-consistent. Export frame renamed to
  `TOPOCENTRIC_EQUATORIAL_APPARENT`.

## v1.5 — 2026-09-05

- **Retrograde motion for all planets** — the Retrograde event type now
  accepts any of the 7 non-Earth planets (Mercury's famous retrograde
  included), not just Mars. Verified against Jupiter's real 2022
  retrograde loop (~2.5 h from published station times).
- **Real precession in Observer Mode** — RA/Dec is now reported in the
  mean equinox of date (rigorous IAU 1976 rotation, verified against
  Meeus's worked Example 21.b). Also fixes a silent J2000/of-date equinox
  mix in every hour-angle/rise-set/transit solve (~0.36° by 2026). The
  star catalog deliberately stays fixed-J2000.
- **Unified Moon position** — the 3D scene's Moon now uses the same Meeus
  lunar theory as the analysis path (one shared helper, drift-guard
  tested): real phase, real ~5° inclination, real eccentric distance.
  Surface Mode's Moon size follows the real perigee/apogee ±5.5% swing.

## v1.4 — 2026-09-05

- **Surface Mode true scale for all planets** — every planet (not just
  the Sun/moons) renders at its true real angular size from a planet's
  surface, with a FOV-derived minimum-pixel floor so sub-arcsecond discs
  stay visible as points. Fixes a v1.3 bug that made the Sun's Surface
  Mode position/scale NaN.
- **3 new Event Toolkit types** — Transit of Mercury/Venus (tested:
  2019-11-11 Mercury, 2012-06-06 Venus), Planetary Appulse (tested:
  2020-12-21 Jupiter-Saturn Great Conjunction), Lunar Occultation of a
  Planet (tested: 2021-11-08 occultation of Venus from Japan).
- **Epoch-reliability hint** — the ephemeris HUD warns how far a
  Kepler-only body's date is from its J2000 elements, and when it's
  outside the Standish table's 1800–2050 validity.

## v1.3 — 2026-09-05

- **Observer Mode precision** — atmospheric refraction (Bennett's
  formula; rise/set now solves the standard apparent-altitude −0.8333°
  crossing, verified against a published Kaohsiung sunrise/sunset table)
  and WGS-84 Earth oblateness in the observer position.
- **Surface Mode sky realism** — the Sun and the current planet's moon(s)
  render at their true real angular size while standing on a surface
  (previously the Moon filled ~half the sky due to the display
  compression curves).
- Surface Mode time-speed hint; fixed the v1.2.1 collapsible panels
  (CSS `[hidden]` was overridden by an explicit `display: flex`).

## v1.2.1 — 2026-09-05

- Constellation name labels (rank-1 constellations), dimmer constellation
  lines, per-planet orbit-path colors, collapsible Observer Mode / Event
  Toolkit panels.

## v1.2 — 2026-09-05

- **Real star catalog** — the night sky is now ~5,000 real Hipparcos
  stars (to magnitude 6.5, positioned by actual RA/Dec) plus the 88
  constellation line figures, from d3-celestial (BSD-3-Clause), replacing
  the procedural random starfield.

## v1.1 — 2026-09-05

- **Eclipse events** — lunar (none/penumbral/partial/total vs. Earth's
  real shadow cone) and solar (per-observer, topocentric,
  none/partial/annular/total) eclipse detection in the Event Toolkit,
  tested against the real 2022-11-08 lunar and 2024-04-08 solar eclipses.
- **Meeus lunar theory** — the Moon's analysis position upgraded from a
  circular approximation to Meeus Ch. 47 truncated series (~10″), the
  hard prerequisite for eclipse detection.

## v1.0.0 — 2026-09-05

First public release: 8 planets + Pluto/Charon + 7 moons + Halley's Comet
with real Keplerian elements and JPL Horizons live-data fallback, 4 camera
modes, time controls, Mars Retrograde Lab, Event Toolkit
(opposition/conjunction, elongation, phase, JSON/CSV export), Observer
Mode (topocentric RA/Dec/Alt/Az, rise/transit/set), planet info panel,
URL-shareable state, CI + GitHub Pages deploy, mobile touch controls,
Tauri desktop packaging. See `git log` v0.2–v0.11 for the step-by-step
build-up.
