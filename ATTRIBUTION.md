# Texture Attribution

This project's code is MIT licensed (see `LICENSE`). The third-party planet
and moon textures under `assets/textures/` are **not** MIT — each keeps its
own original license, listed below. `assets/textures/manifest.json` is the
machine-readable source of truth this file is generated from by hand; if
they ever disagree, the manifest is authoritative.

Planetary textures based on Solar System Scope assets, licensed under CC BY
4.0. Modified for web rendering where noted.

## Solar System Scope (CC BY 4.0)

Source: https://www.solarsystemscope.com/textures/ · License:
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · Credit: Solar
System Scope (solarsystemscope.com)

| File | Body | Role | Original URL | Modified |
|---|---|---|---|---|
| `2k_sun.jpg` | Sun | albedo | [2k_sun.jpg](https://www.solarsystemscope.com/textures/download/2k_sun.jpg) | Downloaded as-is; 512px preview generated |
| `2k_mercury.jpg` | Mercury | albedo | [2k_mercury.jpg](https://www.solarsystemscope.com/textures/download/2k_mercury.jpg) | Downloaded as-is; 512px preview generated |
| `2k_venus_surface.jpg` | Venus | albedo | [2k_venus_surface.jpg](https://www.solarsystemscope.com/textures/download/2k_venus_surface.jpg) | Downloaded as-is; 512px preview generated |
| `2k_venus_atmosphere.jpg` | Venus | atmosphere alpha shell | [2k_venus_atmosphere.jpg](https://www.solarsystemscope.com/textures/download/2k_venus_atmosphere.jpg) | Downloaded as-is; 512px preview generated |
| `2k_earth_daymap.jpg` | Earth | albedo (day side) | [2k_earth_daymap.jpg](https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg) | Downloaded as-is; 512px preview generated |
| `2k_earth_nightmap.jpg` | Earth | night-side emissive map | [2k_earth_nightmap.jpg](https://www.solarsystemscope.com/textures/download/2k_earth_nightmap.jpg) | Downloaded as-is; 512px preview generated |
| `2k_earth_clouds.jpg` | Earth | cloud alpha shell | [2k_earth_clouds.jpg](https://www.solarsystemscope.com/textures/download/2k_earth_clouds.jpg) | Downloaded as-is; 512px preview generated |
| `2k_moon.jpg` | Moon | albedo | [2k_moon.jpg](https://www.solarsystemscope.com/textures/download/2k_moon.jpg) | Downloaded as-is; 512px preview generated |
| `2k_mars.jpg` | Mars | albedo | [2k_mars.jpg](https://www.solarsystemscope.com/textures/download/2k_mars.jpg) | Downloaded as-is; 512px preview generated |
| `2k_jupiter.jpg` | Jupiter | albedo | [2k_jupiter.jpg](https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg) | Downloaded as-is; 512px preview generated |
| `2k_saturn.jpg` | Saturn | albedo | [2k_saturn.jpg](https://www.solarsystemscope.com/textures/download/2k_saturn.jpg) | Downloaded as-is; 512px preview generated |
| `2k_saturn_ring_alpha.png` | Saturn | ring alpha map | [2k_saturn_ring_alpha.png](https://www.solarsystemscope.com/textures/download/2k_saturn_ring_alpha.png) | Downloaded as-is; UVs remapped radially in code (no pixel changes); 512px preview generated |
| `2k_uranus.jpg` | Uranus | albedo | [2k_uranus.jpg](https://www.solarsystemscope.com/textures/download/2k_uranus.jpg) | Downloaded as-is; 512px preview generated |
| `2k_neptune.jpg` | Neptune | albedo | [2k_neptune.jpg](https://www.solarsystemscope.com/textures/download/2k_neptune.jpg) | Downloaded as-is; 512px preview generated |
| `8k_stars_milky_way.jpg` | Starfield skybox (Milky Way band only — see below) | skybox | [8k_stars_milky_way.jpg](https://www.solarsystemscope.com/textures/download/8k_stars_milky_way.jpg) | Downloaded as-is (8192x4096, confirmed a real JPEG before switching from the previous 2K version — not a redirect/404 page); 512px preview generated but currently unused, see Payload size below |

## Steve Albers / NOAA "Science On a Sphere" (public domain-style dataset)

Source: https://stevealbers.net/albers/sos/ · License: no CC badge published
by the source (unlike Solar System Scope) — provided as a NOAA Science On a
Sphere dataset, compiled by Steve Albers from public NASA mission imagery,
for education/visualization use. Credit: Steve Albers / NOAA Science On a
Sphere, compiled from NASA source imagery.

| File | Body | Role | Original URL | Modified |
|---|---|---|---|---|
| `io.jpg` | Io | albedo | [io_rgb_cyl.jpg](https://stevealbers.net/albers/sos/jupiter/io/io_rgb_cyl.jpg) | Downloaded as-is; 512px preview generated |
| `europa.png` | Europa | albedo | [europa_rgb_cyl_juno.png](https://stevealbers.net/albers/sos/jupiter/europa/europa_rgb_cyl_juno.png) | Downloaded as-is; 512px preview generated |
| `ganymede.jpg` | Ganymede | albedo | [ganymede_4k.jpg](https://stevealbers.net/albers/sos/jupiter/ganymede/ganymede_4k.jpg) | Downloaded as-is; 512px preview generated |
| `titan.jpg` | Titan | albedo | [titan_rgb_cyl_www.jpg](https://stevealbers.net/albers/sos/saturn/titan/titan_rgb_cyl_www.jpg) | Downloaded as-is; 512px preview generated |
| `triton.jpg` | Triton | albedo | [triton_rgb_cyl_www.jpg](https://stevealbers.net/albers/sos/neptune/triton/triton_rgb_cyl_www.jpg) | Downloaded as-is; 512px preview generated |
| `charon.jpg` | Charon | albedo | [charon_rgb_cyl.jpg](https://stevealbers.net/albers/sos/pluto/charon/charon_rgb_cyl.jpg) | Downloaded as-is; 512px preview generated |

## No real texture available — procedurally generated

These bodies have no stable, appropriately-sized, legally clear photographic
texture available for automated download as of this writing. Rather than
substitute an unlicensed or unverified image, they render a procedural
noise-based surface generated at runtime (`src/render/procedural-textures.js`)
— not attributed to NASA, JPL, or any other agency, since no real imagery is
used.

| Body | Why | URLs attempted |
|---|---|---|
| Pluto | Only known Steve Albers/SOS source is a ~89MB original, well over what a small static site should ship; the smaller `pluto_rgb_cyl.jpg` / `pluto_rgb_cyl_www.jpg` candidates both currently 404 | `pluto/pluto_rgb_cyl.jpg`, `pluto/pluto_rgb_cyl_www.jpg`, `pluto/pluto_rgb_cyl_8k.png` (too large) |
| Callisto | Its Steve Albers/SOS URL currently 404s (may be a temporarily/permanently moved/removed asset on their end) | `jupiter/callisto/callisto_rgb_cyl.jpg` |
| Halley's Comet | Comets don't have a standard, single-surface photographic map the way planets/moons do; this project has never had a texture for it | n/a |

Re-running `node scripts/fetch-textures.mjs` (see `README.md`) will pick
these up automatically the moment a working URL exists, without any other
code changes.

## Real star catalog + constellation lines (v1.2, BSD-3-Clause)

`assets/stars/stars.6.json` and `assets/stars/constellations.lines.json` are
vendored, unmodified, from **d3-celestial** (Olaf Frohn), fetched by
`scripts/fetch-star-catalog.mjs`. `assets/stars/manifest.json` records the
exact source URL for each file, same provenance-file role
`assets/textures/manifest.json` plays for textures.

Source: https://github.com/ofrohn/d3-celestial · License:
[BSD-3-Clause](https://github.com/ofrohn/d3-celestial/blob/master/LICENSE) ·
Credit: Olaf Frohn, d3-celestial

| File | Content | Original URL |
|---|---|---|
| `stars.6.json` | ~5,000 Hipparcos-numbered stars, magnitude ≤ 6.5, RA/Dec + B-V color index | [stars.6.json](https://github.com/ofrohn/d3-celestial/blob/master/data/stars.6.json) |
| `constellations.lines.json` | The 88 IAU constellations' traditional line figures, as RA/Dec coordinate pairs | [constellations.lines.json](https://github.com/ofrohn/d3-celestial/blob/master/data/constellations.lines.json) |
| `constellations.json` | One named anchor point per constellation (name + RA/Dec + a 1-3 brightness/prominence rank) — used only for the name-label overlay (rank-1 constellations, ~22 of the 88) | [constellations.json](https://github.com/ofrohn/d3-celestial/blob/master/data/constellations.json) |

`src/core/star-catalog.js` parses these into scene-frame positions (see its
own header comment for the RA/Dec → ecliptic conversion and the
magnitude/B-V → brightness/color mapping, both original code, not part of
the vendored data) — replacing the old seeded-PRNG procedural star field
with real star positions.

## Starfield background (four layers)

The night sky is four independent layers now, not one stretched photo:

1. **Milky Way sky sphere** (`src/render/scene-setup.js#createMilkyWaySkySphere`)
   — an actual `THREE.Mesh` (unlit `MeshBasicMaterial`, `side: BackSide`,
   `depthWrite: false`), not a `scene.background` texture assignment. Carries
   only `8k_stars_milky_way.jpg` above — the large-scale galactic band and
   dust lanes — dimmed (`material.color` multiplied by 0.55) so it reads as
   a backdrop, not the brightest thing on screen. Repositioned onto the
   camera every frame (position only, never rotated), so it never appears to
   drift during free-flight. Its own orientation is not aligned to the real
   sky — it stays a purely decorative backdrop even though the star points
   and constellation lines above it are now real.
2. **Real star catalog points** (`src/core/star-catalog.js` +
   `src/render/starfield.js`) — a `THREE.Points` layer built from the real
   catalog above (fetched at load time), not a PRNG. See "Real star catalog"
   above for the data source.
3. **Constellation lines** (`src/core/star-catalog.js` +
   `src/render/constellation-lines.js`) — a dim `THREE.LineSegments` overlay
   connecting the catalog's stars into the 88 traditional figures, same data
   source. Deliberately faint (`0x334455`, 18% opacity) after user feedback
   that an earlier, brighter pass read as visual noise mixed in with the
   star points.
4. **Constellation name labels** (`src/core/star-catalog.js` +
   `src/render/constellation-labels.js`) — screen-space DOM text for only
   the ~22 rank-1 (most recognizable) constellations, from `constellations.json`
   above. All 88 were deliberately not labeled — that would trade one kind
   of clutter for another.

Switching the sky sphere from 2K to 8K was a deliberate accuracy-of-source
check, not a blind upgrade: confirmed with a real HTTP request (not assumed)
that `solarsystemscope.com` — the same CC BY 4.0 host every other texture in
this project already comes from — actually serves a real 8192x4096 JPEG at
that URL (not a 404/redirect page) before switching `src/data/textures.js`
and `scripts/fetch-textures.mjs` to it.

## Payload size

Measured directly from file sizes on disk (`stat`/`ls`), not estimated:

| | Bytes | MB |
|---|---:|---:|
| All full-resolution textures (`assets/textures/*.jpg`/`*.png`, 21 files) | 23,718,189 | 23.72 |
| All previews (`assets/textures/preview/*`, 21 files) | 642,396 | 0.64 |

What actually loads on first page view — everything else is deferred until
a body is hovered, focused, or selected (see `src/render/texture-loader.js`
for the lazy-load/LRU logic; unchanged by this pass):

| | Bytes | MB |
|---|---:|---:|
| Starfield skybox (loads full-res directly — see `scene-setup.js`; the only body that skips the preview step, since a background sphere has no "focus" trigger to upgrade later) | 1,905,513 | 1.91 |
| Preview for every other body (20 files — everything except the starfield) | 639,821 | 0.64 |
| Full-resolution, eager: Sun, Earth (day + night + clouds), Moon | 3,560,346 | 3.56 |
| **Total first-load texture payload** | **6,105,680** | **6.11** |

That's ~26% of the full 23.7 MB texture set. Methodology: this is the sum
of the exact files `src/app.js`'s startup path requests (every body's mesh
is built once at scene setup, which calls `textureLoader.getInitial()` and
loads that body's preview; only Sun/Earth/Moon additionally call
`ensureFull()` immediately) — a byte-for-byte figure for what ships, not a
network trace, so it doesn't include HTTP/TLS overhead or `index.html`/
`app.js`/manifest.json themselves.

**This pass's texture-payload cost**: switching the starfield skybox from
2K to 8K adds **+1,654,059 bytes (+1.58 MB)** to first load (251,454 ->
1,905,513) — the single biggest line-item change here, and an explicit,
accepted trade for a visibly sharper Milky Way band.

**v1.2's data payload**: replacing the procedural star field with the real
catalog above adds `assets/stars/stars.6.json` (656,721 bytes, ~656 KB),
`assets/stars/constellations.lines.json` (27,136 bytes, ~26.5 KB), and
`assets/stars/constellations.json` (50,581 bytes, ~49.4 KB, for the name
labels) — all three fetched once at load time alongside the texture
manifest, ~734 KB total, where the old PRNG-generated star field cost zero
additional bytes (no data file at all, generated at runtime from a fixed
seed). Judged an acceptable trade for real, recognizable star positions
over synthetic ones.
