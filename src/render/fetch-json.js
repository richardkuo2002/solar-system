// v1.11.3 risk audit — starfield.js, constellation-lines.js, and
// constellation-labels.js each had a byte-identical `fetchJson` that threw
// on any non-ok response or network error. All three run inside app.js's
// startup `Promise.all([...])` (unlike texture-loader.js's own manifest
// fetch, which already degrades to `{}` on failure) — a throw there was
// an unhandled top-level rejection, so one flaky asset request meant the
// whole app never finished initializing: blank canvas, no fallback.
//
// One shared helper, used by all three, that degrades to a caller-supplied
// fallback instead — same "a missing/broken static asset is a visual
// gap, not a reason to not boot" principle already applied everywhere
// else non-essential data is fetched in this codebase.
export async function fetchJsonOrFallback(path, fallback) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`fetch ${path} failed: HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`fetchJsonOrFallback: ${path} failed, using fallback`, err);
    return fallback;
  }
}
