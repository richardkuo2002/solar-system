// Downloads real, licensed planet/moon textures and writes
// assets/textures/manifest.json — the single source of truth for what each
// file is, where it came from, and under what license (src/data/textures.js
// stays a plain textureKey->filename lookup; it does not duplicate any of
// this). Safe to re-run: skips files that already exist and pass the size
// sanity check. Never aborts the whole run for one failed body — logs which
// body, which URL(s), and the HTTP status, then moves on.
//
// Two sources, each tried in order per target until one works:
//   SSS = solarsystemscope.com (CC BY 4.0)
//   SA  = stevealbers.net/albers/sos/ (NOAA "Science On a Sphere" cylindrical
//         maps compiled by Steve Albers from public NASA imagery — public
//         domain-style dataset, not CC-badged the way SSS is)
// Neither host sends Access-Control-Allow-Origin, so these can't be
// hotlinked into a WebGL texture — they must be downloaded here and
// self-hosted, same reasoning already documented in data/textures.js.
//
// Every successfully downloaded file also gets a 512px-wide preview (same
// format) written to assets/textures/preview/, via sharp, for the lazy
// texture loader to show instantly while the full file streams in. A body
// with no working candidate URL gets neither file — src/render/procedural-
// textures.js covers it at runtime instead; this script never substitutes
// an unlicensed image.

import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'textures');
const PREVIEW_OUT = join(OUT, 'preview');
mkdirSync(OUT, { recursive: true });
mkdirSync(PREVIEW_OUT, { recursive: true });

const SSS = 'https://www.solarsystemscope.com/textures/download/';
const SA = 'https://stevealbers.net/albers/sos/';
const MAX_BYTES = 10 * 1024 * 1024; // small hobby site — reject e.g. Pluto's 89MB SOS original

const SSS_LICENSE = {
  source: 'Solar System Scope',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  credit: 'Solar System Scope (solarsystemscope.com)',
};
const SA_LICENSE = {
  source: 'Steve Albers / NOAA Science On a Sphere',
  license: 'Public domain (NOAA SOS dataset, compiled from NASA source imagery)',
  licenseUrl: 'https://stevealbers.net/albers/sos/',
  credit: 'Steve Albers / NOAA Science On a Sphere, compiled from NASA source imagery',
};

