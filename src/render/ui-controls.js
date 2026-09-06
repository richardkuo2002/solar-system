// DOM-only widgets. Holds no simulation state itself — emits callbacks into
// app.js, which owns the actual timeController/camera state.

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
  { daysPerSecond: REAL_TIME_DAYS_PER_SECOND, label: '1x (real time)' },
  { daysPerSecond: 2 * REAL_TIME_DAYS_PER_SECOND, label: '2x' },
  { daysPerSecond: 5 * REAL_TIME_DAYS_PER_SECOND, label: '5x' },
  { daysPerSecond: 100 * REAL_TIME_DAYS_PER_SECOND, label: '100x' },
  { daysPerSecond: 1000 * REAL_TIME_DAYS_PER_SECOND, label: '1000x' },
  { daysPerSecond: 0.1, label: '0.1 d/s (8640x)' },
  { daysPerSecond: 1, label: '1 d/s (86400x)' },
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
  playPauseBtn.textContent = 'Pause';
  playPauseBtn.addEventListener('click', () => callbacks.onTogglePlayPause());

  const reverseBtn = document.createElement('button');
  reverseBtn.textContent = 'Reverse';
  reverseBtn.addEventListener('click', () => callbacks.onReverse());

  const speedSelect = document.createElement('select');
  for (const { daysPerSecond, label } of SPEED_OPTIONS) {
    const option = document.createElement('option');
    option.value = String(daysPerSecond);
    option.textContent = label;
    if (daysPerSecond === REAL_TIME_DAYS_PER_SECOND) option.selected = true;
    speedSelect.appendChild(option);
  }
  speedSelect.addEventListener('change', () => {
    callbacks.onSpeedChange(parseFloat(speedSelect.value));
  });

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  const jumpBtn = document.createElement('button');
  jumpBtn.textContent = 'Jump';
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
      playPauseBtn.textContent = playing ? 'Pause' : 'Play';
    },
    setCurrentDateDisplay(date) {
      dateLabel.textContent = date.toISOString().slice(0, 10);
    },
  };
}

const VIEW_MODE_LABELS = [
  { mode: 'heliocentric_topdown', label: 'Top-Down' },
  { mode: 'surface_first_person', label: 'Surface' },
  { mode: 'free_flight', label: 'Free Flight' },
  { mode: 'geocentric', label: 'Geocentric' },
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
  for (const { mode, label } of VIEW_MODE_LABELS) {
    const btn = document.createElement('button');
    btn.textContent = label;
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
  for (const key of planetKeys) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key[0].toUpperCase() + key.slice(1);
    if (key === initial.planet) option.selected = true;
    planetSelect.appendChild(option);
  }

  const latInput = document.createElement('input');
  latInput.type = 'number';
  latInput.min = '-90';
  latInput.max = '90';
  latInput.value = String(initial.lat);
  latInput.title = 'Latitude';

  const lonInput = document.createElement('input');
  lonInput.type = 'number';
  lonInput.min = '-180';
  lonInput.max = '180';
  lonInput.value = String(initial.lon);
  lonInput.title = 'Longitude';

  const goBtn = document.createElement('button');
  goBtn.textContent = 'Stand Here';
  goBtn.addEventListener('click', () => {
    onGo(planetSelect.value, parseFloat(latInput.value) || 0, parseFloat(lonInput.value) || 0);
  });

  panel.append(planetSelect, latInput, lonInput, goBtn);

  // v1.3 — investigated a user report that fast time speeds feel dizzying
  // in Surface Mode: it's correct behavior, not a bug (the default 1 d/s
  // already means ~1 rotation/second for Earth; 365 d/s is 366/second).
  // A hint, not an auto-override — silently overriding a speed the user
  // explicitly chose would be worse than the tradeoff it's explaining.
  const speedHint = document.createElement('small');
  speedHint.className = 'surface-controls-hint';
  speedHint.textContent = 'Tip: lower the time speed (e.g. 0.1 d/s) to watch the sky move smoothly.';
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
