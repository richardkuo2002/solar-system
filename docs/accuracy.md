# Accuracy & Data Sources

This document exists so "where did this number come from" is never a
mystery. The app's ephemeris HUD (top-right) always shows which source
produced the currently-selected body's position; this page explains what
each source actually is, what isn't modeled, and a real, rerunnable
measurement of how far the two main sources agree.

## Position sources, in fallback order

1. **JPL Horizons (cached)** — 8 major planets only (Mercury–Neptune, IANA
   planet-center codes 199–899, not barycenters). Fetched from
   https://ssd.jpl.nasa.gov/api/horizons.api, geometric heliocentric
   position + velocity vectors (`CENTER='500@10'`, no light-time
   correction; `VEC_TABLE='2'`), ecliptic-of-J2000 reference plane. Cached
   client-side in 6-hour time buckets (up to 5000 entries, **in-memory
   only** — cleared on page reload, not persisted). A circuit breaker
   disables further Horizons attempts for 60 seconds after any single
   failed request (network error, timeout, non-2xx, malformed response).
2. **Kepler propagation** — every other body (Sun, comets, dwarf planets,
   and the 8 planets whenever Horizons hasn't returned a value into the
   cache yet), using the JPL "Keplerian Elements for Approximate Positions
   of the Planets" (Standish, 1992) low-precision element table, valid
   1800–2050 AD. Elements are `[value_at_J2000, rate_per_Julian_century]`
   pairs, propagated linearly in time and solved via Newton-Raphson on
   Kepler's equation (1e-6 rad tolerance, 30 iterations max). Velocity is
   a central finite difference (±30 minutes) over the same position
   function — not a separate model.

`source: 'horizons-live'` exists in the body-state contract's enum but is
**structurally unreachable** as a return value in this implementation: a
fresh Horizons fetch is fired in the background and only ever populates
the cache for a *later* lookup to read — no caller ever synchronously
observes the fetch that just resolved (the render loop must never block a
frame on network). Only `'horizons-cache'` (a cache entry exists, however
recently fetched) or `'kepler'` (no cache entry yet, the body isn't
Horizons-eligible, or the circuit breaker is open) are ever actually
returned.

## What is NOT modeled

- No planetary perturbations (no N-body gravity between planets) — pure
  two-body Kepler orbits around the Sun.
- No light-time correction, no relativistic correction.
- Comets and dwarf planets use the *same* low-precision element
  propagation as planets, even though the Standish table was fit to the 8
  major planets — treat comet/dwarf-planet positions as illustrative, not
  ephemeris-grade, especially far from whatever date their elements were
  sourced for.
- Moons (including Charon) use a circular-orbit approximation (constant
  angular rate from `orbitKm`/`periodDays`, zero eccentricity/inclination)
  around their parent planet — not Kepler-propagated, and deliberately
  **not** part of the AU body-state contract at all (see
  `src/core/body-state.js`'s scope note): `moonLocalPosition` returns
  parent-relative *scene* units via a nonlinear display-space compression
  curve with no meaningful inverse back to AU. The HUD shows a moon's
  source as "Kepler propagation (circular approx.)" with its parent as
  center and "scene units (not AU)" instead of fabricating an AU position.
- Horizons requests fetch position + velocity only — no light-time,
  range-rate, or uncertainty data.

## Center, frame, units

- Center: Sun (heliocentric), for every body in the AU contract. The Sun's
  own body-state is the exact origin `{0,0,0}` by definition of a
  heliocentric frame — not propagated, reported as `quality:'authoritative'`.
- Frame: ECLIPJ2000 — mean ecliptic and equinox of J2000.0. Both the
  Standish table and Horizons's `REF_PLANE=ECLIPTIC` output are consistent
  with this to the precision this app needs.
- Units: AU for position, AU/day for velocity, in the body-state contract;
  scene units (a nonlinear, monotonic compression curve — see
  `src/core/scale.js`) for anything actually rendered.

## Supported bodies

Sun, Mercury–Neptune (8 planets), the Moon + 6 named moons (Io, Europa,
Ganymede, Titan, Triton, Callisto), Pluto + Charon, Halley's Comet.
Horizons-backed: Mercury–Neptune only — this is a deliberate scope
boundary (see `HORIZONS_CODES` in `src/core/ephemeris.js`), not a gap;
every other body honestly reports `source:'kepler', quality:'approximate'`
rather than gaining a new, unverified Horizons code.

## Validation method / position-error metric

A real, rerunnable comparison, not a canned number: for Mars on a fixed
reference date (2026-09-04T00:00:00Z), compare the Kepler-propagated
`positionAu` against a live Horizons `positionAu` for the same date, and
report the Euclidean AU delta between them.

Measured this session:

```
Kepler:   { x: 0.4824661538830980, y: 1.4452354894893740, z: 0.0184569042376058 }
Horizons: { x: 0.4822706778297069, y: 1.4454181205564730, z: 0.0184652779486823 }
Delta:    0.000268 AU (≈ 40,000 km, ≈ 0.006% of Mars's ~1.5 AU distance from the Sun)
```

This is comfortably sub-0.01 AU agreement for an inner-outer planet near
J2000+26 years, consistent with the Standish table's documented accuracy
characteristics. Re-run periodically — the linear-rate propagation drifts
further from truth the further the date is from J2000, especially past
2050, when the table is no longer valid at all.

## Mars Retrograde Lab (v0.4)

The Retrograde Lab panel computes Mars's **geocentric ecliptic longitude**
(`λ = atan2(Δy, Δx)` of the heliocentric Mars-minus-Earth AU vector) over a
user-chosen date range, and finds where its rate of change crosses zero
(stationary points) to locate the retrograde interval between them. This is
a **geometric** longitude, not a light-time-corrected apparent/visual
position — consistent with the "no light-time correction" limitation
already noted above, so it should not be read as exactly what an observer
would see through a telescope at that instant, though the offset is small
relative to the multi-week timescale of a retrograde loop.

The dense scan this requires (hundreds of body-state lookups across a
multi-month range) always uses Kepler propagation internally, regardless of
the panel's "Ephemeris source" dropdown — letting that many lookups each
fire a background Horizons request would be an unbounded, unwanted side
effect. The dropdown only selects the source used for one extra lookup that
labels the result's displayed `source` field; as documented above, that
value is realistically `'kepler'` or `'horizons-cache'`, never
`'horizons-live'`.

## Known limitations (plain language)

- "Live" Horizons data is best-effort and cache-first — a page load can go
  a while showing Kepler-only positions if Horizons is unreachable or the
  circuit breaker is open; the HUD always says which source is active, so
  this is visible, not silent.
- Distances/sizes on screen are **not** to real scale (see
  `src/core/scale.js`) — only the underlying position math is physically
  modeled; the picture is deliberately compressed to stay legible with the
  whole solar system visible at once.
- Comets, dwarf planets, and moons are approximate by design (see above).
  Do not use this app to plan an actual perihelion-timing or occultation
  observation.