// filename -> { body, role, candidates: [url,...], ...license fields }
// SSS-sourced filenames keep the "2k_" prefix SSS itself uses (and this
// project already had committed before this script existed) — not a new
// convention, just staying consistent with the 12 files already on disk.
const TARGETS = {
  '2k_sun.jpg': { body: 'sun', role: 'albedo', candidates: [SSS + '2k_sun.jpg'], ...SSS_LICENSE },
  '2k_mercury.jpg': { body: 'mercury', role: 'albedo', candidates: [SSS + '2k_mercury.jpg'], ...SSS_LICENSE },
  '2k_venus_surface.jpg': { body: 'venus', role: 'albedo', candidates: [SSS + '2k_venus_surface.jpg'], ...SSS_LICENSE },
  '2k_venus_atmosphere.jpg': { body: 'venus', role: 'atmosphere-alpha', candidates: [SSS + '2k_venus_atmosphere.jpg'], ...SSS_LICENSE },
  '2k_earth_daymap.jpg': { body: 'earth', role: 'albedo', candidates: [SSS + '2k_earth_daymap.jpg'], ...SSS_LICENSE },
  '2k_earth_nightmap.jpg': { body: 'earth', role: 'night-emissive', candidates: [SSS + '2k_earth_nightmap.jpg'], ...SSS_LICENSE },
  '2k_earth_clouds.jpg': { body: 'earth', role: 'clouds-alpha', candidates: [SSS + '2k_earth_clouds.jpg'], ...SSS_LICENSE },
  '2k_moon.jpg': { body: 'moon', role: 'albedo', candidates: [SSS + '2k_moon.jpg'], ...SSS_LICENSE },
  '2k_mars.jpg': { body: 'mars', role: 'albedo', candidates: [SSS + '2k_mars.jpg'], ...SSS_LICENSE },
  '2k_jupiter.jpg': { body: 'jupiter', role: 'albedo', candidates: [SSS + '2k_jupiter.jpg'], ...SSS_LICENSE },
  '2k_saturn.jpg': { body: 'saturn', role: 'albedo', candidates: [SSS + '2k_saturn.jpg'], ...SSS_LICENSE },
  '2k_saturn_ring_alpha.png': { body: 'saturn', role: 'ring-alpha', candidates: [SSS + '2k_saturn_ring_alpha.png'], ...SSS_LICENSE },
  '2k_uranus.jpg': { body: 'uranus', role: 'albedo', candidates: [SSS + '2k_uranus.jpg'], ...SSS_LICENSE },
  '2k_neptune.jpg': { body: 'neptune', role: 'albedo', candidates: [SSS + '2k_neptune.jpg'], ...SSS_LICENSE },
  '2k_stars_milky_way.jpg': { body: 'starfield', role: 'skybox', candidates: [SSS + '2k_stars_milky_way.jpg'], ...SSS_LICENSE },
  'io.jpg': { body: 'io', role: 'albedo', candidates: [SA + 'jupiter/io/io_rgb_cyl.jpg'], ...SA_LICENSE },
  'europa.png': { body: 'europa', role: 'albedo', candidates: [SA + 'jupiter/europa/europa_rgb_cyl_juno.png', SA + 'jupiter/europa/europa_rgb_cyl.jpg'], ...SA_LICENSE },
  'ganymede.jpg': { body: 'ganymede', role: 'albedo', candidates: [SA + 'jupiter/ganymede/ganymede_4k.jpg', SA + 'jupiter/ganymede/ganymede_rgb_cyl.jpg'], ...SA_LICENSE },
  'callisto.jpg': { body: 'callisto', role: 'albedo', candidates: [SA + 'jupiter/callisto/callisto_rgb_cyl.jpg'], ...SA_LICENSE },
  'titan.jpg': { body: 'titan', role: 'albedo', candidates: [SA + 'saturn/titan/titan_rgb_cyl.jpg', SA + 'saturn/titan/titan_rgb_cyl_www.jpg'], ...SA_LICENSE },
  'triton.jpg': { body: 'triton', role: 'albedo', candidates: [SA + 'neptune/triton/triton_rgb_cyl.jpg', SA + 'neptune/triton/triton_rgb_cyl_www.jpg'], ...SA_LICENSE },
  'charon.jpg': { body: 'charon', role: 'albedo', candidates: [SA + 'pluto/charon/charon_rgb_cyl.jpg'], ...SA_LICENSE },
  'pluto.jpg': { body: 'pluto', role: 'albedo', candidates: [SA + 'pluto/pluto_rgb_cyl.jpg', SA + 'pluto/pluto_rgb_cyl_www.jpg'], ...SA_LICENSE },
  // no <10MB candidate is currently known for Pluto (only a ~89MB original
  // exists) — left in with its low-res candidates in case those come back;
  // if all fail, Pluto renders via the procedural fallback instead.
};

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'solar-system-fetch-textures/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`too large (${(buf.length / 1e6).toFixed(1)}MB > ${MAX_BYTES / 1e6}MB cap)`);
  if (buf.length < 10000) throw new Error(`suspiciously small (${buf.length}B, probably an error page)`);
  const head = buf.subarray(0, 4).toString('hex');
  if (!head.startsWith('ffd8') && !head.startsWith('89504e47')) throw new Error('not a JPEG/PNG (unexpected content)');
  writeFileSync(dest, buf);
  return buf.length;
}

async function writePreview(dest, previewDest) {
  await sharp(dest).resize({ width: 512 }).toFile(previewDest);
}

const manifestPath = join(OUT, 'manifest.json');
const previousManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

const manifest = {};
let ok = 0;
const total = Object.keys(TARGETS).length;

for (const [file, target] of Object.entries(TARGETS)) {
  const { body, role, candidates, ...license } = target;
  const dest = join(OUT, file);
  const previewDest = join(PREVIEW_OUT, file);

  if (existsSync(dest) && statSync(dest).size > 10000) {
    console.log(`⏭  ${file} already present, skipping`);
    if (!existsSync(previewDest)) await writePreview(dest, previewDest).catch(() => {});
    manifest[file] = {
      body, role, sourceUrl: previousManifest[file]?.sourceUrl ?? candidates[0], ...license,
      modified: 'Downloaded via scripts/fetch-textures.mjs; 512px preview generated with sharp.',
    };
    ok++;
    continue;
  }

  let succeededUrl = null;
  for (const url of candidates) {
    try {
      const size = await download(url, dest);
      console.log(`✅ ${file}  ${(size / 1e6).toFixed(1)}MB  ← ${url}`);
      succeededUrl = url;
      break;
    } catch (e) {
      console.log(`   ✗ ${body}: ${url} — ${e.message}`);
    }
  }

  if (succeededUrl) {
    await writePreview(dest, previewDest).catch((e) => console.log(`   ⚠ preview generation failed for ${file}: ${e.message}`));
    manifest[file] = {
      body, role, sourceUrl: succeededUrl, ...license,
      modified: 'Downloaded via scripts/fetch-textures.mjs; 512px preview generated with sharp.',
    };
    ok++;
  } else {
    console.log(`⚠️  ${body} (${file}): all candidate URLs failed — falling back to procedural texture, no file written`);
  }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nDone: ${ok}/${total} textures ready, manifest.json written.`);
