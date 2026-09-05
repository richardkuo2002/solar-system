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
- No relativistic correction (light deflection near the Sun's limb).
  Light-time correction to the target (the light-travel-time offset of
  the target's own position) is modeled as of v1.7 for Observer Mode,
  Planetary Appulse, Phase/Illumination, and Retrograde's refined
  stationary-point epochs (`core/ephemeris.js#getLightTimeCorrectedState`)
  — see "Nutation + annual aberration" / light-time in the Observer Mode
  section below for the exact scope and what's still excluded (elongation
  extrema, the lunar-eclipse path, and every dense-scan chart's raw
  apparent-path plot).
- Comets and dwarf planets use the *same* low-precision element
  propagation as planets, even though the Standish table was fit to the 8
  major planets — treat comet/dwarf-planet positions as illustrative, not
  ephemeris-grade, especially far from whatever date their elements were
  sourced for.
- Moons other than the Moon (Charon, Io, Europa, etc.) use a circular-
  orbit approximation (constant angular rate from `orbitKm`/`periodDays`,
  zero eccentricity/inclination) around their parent planet — not Kepler-
  propagated, and deliberately **not** part of the AU body-state contract
  at all (see `src/core/body-state.js`'s scope note): `moonLocalPosition`
  returns parent-relative *scene* units via a nonlinear display-space
  compression curve with no meaningful inverse back to AU. The HUD shows a
  moon's source as "Kepler propagation (circular approx.)" with its parent
  as center and "scene units (not AU)" instead of fabricating an AU
  position. The Moon itself is the exception: since v1.1 its
  **analysis-path** position and, since v1.5, its **3D-scene** position
  too both use the Meeus lunar theory (real inclination/eccentricity/
  phase) — see "The Moon's analysis position (v1.1: Meeus lunar theory)"
  below.
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

## Retrograde Lab (v0.4, generalized to all planets in v1.5)

The Retrograde event type computes a planet's **geocentric ecliptic
longitude** (`λ = atan2(Δy, Δx)` of the heliocentric target-minus-Earth AU
vector — Mars only through v1.4; any of the 7 non-Earth planets since
v1.5, the math was always body-agnostic and only the target string was
hardcoded; verified against Jupiter's real 2022 retrograde loop, station
dates matching published tables to ~2.5 hours, see
`scripts/smoke-test.js`) over a
user-chosen date range, and finds where its rate of change crosses zero
(stationary points) to locate the retrograde interval between them. The
**refined stationary-point epochs** (`result.start`/`result.end`) are
light-time corrected as of v1.7 (a slowly-varying term in λ that shifts
where dλ/dt crosses zero, by seconds — sharpens the epoch, never changes
which coarse bracket it's found in). The **coarse scan and chart series**
(the apparent-path plot, `series.xAu`/`yAu`) stay uncorrected geometric
longitude, so the chart itself should not be read as exactly what an
observer would see through a telescope at any given instant, though the
offset is small relative to the multi-week timescale of a retrograde loop.

The dense scan this requires (hundreds of body-state lookups across a
multi-month range) always uses Kepler propagation internally, regardless of
the panel's "Ephemeris source" dropdown — letting that many lookups each
fire a background Horizons request would be an unbounded, unwanted side
effect. The dropdown only selects the source used for one extra lookup that
labels the result's displayed `source` field; as documented above, that
value is realistically `'kepler'` or `'horizons-cache'`, never
`'horizons-live'`.

## Event Toolkit (v0.5)

v0.5 generalizes the Retrograde Lab into a consolidated **Event Toolkit**
panel with several event types, all built on the same
"coarse-scan-then-bisect a sign-flip" solver v0.4's Retrograde Lab
introduced (`findStationaryPoints`) — no new root-finding code, just
different physical quantities fed into it. Every dense scan below shares
the Retrograde Lab's dense-scan-forces-Kepler guardrail: internally always
`'kepler'`, regardless of the panel's "Ephemeris source" dropdown, which
only labels one extra display lookup.

- **Opposition / conjunction** (Mars, Jupiter, Saturn): elongation (the
  Sun-Earth-planet angle, via a dot-product formula) oscillates smoothly
  between 0° and 180° over the synodic period. A `+ → −` sign flip of
  d(elongation)/dt is opposition (a local maximum, not always exactly
  180° — orbital inclination means it can fall a few degrees short); a
  `− → +` flip is conjunction (a local minimum, near 0°).
- **Greatest elongation** (Mercury, Venus): *signed* elongation (positive
  = east of the Sun/evening sky, negative = west/morning sky — sign from
  a cross-product) oscillates between a positive and a negative extreme.
  Feed its derivative into the same solver; extrema instead of
  zero-crossings.
- **Inferior / superior conjunction** (Mercury, Venus): the raw *signed*
  elongation values themselves (not a derivative) cross zero twice per
  synodic cycle. Each crossing is classified inferior (target closer to
  Earth than the Sun at that epoch) vs. superior (target beyond the Sun)
  by comparing Earth-distances directly — the crossing direction alone
  can't tell the two apart.
- **Phase angle / illuminated fraction** (Moon, Mercury, Venus, Mars): a
  single-epoch evaluation, not an interval search — no solver involved.
  Phase angle α is the Sun-target-observer angle (vertex at the target);
  illuminated fraction is `k = (1 + cos(α)) / 2`.

### The Moon's analysis position (v1.1: Meeus lunar theory)

Phase/illumination, Observer Mode, and Eclipse analysis all need a real
heliocentric AU position for the Moon, which the live 3D scene has never
had (`moonLocalPosition` only produces a parent-relative *scene*-unit
position via a nonlinear display-compression curve). **As of v1.5 the 3D
scene's Moon uses this same Meeus lunar theory too** — see the update at
the end of this section.

Through v1.0, `moonHeliocentricPositionAu` used that *same* circular-orbit
shape for the analysis path too (zero inclination, zero eccentricity, an
arbitrary J2000 phase anchor) — not calibrated to the real Moon at all
(confirmed by running it against real full-moon dates: it reported
illuminated fractions around 0.08–0.14, not near 1). Because inclination
was zero, the Moon was always exactly coplanar with the ecliptic at every
new/full moon, which made real eclipse detection impossible on top of it
(every syzygy would spuriously "eclipse").

**v1.1 replaced this** with `src/core/lunar-theory.js#moonEclipticPosition`
— Meeus, *Astronomical Algorithms* 2nd ed., Chapter 47's truncated
periodic series (60 terms for longitude/distance, 60 for latitude; ~10
arcsec longitude / ~4 arcsec latitude / ~4000 km distance precision per
Meeus). This has real inclination, eccentricity, and is calibrated to the
actual Moon (verified against Meeus's own published worked example, see
`scripts/smoke-test.js`). Two things worth knowing:

- Meeus's series outputs longitude referred to the **mean equinox of
  date**, not the fixed J2000 equinox every other body-state in this app
  uses. `moonHeliocentricPositionAu` applies the general-precession-in-
  longitude correction (~50.29"/year, so ~0.33° by 2024) before combining
  it with Earth's J2000-fixed position — get this wrong and the error is
  large enough to misclassify a real eclipse (this actually happened
  during v1.1 development; the fix is what the reference-case tests now
  guard against).
- Not corrected for nutation (sub-arcminute, negligible at this project's
  precision level) or light-time (Earth-Moon light-time is ~1.3s, also
  negligible here).
- ~~This upgrade is analysis-only.~~ **v1.5 closed the split**: the 3D
  scene's visual Moon now derives its position from the same
  Meeus/J2000-aligned source as the analysis path (both go through one
  shared helper, `core/orbital-elements.js#moonGeocentricJ2000`, so they
  provably can't drift apart) — real phase, real ~5° inclination
  (the scene Moon is no longer pinned to the ecliptic plane), real
  eccentric distance (fed into the same `compressMoonOrbit` display curve
  in place of the old constant orbit radius; Surface Mode's rendered Moon
  size follows the real perigee/apogee ±5.5% swing too). The scene and
  the Event Toolkit/Observer Mode finally show the same Moon for the same
  date. Every OTHER moon (Io, Europa, Ganymede, Callisto, Titan, Triton,
  Charon) still uses the circular approximation — that sentence in "What
  is NOT modeled" is now literally scoped to non-Moon moons.

### Export (JSON / CSV)

Any event result can be exported via the panel's "Export JSON"/"Export
CSV" buttons. Both formats carry full reproducibility metadata (event
type, target, observer, frame/center/source, input parameters, solver
method/tolerance, result) — but **not** the dense per-sample `series`
array the charts are drawn from; that's chart-only data, not part of what
"reproducible" means here. CSV uses one shared column set across every
event type, with multi-event results (opposition/conjunction, greatest
elongation, inferior/superior conjunction) flattened to one row per event.

## Observer Mode (v0.6)

Observer Mode adds a **topocentric** view — observation from a specific
point on Earth's surface (latitude/longitude/elevation), not Earth's
geocenter — on top of the existing geocentric position math above. Every
simplification below is deliberate and matches the roadmap's explicit
requirement to state the topocentric model's scope.

- **Model**: start from the existing geocentric position (heliocentric
  target-minus-Earth AU vector), rotate it from the ecliptic plane into the
  equatorial plane by Earth's **fixed** obliquity
  (`PLANETS.earth.axialTiltDeg`, 23.44°), then subtract the observer's own
  geocentric position (derived from lat/lon/elevation + sidereal time) —
  exactly the roadmap's "geocentric position, then subtract the observer's
  position relative to Earth's center."
- **Precession (v1.5: modeled — mean equinox of date).**
  `precessEquatorialToDate` (`src/core/topocentric.js`) applies the
  rigorous IAU 1976 rotation (Meeus Ch. 21, ζ/z/θ polynomials, verified
  against Meeus's own worked Example 21.b in `scripts/smoke-test.js`) to
  the target's equatorial vector before RA/Dec extraction — as of v1.5
  the output frame became the **mean equator/equinox of date**, and v1.6's
  nutation upgrade (next bullet) took it the rest of the way to the true
  equinox of date (`TOPOCENTRIC_EQUATORIAL_APPARENT` in exported
  results). This also
  fixed a real internal inconsistency: `gmstDeg`'s sidereal time is
  inherently equinox-of-date, so hour angles built from a J2000-anchored
  RA were silently mixing two equinox references (~0.36° by 2026) in
  every rise/set/transit solve. The precession rotation is applied at
  Observer Mode's output only — the ecliptic↔equatorial obliquity
  rotation itself (`OBLIQUITY_DEG`) stays a fixed J2000 constant **on
  purpose**: the star catalog renders fixed-J2000 Hipparcos coordinates
  through the same `equatorialToEcliptic`, and a date-dependent obliquity
  there would slowly rotate the whole star sphere with no corresponding
  data correction. Do not "unify" those two — the asymmetry is the
  correct design.
- **Sidereal time**: Greenwich Mean Sidereal Time via a low-precision
  IAU-1982-style polynomial (`src/core/topocentric.js#gmstDeg`) — adequate
  to sub-arcminute accuracy for civil dates, not observatory-grade.
- **Observer position (v1.3: WGS-84 oblate Earth)**: `observerGeocentricPositionAu`
  uses the standard geodetic-to-geocentric conversion (Meeus Ch. 11,
  flattening f=1/298.257223563), not a spherical Earth — geodetic and
  geocentric latitude are correctly distinguished, unlike v0.6-v1.2.
- **Atmospheric refraction (v1.3: modeled).** `refractionArcmin` applies
  Bennett's formula (Meeus Ch. 16, true-altitude form:
  `1.02 / tan(h + 10.3/(h+5.11))` arcminutes), giving `apparentAltDeg`
  alongside the geometric `altDeg`. Rise/set now solves for
  `apparentAltDeg == -0.8333°` (the standard convention, accounting for
  both refraction and the Sun/Moon's own angular radius), not a geometric
  horizon crossing — verified against a real published sunrise/sunset
  table for Kaohsiung, Taiwan (see `scripts/smoke-test.js`), matching to
  within tens of seconds. Transit (culmination) is unaffected by
  refraction and stays geometric.
- **Nutation + annual aberration (v1.6: modeled — apparent place).**
  `nutation(jd)` (`src/core/topocentric.js`) computes Δψ/Δε via Meeus
  Ch. 22's abbreviated series (verified against Meeus's worked Example
  22.a to ~0.01″, see `scripts/smoke-test.js`); `nutateEquatorialToTrue`
  rotates mean-of-date → true equinox of date, and `eqEquinoxDeg`
  (Δψ·cos ε) upgrades the sidereal time to apparent (GAST) so hour angles
  stay equinox-consistent with the true-of-date RA — the same class of
  mixing v1.5's precession fix closed at the mean-of-date level.
  Aberration uses the classical velocity form: Earth's `velocityAuPerDay`
  (already on every body-state, central-difference) displaces the
  apparent direction by v/c (`C_AU_PER_DAY` in `core/units.js`). Note:
  the pre-v1.6 version of this document claimed aberration "would need
  the Sun's true longitude threaded in" — that was wrong; the velocity
  form needs no such plumbing. Observer Mode's output frame is now the
  standard **apparent place** (`TOPOCENTRIC_EQUATORIAL_APPARENT`).
- **Light-time correction (v1.7: modeled).** `getLightTimeCorrectedState`
  (`src/core/ephemeris.js`) evaluates the target not "now" but at the
  retarded epoch its light left, given the distance implied by 2 fixed
  Newton-style iterations (converges to sub-second accuracy for every
  body in this app's range — Moon ~1.3s up to Neptune's ~4 light-hours;
  a 3rd iteration changes nothing measurable). Applied in
  `geocentricEquatorialAu` (Observer Mode's target-position fetch) using
  Earth's heliocentric position as the observer proxy — a distinct effect
  from annual aberration above (light-time corrects for the TARGET's
  motion since it emitted the light; aberration corrects for the
  OBSERVER's motion while receiving it — both apply, neither substitutes
  for the other). Also applied to `analysis/appulse.js` (differential
  light-time between two planets matters for a sub-degree separation
  minimum), `analysis/phase.js`, and `analysis/retrograde.js`'s
  stationary-point epochs. NOT applied to the Sun (fixed at this frame's
  origin — retarding it is a no-op) or the Moon (~1.3s, below both the
  60s solver tolerance and the lunar theory's own ~10″ budget), nor to
  `analysis/opposition.js`/`elongation-events.js` (elongation extrema
  shift by arcseconds, below their solver tolerance) or the lunar-eclipse
  path in `eclipse.js` (same Moon reasoning).
- **Still not modeled** (below this precision tier; add if Observer Mode
  ever claims sub-arcsecond): full IAU 1980 106-term nutation
  (abbreviated series is ~0.5″ worst-case off), date-dependent mean
  obliquity (<0.01″ inside a 17″ rotation), barycentric-vs-heliocentric
  Earth velocity (~0.04″), relativistic light deflection (~0.004″ away
  from the Sun's limb).
- **Rise/transit/set** reuses the exact same `findStationaryPoints`
  coarse-scan-then-bisect solver v0.4/v0.5 already use (10-minute coarse
  sampling across the UTC calendar day, 60-second bisection tolerance) —
  not a closed-form or observatory-grade algorithm. A circumpolar target
  (never sets) or one that never rises above the horizon that UTC day is
  reported via a `note` field, never a fabricated crossing.
- The altitude-curve window is always the **UTC calendar day** (00:00Z-
  24:00Z) containing the entered observation time, not a ±12h window
  centered on it — a local evening near UTC midnight can therefore show
  its rise/set split across two different queries.
- Do not use Observer Mode to plan an actual observation, imaging session,
  or occultation timing — none of the above changed for v1.1. Eclipse
  timing now has its own dedicated feature (see "Eclipses (v1.1)" below)
  with its own, separately documented precision — still not observation-
  planning grade, but real geometry rather than an out-of-scope guess.

## Eclipses (v1.1)

`src/analysis/eclipse.js` adds lunar and solar eclipse detection to the
Event Toolkit, on top of the v1.1 Meeus lunar theory above (a hard
prerequisite — see that section for why the old circular-orbit Moon model
made eclipse detection meaningless). Simplifications, all deliberate:

- **Syzygy (new/full moon) finding** reuses `analysis/opposition.js`'s
  exact "extremum of elongation" technique — the epoch found is the
  moment of maximum/minimum Sun-Moon elongation in the search window, not
  necessarily the exact instant of minimum distance from the shadow axis
  (lunar eclipses) or minimum apparent separation (solar eclipses,
  geocentrically). These differ by up to roughly an hour, since ecliptic
  latitude changes slowly compared to elongation right at syzygy.
- **Solar eclipses ARE re-solved per observer**: after the geocentric
  new-moon time above, `refineLocalSolarEclipseEpoch` finds that specific
  observer's own nearby minimum of topocentric Sun-Moon separation (lunar
  parallax, ~1°, shifts the apparent alignment enough over an hour of
  Earth's rotation to flip total/partial for a narrow eclipse path — this
  refinement is what makes the Dallas-2024-04-08 reference-case test in
  `scripts/smoke-test.js` actually come back "total" rather than
  "partial"). Lunar eclipses are geocentric by nature (visible from the
  whole night-side hemisphere) and don't need this per-observer step.
- **Shadow geometry is a pure vacuum cone** (similar triangles on the real
  Sun/Earth/Moon radii and actual Sun-Earth/Earth-Moon distances) — no
  empirical atmospheric-enlargement factor (real eclipse calendars
  typically add ~1% to Earth's umbra/penumbra radius for this; omitted
  here).
- **Spherical Earth and Moon** (no oblateness, no lunar-limb profile) — no
  atmospheric refraction for the solar-eclipse observer check (same
  caveats Observer Mode already carries).
- **Magnitude + one peak time only** — not the 4/5-contact circumstance
  table (P1/U1/U2/greatest/U3/U4/P4) a real eclipse calendar shows, and no
  path/footprint mapping across Earth's surface (solar eclipses answer
  "what does this one point see," not "where is the path of totality").
- No Besselian elements — this is plain vector/spherical-trig geometry,
  not the precision apparatus real eclipse predictions use for path maps
  down to the kilometer.
- Reference-case tests (`scripts/smoke-test.js`) check against two real
  historical eclipses: the 2022-11-08 total lunar eclipse and the
  2024-04-08 total solar eclipse (verified visible from Dallas, TX; and
  correctly *not* visible from Tokyo, where it was simply night-time at
  the relevant instant — a check robust to any model imprecision, not
  just path distance).

## Surface Mode sky realism (v1.3, extended v1.4)

Everywhere else in the app, `core/scale.js`'s compression curves are
deliberately non-realistic (real relative scale would crush the inner
planets to sub-pixel dots). Surface Mode inherits those same curves for
everything it renders — except the Sun, the current planet's moon(s), and
(as of v1.4) every other planet — which get a **cosmetic-only override**
so "look up from the ground" doesn't feel absurd:

- The compression curves compress *distance* far more aggressively than
  *size* (`compressMoonOrbit`'s `MOON_GAP_POWER=0.4` vs. `compressSize`'s
  `SIZE_POWER=0.45`). Left uncorrected, the Moon's compressed apparent
  angular diameter from Earth's surface would be ≈51° (real: 0.52°) — the
  Sun's ≈14° (real: 0.53°).
- While Surface Mode is active, `app.js#applySurfaceSkyProxies` repositions
  the Sun mesh, the tracked planet's moon mesh(es), and (v1.4) every other
  planet's group onto a fixed-radius sky shell (`SKY_PROXY_DISTANCE`,
  inside the star shell) along the same direction the normal compressed
  scene already computed that frame (`compressPosition`/`compressMoonOrbit`
  preserve direction, only compress magnitude — no new topocentric math
  needed), then scales each so its on-screen angular size matches
  `apparentAngularRadiusRad` computed from its **real** (uncompressed)
  radius and distance.
- **v1.4 — other planets, with a visibility floor.** Every planet's true
  angular radius as seen from another planet's surface is 1-2 orders of
  magnitude smaller than the Moon's (Jupiter at opposition ≈23″, Mars
  typically ≈2″, vs. the Moon's 933″) — at this app's field of view that's
  sub-pixel, so true scale alone would make them flicker or vanish rather
  than just look small. The apparent angular radius is floored at a fixed
  minimum on-screen pixel size (computed from the camera's actual FOV and
  canvas height, so it stays correct on window resize) — a documented
  rendering simplification, not a precision claim. Real relative size
  differences between planets still show through whenever a planet's true
  size exceeds the floor (e.g. Venus near inferior conjunction, Mars near
  opposition).
- The v1.3 Sun override originally read `PLANETS[planet].elements.a`
  (Standish elements: `[valueAtJ2000, ratePerCentury]`, an array) directly
  as if it were a plain number — a bug that made the Sun's Surface Mode
  position/scale silently `NaN`. Fixed in v1.4 by using the real,
  already-computed current heliocentric distance
  (`bodyStates[planet].positionAu`) instead, which is both correct and
  more accurate than the mean semi-major axis it replaced.
- This is purely a rendering-layer overlay: no analysis path (Observer
  Mode, Event Toolkit, Eclipses) reads these overridden mesh transforms —
  they all compute directly from AU-contract positions, unaffected.
- **v1.8.1 — Event Toolkit's line-of-sight line hidden here, a
  screen-space marker used instead.** The line-of-sight visual
  (`render/retrograde-los-line.js`) is drawn between Earth's and the
  target's **compressed** `scenePositions` — a different direction than
  the true-angular-direction proxies this section describes, so it would
  point somewhere unrelated to what's actually rendered while standing in
  Surface Mode (and the observer's camera sits essentially at the line's
  own Earth-endpoint besides). `app.js` hides it in Surface Mode instead
  of drawing something wrong, and shows `render/analysis-target-marker.js`
  — a DOM label projected onto the analyzed planet's actual sky-proxy
  position each frame — so the (often sub-pixel-floored) correct dot is
  identifiable at all.

## Transits (v1.4)

Transit of Mercury or Venus across the Sun's disk, as seen from a specific
observer — the same "occulting disk crosses a larger disk" geometry as a
solar eclipse (`analysis/transit.js` reuses most of `analysis/eclipse.js`'s
solar-eclipse machinery directly), with a planet instead of the Moon as
the occulter.

- Trigger epochs are the target's inferior conjunctions (reusing the
  existing conjunction-finder behind the Inferior/Superior Conjunction
  event type), refined per observer the same way solar eclipses refine to
  a local minimum of apparent separation.
- Classified `transit` (planet's disk fully within the Sun's) or `grazing`
  (partial limb overlap) — `total`/`annular` don't apply, a planet's disk
  is always far smaller than the Sun's.
- **Precision ceiling, worse than eclipses**: Mercury's transit disk is
  only ≈12″ across, a small fraction of the Standish table's own position
  error (of order arcminutes for the inner planets) — good enough to say
  "a transit happens on this date," not to time contacts to the minute.
  Reference-case tests (2019-11-11 Mercury, 2012-06-06 Venus, both real
  historical transits) confirm greatest-transit timing to within a few
  minutes of the published geocentric instant, which is within this
  ceiling, not a claim of higher precision.
- **Venus is constrained to 2004 or 2012** — the next real transit (2117)
  falls outside the Standish table's documented 1800–2050 validity range.
- No atmospheric refraction correction beyond what `observeAt` already
  applies to altitude (used only for the above/below-horizon check, not
  disk geometry), no black-drop-effect modeling, no contact-time table.

## Planetary Appulses (v1.4)

How close two planets get to each other in Earth's sky (`analysis/appulse.js`)
— geocentric, not tied to any one observer's horizon, since this is "how
the sky looks from Earth generally," the same framing as opposition/
conjunction events. Finds every local minimum of angular separation
between the two chosen planets in the date range and reports it — no
"counts as an appulse" threshold, matching how the Inferior/Superior
Conjunction event type already reports every crossing regardless of size.
Reference-case test: the 2020-12-21 Jupiter-Saturn "Great Conjunction"
(closest since 1623), separation reproduced to ≈0.0001° of the real
≈0.1°. **v1.7**: the two planets' positions are now light-time corrected
(`getLightTimeCorrectedState`) — their differential light-time (e.g.
Jupiter vs. Saturn differ by ~0.1 day near opposition) is exactly what a
sub-degree separation minimum is sensitive to, unlike opposition/
conjunction's arcsecond-level elongation shift.

## Lunar Occultations (v1.4)

A planet passing behind the Moon, as seen from a specific observer
(`analysis/occultation.js`) — site-specific like a solar eclipse or
transit, for the same reason (the Moon's ~2° parallax across Earth means
"is it actually covered" is observer-dependent). Scoped to **planets
only, not stars** — a star-occultation table would need new hardcoded
bright-star data with real sourced coordinates, and the existing star
catalog (`core/star-catalog.js`) deliberately keeps no names/IDs (see its
own scope note), so this ships the half that reuses existing planetary
ephemeris with zero new data files.

- Classified `total` (planet fully hidden — the near-always case, since
  every planet's disk is far smaller than the Moon's) or `grazing`
  (partial, near the Moon's limb).
- **Precision ceiling, worse than transits**: the Meeus lunar theory this
  app uses carries roughly ±10″ of its own error, against the Moon's
  ≈0.26° (≈933″) apparent radius — **limb-grazing occultations are
  unresolvable** at this model's precision; only occultations well away
  from the limb are reliable. Reference-case test: the 2021-11-08
  occultation of Venus, visible from Japan — reproduced timing within a
  few minutes of the real ~04:40–05:59 UTC visibility window reported by
  in-the-sky.org.

## Moon Conjunction (v1.7)

The general phenomenon Lunar Occultations above is the special case of:
how close a planet gets to the Moon in the sky, for a specific observer
(`analysis/moon-conjunction.js`). Deliberately **topocentric**, not
geocentric like Planetary Appulse — the Moon's own parallax (~1-2°, per
Lunar Occultations above) is *larger* than many of the separations this
event type reports, so a geocentric Moon-planet "conjunction of 0.3°"
could really be 1.3° or more for an actual observer; Planetary Appulse's
geocentric math would misreport this in a way it doesn't for planet-
planet pairs (whose mutual parallax from Earth is negligible by
comparison). Reuses `analysis/observer.js#observeAt` for both bodies and
`analysis/eclipse.js#angularSeparationDeg` for their separation — no new
position or solver plumbing, same minimum-finding technique as Planetary
Appulse and Lunar Occultation. Every local minimum is reported (no
"counts as a conjunction" threshold), each flagged `wouldOccult: true`
when the two disks actually overlap (i.e. also a Lunar Occultation event
— see that section for full per-observer eclipse-style circumstances).
Reference-case tests: the same 2021-11-08 Moon-Venus occultation Lunar
Occultations tests (confirms `wouldOccult: true` on a known-real
occultation), and the 2022-05-27 Moon-Venus conjunction (in-the-sky.org:
Moon passes 12′/0.2° south of Venus at the geocentric RA-match moment,
visible from Tehran at dawn).

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
- **(v1.4)** The ephemeris HUD now shows a precision hint (years from the
  Kepler elements' J2000 epoch, plus a call-out if the current date is
  outside the Standish table's 1800–2050 range) for Kepler-sourced bodies
  only — Horizons-cache positions and the Sun's exact origin don't carry
  this caveat and stay silent.
