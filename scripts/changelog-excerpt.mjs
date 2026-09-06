#!/usr/bin/env node
// v1.8.7 — extracts one version's section from CHANGELOG.md, verbatim, for
// .github/workflows/release.yml to use as a GitHub Release body. Every
// version already gets a hand-written CHANGELOG.md entry (established
// practice since v1.0.0); this just reuses it as the Release notes instead
// of leaving Releases unmaintained (only v1.0.0 had one — v1.1-v1.8.6 were
// tags only) or auto-generating a second, different summary.
//
// The parsing itself (extractChangelogSection) is exported and pure — no
// fs/process access — so scripts/smoke-test.js can exercise it directly,
// same as any other pure logic in this project, rather than this being an
// untested CLI script like fetch-textures.mjs/fetch-star-catalog.mjs
// (which stay untested because they do real network I/O, not because
// scripts/ is exempt from testing).
import { readFileSync } from 'node:fs';

/**
 * @param {string} changelogText  full contents of CHANGELOG.md
 * @param {string} version        e.g. "v1.8.6"
 * @returns {string}              that version's section, trimmed
 * @throws {Error} if no "## <version> " heading exists
 */
export function extractChangelogSection(changelogText, version) {
  const lines = changelogText.split('\n');
  const headingPrefix = `## ${version} `; // CHANGELOG.md's own heading style, e.g. "## v1.8.6 — 2026-09-06"
  const startIdx = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (startIdx === -1) {
    throw new Error(`No CHANGELOG.md section found for ${version} (expected a line starting with "${headingPrefix}")`);
  }
  const nextHeadingIdx = lines.findIndex((line, i) => i > startIdx && line.startsWith('## '));
  const endIdx = nextHeadingIdx === -1 ? lines.length : nextHeadingIdx;
  return lines.slice(startIdx + 1, endIdx).join('\n').trim();
}

// CLI entry point — only runs when this file is executed directly (not
// when smoke-test.js imports extractChangelogSection above).
if (import.meta.url === `file://${process.argv[1]}`) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/changelog-excerpt.mjs <version>  (e.g. v1.8.6)');
    process.exit(1);
  }
  try {
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
    console.log(extractChangelogSection(changelog, version));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
