// Encode/decode shareable app state (simulated date + camera mode/focus/
// surface lat-lon) to/from URL query params. Pure — no DOM/THREE. Scope is
// deliberately narrow (v0.8): NOT included — playback speed/direction/
// paused, free-flight position/yaw/pitch, Event Toolkit or Observer Mode
// inputs (see docs/ROADMAP.md's v0.8 section for why).

import { CAMERA_MODES } from './camera-modes.js';

// v1.11.3 risk audit — bounds the `date` param to plain 4-digit-year
// ISO dates (0001-9999). Two independent problems this closes:
// 1. `encodeAppStateToParams`'s `.toISOString().slice(0, 10)` assumes a
//    4-digit year; an expanded-year ISO string (year <0 or >9999) gets
//    truncated to the wrong instant on decode instead of round-tripping.
// 2. A hand-edited URL with an extreme date (e.g. year 275760, near JS
//    Date's actual representable limit) used to decode successfully and
//    reach the simulated clock unclamped — `tick()` advancing it further
//    could overflow into `Invalid Date`, and `Invalid Date.toISOString()`
//    throws `RangeError` the next time syncUrl() re-encodes it, inside
//    the unguarded animation loop. Nowhere near a real use case: this
//    app's own accuracy already degrades far outside 1800-2050 (see
//    docs/accuracy.md), so 1-9999 is already generous, not restrictive.
const MIN_DATE_YEAR = 1;
const MAX_DATE_YEAR = 9999;

function isEncodableDate(date) {
  return date instanceof Date
    && !Number.isNaN(date.getTime())
    && date.getUTCFullYear() >= MIN_DATE_YEAR
    && date.getUTCFullYear() <= MAX_DATE_YEAR;
}

/**
 * @param {{currentDate: Date, cameraState: object}} state
 * @returns {URLSearchParams}
 */
export function encodeAppStateToParams({ currentDate, cameraState }) {
  const params = new URLSearchParams();
  // Out-of-range/invalid dates just omit the param (matching this
  // module's own "degrade, never throw" contract, see decodeAppStateFromParams's
  // docstring) rather than letting toISOString() throw out of the caller's
  // per-frame syncUrl() call.
  if (isEncodableDate(currentDate)) {
    params.set('date', currentDate.toISOString().slice(0, 10));
  }
  params.set('mode', cameraState.mode);
  if (cameraState.mode === CAMERA_MODES.GEOCENTRIC) {
    params.set('focus', cameraState.geocentric.focusBody);
  } else if (cameraState.mode === CAMERA_MODES.HELIOCENTRIC_TOPDOWN) {
    params.set('focus', cameraState.focusBody);
  } else if (cameraState.mode === CAMERA_MODES.SURFACE_FIRST_PERSON) {
    params.set('planet', cameraState.surface.planet);
    // Rounded to 2 decimals (~1km) — keeps the URL short and lets
    // app.js's syncUrl skip history.replaceState on most animation
    // frames while WASD-walking (only the rounded value needs to change).
    // v1.11.3 — the decode side already rejects a non-finite lat/lon
    // (below), but the encode side had no matching guard, so a non-finite
    // surface.lat/lon (not currently reachable in practice — moveSurface's
    // own clamp makes it unlikely — but not provably impossible) would
    // write a literal `lat=NaN`/`lon=NaN` into the visible, shareable URL.
    if (Number.isFinite(cameraState.surface.lat) && Number.isFinite(cameraState.surface.lon)) {
      params.set('lat', String(Math.round(cameraState.surface.lat * 100) / 100));
      params.set('lon', String(Math.round(cameraState.surface.lon * 100) / 100));
    }
  }
  return params;
}

/**
 * Parses URLSearchParams into a plain object of *candidate* overrides.
 * Format/range validation only — this module doesn't know which body keys
 * exist in a given app instance, so `focus`/`planet` come back as opaque
 * strings for the caller to validate against its own data tables. Anything
 * malformed, out of range, or missing is simply omitted (never thrown) — a
 * hand-edited or stale URL must degrade to defaults, not crash the app.
 *
 * @param {URLSearchParams} params
 * @returns {{date?: Date, mode?: string, focus?: string, planet?: string, lat?: number, lon?: number}}
 */
export function decodeAppStateFromParams(params) {
  const out = {};

  const dateStr = params.get('date');
  if (dateStr) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    if (isEncodableDate(d)) out.date = d;
  }

  const mode = params.get('mode');
  if (mode && Object.values(CAMERA_MODES).includes(mode)) out.mode = mode;

  const focus = params.get('focus');
  if (focus) out.focus = focus;

  const planet = params.get('planet');
  if (planet) out.planet = planet;

  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
    out.lat = lat;
    out.lon = lon;
  }

  return out;
}
