// i18n engine (v1.12) — the whole UI was 100% hardcoded English with zero
// language infrastructure until now. Deliberately NOT a reactive/live
// system: this codebase has no "state changes, DOM re-renders" pattern
// anywhere (every panel is built once via document.createElement and
// mutated imperatively afterward) — building one just for this would be a
// new architecture for a language toggle. Instead: save the choice, reload
// the page. `app.js` reads the saved language once at startup, so every
// `t()` call resolves correctly from the first paint.
//
// `loadSaved`/`saveValues` are event-toolkit-persistence.js's existing
// generic localStorage helpers (try/catch-wrapped, never throw) — reused
// as-is rather than duplicated, despite the filename.
import { loadSaved, saveValues } from './event-toolkit-persistence.js';
import { en } from '../i18n/en.js';
import { zhTw } from '../i18n/zh-tw.js';

const DICTIONARIES = { en, 'zh-TW': zhTw };
export const LANGUAGES = ['en', 'zh-TW'];

const LANGUAGE_KEY = 'settings:language';
const VOLUME_KEY = 'settings:volume';

let currentLanguage = LANGUAGES.includes(loadSaved(LANGUAGE_KEY)) ? loadSaved(LANGUAGE_KEY) : 'en';

export function getLanguage() {
  return currentLanguage;
}

/** Persists the choice; does NOT re-render anything — caller must reload (see settings-panel.js). */
export function setLanguage(lang) {
  currentLanguage = LANGUAGES.includes(lang) ? lang : 'en';
  saveValues(LANGUAGE_KEY, currentLanguage);
}

/**
 * Looks up `key` in the current language dictionary, falling back to
 * English, then to the bare key itself (so a missed translation is
 * visibly obvious in the UI rather than silently blank).
 * `vars`, if given, replaces `{name}`-style placeholders in the result.
 */
export function t(key, vars) {
  let str = DICTIONARIES[currentLanguage]?.[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

// Volume: pure persistence, no audio system exists yet to apply it to —
// a future music/sound feature reads this at startup instead of adding
// its own storage key.
const DEFAULT_VOLUME = 50;

export function getVolume() {
  const saved = loadSaved(VOLUME_KEY);
  return typeof saved === 'number' && Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) : DEFAULT_VOLUME;
}

export function setVolume(volume) {
  saveValues(VOLUME_KEY, Math.min(100, Math.max(0, volume)));
}
