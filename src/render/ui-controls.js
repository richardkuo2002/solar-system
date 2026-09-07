// DOM-only widgets. Holds no simulation state itself — emits callbacks into
// app.js, which owns the actual timeController/camera state.
import { t } from '../core/i18n.js';

// v1.8.2 — replaces the old days/second ladder (0.1/1/10/100/365, whose
// pre-selected "1 d/s" option was actually 86400x real time and never
// matched the true-real-time starting speed app.js set up in v1.8 — a
// known, documented mismatch at the time). Now anchored to real time
// itself: 1x is real time (matches app.js's starting speed exactly, so
// the dropdown and the actual clock agree on load), then small human-
// scale multiples (2x, 5x, 100x, 1000x) for watching things unfold
// faster, then the two old fixed rates kept for their existing
// usefulness (0.1 d/s ≈ one Mercury orbit every ~880 real seconds;
// 1 d/s ≈ one Earth year every ~365 real seconds) but now labeled by
// what they actually are — a multiplier — instead of a days/second
// figure nobody intuits speed from directly.
export const REAL_TIME_DAYS_PER_SECOND = 1 / 86400;
// v1.8.5 — exported (was module-private) so scripts/smoke-test.js can
// assert the default option actually matches REAL_TIME_DAYS_PER_SECOND
// without needing a DOM to inspect the rendered <select>; this is the
// exact bug class v1.8.2 fixed (a stale default that didn't match the
// clock's real starting speed) — now it has a regression test.
export const SPEED_OPTIONS = [
  { daysPerSecond: REAL_TIME_DAYS_PER_SECOND, labelKey: 'speed.realTime' },
  { daysPerSecond: 2 * REAL_TIME_DAYS_PER_SECOND, labelKey: 'speed.2x' },
  { daysPerSecond: 5 * REAL_TIME_DAYS_PER_SECOND, labelKey: 'speed.5x' },
  { daysPerSecond: 100 * REAL_TIME_DAYS_PER_SECOND, labelKey: 'speed.100x' },
  { daysPerSecond: 1000 * REAL_TIME_DAYS_PER_SECOND, labelKey: 'speed.1000x' },
  { daysPerSecond: 0.1, labelKey: 'speed.0.1dps' },
  { daysPerSecond: 1, labelKey: 'speed.1dps' },
];

/**
 * Builds the time-control panel (play/pause, speed, reverse, jump-to-date)
 * and appends it to `container`. Returns handles for app.js to keep the
 * displayed date in sync.
 *
 * @param {HTMLElement} container
 * @param {object} callbacks
 * @param {() => void} callbacks.onTogglePlayPause
 * @param {(daysPerSecond: number) => void} callbacks.onSpeedChange
 * @param {() => void} callbacks.onReverse
 * @param {(date: Date) => void} callbacks.onJumpToDate
 */
export function createTimeControlsUI(container, callbacks) {
  const panel = document.createElement('div');
  panel.className = 'time-controls';

  const playPauseBtn = document.createElement('button');
  playPauseBtn.textContent = t('time.pause');
  playPauseBtn.addEventListener('click', () => callbacks.onTogglePlayPause());

  const reverseBtn = document.createElement('button');
  reverseBtn.textContent = t('time.reverse');
  reverseBtn.addEventListener('click', () => callbacks.onReverse());

  const speedSelect = document.createElement('select');
  speedSelect.setAttribute('aria-label', t('time.speedAriaLabel'));
  for (const { daysPerSecond, labelKey } of SPEED_OPTIONS) {
    const option = document.createElement('option');
    option.value = String(daysPerSecond);
    option.textContent = t(labelKey);
    if (daysPerSecond === REAL_TIME_DAYS_PER_SECOND) option.selected = true;
    speedSelect.appendChild(option);
  }
  speedSelect.addEventListener('change', () => {
    callbacks.onSpeedChange(parseFloat(speedSelect.value));
  });

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.setAttribute('aria-label', t('time.jumpToDateAriaLabel'));
  const jumpBtn = document.createElement('button');
  jumpBtn.textContent = t('time.jump');
  jumpBtn.addEventListener('click', () => {
    if (!dateInput.value) return;
    callbacks.onJumpToDate(new Date(`${dateInput.value}T00:00:00Z`));
  });

  const dateLabel = document.createElement('span');
  dateLabel.className = 'current-date';

  panel.append(playPauseBtn, reverseBtn, speedSelect, dateInput, jumpBtn, dateLabel);
  container.appendChild(panel);

  return {
    element: panel, // v1.8.2 — app.js measures this to keep other bottom-left panels clear of it (see css .time-controls / .left-column comments)
    setPlayPauseLabel(playing) {
      playPauseBtn.textContent = playing ? t('time.pause') : t('time.play');
    },
    setCurrentDateDisplay(date) {
      dateLabel.textContent = date.toISOString().slice(0, 10);
    },
  };
}

