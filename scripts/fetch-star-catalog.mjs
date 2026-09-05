// Downloads the real star catalog + constellation-line data used to
// replace the procedural starfield (see docs/ROADMAP.md v1.2 closeout).
// Writes assets/stars/manifest.json — the single source of truth for
// where this data came from and under what license, same role
// assets/textures/manifest.json plays for textures (src/core/star-catalog.js
// does not duplicate any of this).
//
// Source: ofrohn/d3-celestial (BSD-3-Clause) — stars.6.json (~9096 stars,
// Hipparcos-numbered, mag<=6.5), constellations.lines.json (88
// constellations' traditional line figures, stored as literal [lon,lat]
// coordinate pairs — no cross-catalog ID join needed), and
// constellations.json (one named point per constellation, used for the
// v1.2.1 name-label overlay).
//
// Safe to re-run: skips files already on disk unless --force is passed.
//
// Usage: node scripts/fetch-star-catalog.mjs [--force]

import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORCE = process.argv.includes('--force');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'stars');
mkdirSync(OUT, { recursive: true });

const BASE = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/';
const LICENSE = {
  source: 'd3-celestial (ofrohn)',
  license: 'BSD-3-Clause',
  licenseUrl: 'https://github.com/ofrohn/d3-celestial/blob/master/LICENSE',
  credit: 'Olaf Frohn, d3-celestial (https://github.com/ofrohn/d3-celestial)',
};

const TARGETS = {
  'stars.6.json': BASE + 'stars.6.json',
  'constellations.lines.json': BASE + 'constellations.lines.json',
  'constellations.json': BASE + 'constellations.json',
};

const MAX_BYTES = 5 * 1024 * 1024; // both files are ~1-2MB; reject anything wildly off

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'solar-system-fetch-star-catalog/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const buf = Buffer.from(text, 'utf8');
  if (buf.length > MAX_BYTES) throw new Error(`too large (${(buf.length / 1e6).toFixed(1)}MB > ${MAX_BYTES / 1e6}MB cap)`);
  if (buf.length < 1000) throw new Error(`suspiciously small (${buf.length}B, probably an error page)`);
  JSON.parse(text); // throws if not valid JSON — fail loudly, don't write garbage
  writeFileSync(dest, text);
  return buf.length;
}

const manifest = {};
let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const [file, url] of Object.entries(TARGETS)) {
  const dest = join(OUT, file);
  if (!FORCE && existsSync(dest) && statSync(dest).size > 1000) {
    console.log(`[SKIP] ${file} (already on disk)`);
    manifest[file] = { sourceUrl: url, ...LICENSE };
    skipped++;
    continue;
  }
  try {
    const size = await download(url, dest);
    console.log(`[OK ${(size / 1e6).toFixed(2)}MB] ${file} <- ${url}`);
    manifest[file] = { sourceUrl: url, ...LICENSE };
    downloaded++;
  } catch (e) {
    console.log(`[FAIL (${e.message})] ${file} <- ${url}`);
    failed++;
  }
}

if (Object.keys(manifest).length > 0) {
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
console.log(`\nDone: downloaded=${downloaded} skipped=${skipped} failed=${failed} total=${Object.keys(TARGETS).length}. manifest.json written.`);
