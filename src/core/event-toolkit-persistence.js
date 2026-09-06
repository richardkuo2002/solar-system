// Event Toolkit per-event-type input persistence (v1.9) — revisits v0.8's
// decision to keep Event Toolkit inputs out of persistence entirely. That
// decision was scoped to the shareable-link URL (deliberately minimal, see
// url-state.js and docs/ROADMAP.md's v0.8 section) and still stands
// unchanged; this is a separate, narrower feature: remembering each event
// type's last-used field values across reloads via localStorage, keyed per
// event type, so switching types (or reloading the page) doesn't lose a
// carefully-set date range or observer location.
//
// `applySavedDefaults` is pure and Node-testable — the actual localStorage
// access (`loadSaved`/`saveValues`) is a thin, separately-untested wrapper,
// same split as url-state.js keeps between its pure encode/decode and
// app.js's DOM-facing history.replaceState call.

/**
 * Returns a new `fields` array (same shape as EVENT_TYPES[].fields) with
 * each field's `default` overridden by `saved[field.key]` when present AND
 * valid for that field's type — never trusts stored data blindly, since
 * it could be corrupted or from an older app version with different
 * options/ranges.
 *
 * @param {Array<{key:string, type:'date'|'number'|'select', default?:*, min?:number, max?:number, options?:{value:string}[]}>} fields
 * @param {Record<string, *>} saved
 */
export function applySavedDefaults(fields, saved) {
  if (!saved) return fields;
  return fields.map((field) => {
    if (!(field.key in saved)) return field;
    const value = saved[field.key];

    if (field.type === 'select') {
      const isValidOption = field.options.some((opt) => opt.value === value);
      return isValidOption ? { ...field, default: value } : field;
    }
    if (field.type === 'number') {
      const parsed = typeof value === 'number' ? value : parseFloat(value);
      if (!Number.isFinite(parsed)) return field;
      let clamped = parsed;
      if (field.min != null) clamped = Math.max(clamped, field.min);
      if (field.max != null) clamped = Math.min(clamped, field.max);
      return { ...field, default: clamped };
    }
    if (field.type === 'date') {
      return typeof value === 'string' && value.length > 0 ? { ...field, default: value } : field;
    }
    return field;
  });
}

/** Reads and JSON-parses `localStorage[storageKey]`; `null` on any failure
 *  (missing key, disabled/private-browsing storage, corrupted JSON) —
 *  never throws. */
export function loadSaved(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Writes `values` (plain field-key -> value object) to
 *  `localStorage[storageKey]`; silently no-ops on failure. */
export function saveValues(storageKey, values) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(values));
  } catch {
    // ignore — private browsing / disabled storage / quota
  }
}