const VIEW_MODE_LABELS = [
  { mode: 'heliocentric_topdown', labelKey: 'viewMode.topDown' },
  { mode: 'surface_first_person', labelKey: 'viewMode.surface' },
  { mode: 'free_flight', labelKey: 'viewMode.freeFlight' },
  { mode: 'geocentric', labelKey: 'viewMode.geocentric' },
];

/**
 * View-mode button group. `enabledModes` restricts which buttons are
 * clickable — modes not yet implemented (per the build order) render as
 * disabled rather than being wired to a pose that would throw.
 *
 * @param {HTMLElement} container
 * @param {(mode: string) => void} onModeChange
 * @param {string[]} enabledModes
 */
export function createViewModeUI(container, onModeChange, enabledModes) {
  const panel = document.createElement('div');
  panel.className = 'view-mode-controls';

  const buttons = {};
  for (const { mode, labelKey } of VIEW_MODE_LABELS) {
    const btn = document.createElement('button');
    btn.textContent = t(labelKey);
    btn.disabled = !enabledModes.includes(mode);
    btn.addEventListener('click', () => onModeChange(mode));
    buttons[mode] = btn;
    panel.appendChild(btn);
  }
  container.appendChild(panel);

  return {
    setActiveMode(mode) {
      for (const [m, btn] of Object.entries(buttons)) {
        btn.classList.toggle('active', m === mode);
      }
    },
    setEnabled(mode, enabled) {
      if (buttons[mode]) buttons[mode].disabled = !enabled;
    },
  };
}

/**
 * Planet + lat/lon picker for SURFACE_FIRST_PERSON mode. Always visible
 * (not just while that mode is active) — clicking "Go" both picks the spot
 * and switches into surface mode.
 *
 * @param {HTMLElement} container
 * @param {string[]} planetKeys
 * @param {(planet: string, lat: number, lon: number) => void} onGo
 * @param {{planet: string, lat: number, lon: number}} [initial] prefill values (e.g. restored from a shareable URL, see url-state.js) — defaults to earth/0/0
 */
export function createSurfaceControlsUI(container, planetKeys, onGo, initial = { planet: 'earth', lat: 0, lon: 0 }) {
  const panel = document.createElement('div');
  panel.className = 'surface-controls';

  const planetSelect = document.createElement('select');
  planetSelect.setAttribute('aria-label', t('surface.planetAriaLabel'));
  for (const key of planetKeys) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = t(`body.${key}`);
    if (key === initial.planet) option.selected = true;
    planetSelect.appendChild(option);
  }

  const latInput = document.createElement('input');
  latInput.type = 'number';
  latInput.min = '-90';
  latInput.max = '90';
  latInput.value = String(initial.lat);
  latInput.title = t('surface.latitude');
  latInput.setAttribute('aria-label', t('surface.latitude'));

  const lonInput = document.createElement('input');
  lonInput.type = 'number';
  lonInput.min = '-180';
  lonInput.max = '180';
  lonInput.value = String(initial.lon);
  lonInput.title = t('surface.longitude');
  lonInput.setAttribute('aria-label', t('surface.longitude'));

  const goBtn = document.createElement('button');
  goBtn.textContent = t('surface.standHere');
  goBtn.addEventListener('click', () => {
    // v1.8.6 — `parseFloat(...) || 0` can't tell a legitimately-typed 0
    // apart from unparseable garbage (both produce 0 either way, so this
    // was harmless here, but observer-panel.js already uses the stricter
    // Number.isFinite pattern for the same latitude/longitude concept —
    // matching it removes the one inconsistency.
    const lat = Number.isFinite(parseFloat(latInput.value)) ? parseFloat(latInput.value) : 0;
    const lon = Number.isFinite(parseFloat(lonInput.value)) ? parseFloat(lonInput.value) : 0;
    onGo(planetSelect.value, lat, lon);
  });

  panel.append(planetSelect, latInput, lonInput, goBtn);

  // v1.3 — investigated a user report that fast time speeds feel dizzying
  // in Surface Mode: it's correct behavior, not a bug (the default 1 d/s
  // already means ~1 rotation/second for Earth; 365 d/s is 366/second).
  // A hint, not an auto-override — silently overriding a speed the user
  // explicitly chose would be worse than the tradeoff it's explaining.
  const speedHint = document.createElement('small');
  speedHint.className = 'surface-controls-hint';
  speedHint.textContent = t('surface.speedHint');
  panel.appendChild(speedHint);

  container.appendChild(panel);

  return {
    setValue(planet, lat, lon) {
      planetSelect.value = planet;
      latInput.value = String(lat);
      lonInput.value = String(lon);
    },
  };
}
