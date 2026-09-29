// Display-only series densification (v1.13) — a short analysis window
// (e.g. a 1-day retrograde/opposition/elongation scan) inherits its
// solver's coarse intervalHours grid as its ONLY scrub-bar resolution
// (see src/render/lab-panel.js: scrub.max = series.timesJd.length - 1),
// since intervalHours defaults are tuned for solver bracketing over each
// event type's default multi-month window, never for chart smoothness.
// This resamples a dense-scan series to at least `minPoints` for display,
// leaving the solver's own series (and the result it derived) untouched —
// callers pass this only to the chart/scrub plumbing, never back into
// analysis. Deliberately NOT applied to sparse "one point per candidate
// event" series (eclipses, transits, occultations, best-night) — see
// event-toolkit-panel.js's `densifyDisplay` flag comment.

function linterp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i += 1) {
    if (xs[i] >= x) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

/**
 * Resamples `series.timesJd` (and every other same-length array field
 * alongside it) to `minPoints` evenly-spaced points via linear
 * interpolation. A no-op (returns `series` as-is) when it already has
 * `minPoints` or more, or fewer than 2 points to interpolate between.
 */
export function densifySeries(series, minPoints = 96) {
  const { timesJd } = series;
  if (!timesJd || timesJd.length >= minPoints || timesJd.length < 2) return series;

  const t0 = timesJd[0];
  const t1 = timesJd[timesJd.length - 1];
  const newTimesJd = Array.from({ length: minPoints }, (_, i) => t0 + ((t1 - t0) * i) / (minPoints - 1));

  const out = { ...series, timesJd: newTimesJd };
  for (const key of Object.keys(series)) {
    if (key === 'timesJd') continue;
    const arr = series[key];
    if (!Array.isArray(arr) || arr.length !== timesJd.length) continue; // skip non-parallel fields
    out[key] = newTimesJd.map((jd) => linterp(timesJd, arr, jd));
  }
  return out;
}
