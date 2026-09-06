# Contributing

Thanks for considering a contribution. This project has a small,
deliberate scope — please read this before opening a PR, especially the
"Scope" section below.

## Running it locally

No build step, no bundler. Serve the directory and open it (`file://`
won't work — ES modules need a real origin):

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`.

## Before opening a PR

```bash
npm install
npm run lint   # ESLint, recommended ruleset — must be clean
npm test       # scripts/smoke-test.js, Node's built-in assert — must pass
```

Both also run automatically on every push/PR via GitHub Actions
(`.github/workflows/ci.yml`) — a red CI run will block review.

## Code conventions

- **Zero build, native ES modules.** No bundler, no framework, no
  TypeScript. Keep it that way unless there's a very strong reason not to.
- **`src/core/` has no DOM or THREE.js dependency.** It's pure logic
  (orbital mechanics, scale curves, time control, camera pose math) and
  must stay Node-testable via `scripts/smoke-test.js`. `src/render/` is
  where THREE.js/DOM code belongs.
- **Unit-bearing names.** Variables carry their unit in the name
  (`distanceAu`, `angleRad`, `velocityAuPerDay`, `timeJd`, `timeUtc`).
  Avoid bare names like `x`/`time`/`angle`/`speed`/`position` outside a
  tiny, obviously-local scope.
- **Coordinate provenance is explicit.** Any public function, state
  object, or event result that carries a position/angle must make its
  `center` (e.g. Sun/Earth/observer), `frame` (e.g. ECLIPJ2000), `epoch`,
  unit, and data `source` identifiable — never assume the reader knows
  it's Sun-centered/J2000/AU/UTC by default.
- **New analysis features need**: a unit test, at least one reference
  case (a real, independently-checkable value — not hand-invented), and a
  note on method/limitations in `docs/accuracy.md`. See that file for the
  existing pattern (e.g. the Mars Kepler-vs-Horizons error check).
- **Unit testing is a standing requirement, not a one-time analysis-
  features rule (v1.8.5).** Before closing out *any* version — patch or
  minor — check whether it added or changed pure logic with no test
  covering it, not just new analysis math. Three versions in a row
  (v1.8.1–v1.8.3) shipped pure, Node-testable decisions — a camera-mode
  visibility rule, a speed-dropdown default — with zero assertions behind
  them, and nothing caught it until an explicit audit. If the logic is
  DOM/THREE-coupled (most of `src/render/`, `src/app.js`), first ask
  whether the actual decision inside it can be pulled out into a plain
  function in `src/core/` (see `core/camera-modes.js#analysisVisualState`,
  extracted from `app.js`'s `animate()` for exactly this reason) — most
  "UI logic" is a DOM shell around a testable decision, not DOM through
  and through. Only genuinely-DOM work (layout, event wiring) is exempt,
  and that exemption isn't a reason to leave the decision it's wrapped
  around untested too.
- **No unverified accuracy claims.** Don't describe something as
  "scientifically accurate" or "real-time accurate" in code comments,
  READMEs, or UI text unless a reproducible test actually backs it up.
- **Don't add a new dependency for what a few lines of stdlib/existing
  code can already do.** This project's dependency list is intentionally
  short.

## Versioning

Roughly semver, applied to this project's actual history:

- **Patch (1.8 → 1.8.1)** — bug fixes, layout/overlap fixes, correcting
  something that was already supposed to work. No new analysis event
  type, no new interaction, no accuracy-model change.
- **Minor (1.8 → 1.9)** — new capability (event type, camera mode, data
  source) or a behavior change users need to relearn (e.g. v1.8's
  scrub-locks-the-whole-scene, or a default speed change), or an
  accuracy/precision upgrade (e.g. light-time correction, nutation).
- **Major** — not used yet; reserved for an actual breaking change.

When in doubt: if it only makes something that was wrong now correct,
patch; if it adds or changes what the app can do, minor.

**Pushing a `v*` tag auto-creates a GitHub Release (v1.8.7)** —
`.github/workflows/release.yml` runs `scripts/changelog-excerpt.mjs` to
pull that version's section out of `CHANGELOG.md` verbatim as the
Release's notes. Write the CHANGELOG.md entry *before* tagging (already
established practice) — the Release will fail to generate (missing
section) or say the wrong thing otherwise.

## Assets

Textures under `assets/textures/` come from `scripts/fetch-textures.mjs`
(`npm run fetch-textures`), not hand-committed files — see
[ATTRIBUTION.md](ATTRIBUTION.md) for sourcing/license requirements before
adding a new one. Every asset needs a traceable source and an explicit
license; don't add an unlicensed or unattributed texture from a random
search result.

## Scope

See the README's feature list and [docs/accuracy.md](docs/accuracy.md)
for what this project already does and its known modeling limitations.
Before proposing a large new feature (a new celestial body category, a new
input scheme, a new data source), consider opening an issue first to
discuss the approach — this avoids a large PR built on an assumption that
doesn't fit the project's direction.

## License

By contributing, you agree your contribution is licensed under this
project's [MIT license](LICENSE). Third-party assets keep their own
original licenses (see [ATTRIBUTION.md](ATTRIBUTION.md)) — don't submit
textures/assets you don't have clear rights/license to redistribute.
