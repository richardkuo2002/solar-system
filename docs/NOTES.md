# Design notes

## Orbital elements

Standish (1992) / JPL "Keplerian Elements for Approximate Positions of the
Planets" low-precision table, valid ~1800-2050 AD. Values + per-century
rates hardcoded in `src/data/planets.js`.

## Textures

2k textures from https://www.solarsystemscope.com/textures/ (CC Attribution
4.0 International — attribute solarsystemscope.com if this ships publicly).
Self-hosted under `assets/textures/` rather than hotlinked: their server
sends no `Access-Control-Allow-Origin` header, so loading them cross-origin
into a WebGL texture throws a `SecurityError` (texImage2D requires a
CORS-cleared response for cross-origin sources). Confirmed via `curl` — the
files themselves are real JPEGs (200, correct bytes), it's specifically a
browser-enforced CORS restriction, invisible to a non-browser client like
curl, which is why this wasn't obvious until checking response headers.

No free texture set was found for the Galilean moons (solarsystemscope.com
covers the Sun, 8 planets, and Earth's Moon only) — Io/Europa/Ganymede/
Callisto render as flat colors in v1.

## Horizons API quirks

(To be filled in during step 7 — JPL Horizons integration.)
