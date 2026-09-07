// `tauri build` refuses to bundle a frontendDist that contains a
// `node_modules`/`src-tauri` subfolder (an intentional check — see
// https://github.com/tauri-apps/tauri/issues/13287), so pointing
// frontendDist straight at the repo root (which `tauri dev` is fine with)
// doesn't work for a real build. This copies just the actual web assets —
// nothing else, no transformation — into web-dist/, which the build-only
// config override (src-tauri/tauri.build.conf.json) points frontendDist
// at instead. `tauri dev` is untouched and keeps serving the live source
// tree directly.
//
// v1.11.3 risk audit — this does mean `tauri dev`'s frontendDist ("../")
// exposes the whole repo root (.git/, node_modules/, src-tauri/target/,
// package-lock.json) to the webview, unlike the scoped build output above.
// Deliberately left as-is: there's no injection/XSS path in this app that
// could navigate the webview to those paths, so this is a defense-in-depth
// gap with no demonstrated attacker, only reachable during local dev — and
// pointing dev at web-dist/ too would cost the live-source-edit-and-reload
// workflow this script exists to preserve, for a hardening benefit with no
// real exploit scenario behind it.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'web-dist');
// v1.11.3 risk audit — ATTRIBUTION.md was missing entirely, so the Tauri
// bundle's attribution-footer.js link 404'd — a real problem given the CC
// BY 4.0 textures it exists to credit. (v1.12.1 reverted that same
// audit's importmap.json split — external import maps aren't supported by
// any browser — so it's back to being part of index.html, not a separate
// entry here.)
const ENTRIES = ['index.html', 'css', 'src', 'assets', 'ATTRIBUTION.md'];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir);
for (const entry of ENTRIES) {
  cpSync(join(repoRoot, entry), join(outDir, entry), { recursive: true });
}
console.log(`build-tauri-frontend: copied ${ENTRIES.join(', ')} to ${outDir}`);
