// `tauri build` refuses to bundle a frontendDist that contains a
// `node_modules`/`src-tauri` subfolder (an intentional check — see
// https://github.com/tauri-apps/tauri/issues/13287), so pointing
// frontendDist straight at the repo root (which `tauri dev` is fine with)
// doesn't work for a real build. This copies just the actual web assets —
// nothing else, no transformation — into web-dist/, which the build-only
// config override (src-tauri/tauri.build.conf.json) points frontendDist
// at instead. `tauri dev` is untouched and keeps serving the live source
// tree directly.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'web-dist');
const ENTRIES = ['index.html', 'css', 'src', 'assets'];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir);
for (const entry of ENTRIES) {
  cpSync(join(repoRoot, entry), join(outDir, entry), { recursive: true });
}
console.log(`build-tauri-frontend: copied ${ENTRIES.join(', ')} to ${outDir}`);
