// DOM-only widgets. Holds no simulation state itself — emits callbacks into
// app.js, which owns the actual timeController/camera state.

const SPEED_OPTIONS = [0.1, 1, 10, 100, 365];

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
  for (const speed of SPEED_OPTIONS) {
    const option = document.createElement('option');
    option.value = String(speed);
    option.textContent = `${speed} d/s`;
    if (speed === 1) option.selected = true;
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
