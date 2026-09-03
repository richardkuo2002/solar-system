// Environment detection. Guards `navigator` so this stays safe to import
// from Node (used by core/ephemeris.js, which needs to be Node-testable) —
// note that modern Node (21+) *does* define a global `navigator`, just
// without `onLine`, so checking `typeof navigator === 'undefined'` alone
// isn't enough; also verify `.onLine` is actually a boolean, or this
// silently returns `undefined` instead of a real online/offline guess.

export function isOnlineHint() {
  return typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
    ? navigator.onLine
    : true;
}

// Flip to false to force local-only Kepler math and skip Horizons entirely.
export const HORIZONS_ENABLED = true;
