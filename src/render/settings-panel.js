// Settings panel (v1.12) — a bottom-left gear button that toggles a small
// popover: language switch (EN/繁中) and a volume slider (no audio system
// exists yet — pure persistence, ready for a future music feature to read).
// NOT built on collapsible-panel.js: that helper is for an always-present
// section inside `.left-column`/`.right-column` that can be shrunk — this
// is a default-hidden popover shown on click, a different interaction, so
// a plain `hidden` toggle is simpler and more honest than reusing that API
// for something it wasn't designed for.
import { t, getLanguage, setLanguage, LANGUAGES, getVolume, setVolume } from '../core/i18n.js';

export function createSettingsPanel(container) {
  const button = document.createElement('button');
  button.className = 'settings-button';
  button.textContent = '⚙';
  button.setAttribute('aria-label', t('settings.button'));
  container.appendChild(button);

  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  panel.hidden = true;

  const title = document.createElement('div');
  title.className = 'settings-panel-title';
  title.textContent = t('settings.title');
  panel.appendChild(title);

  const langRow = document.createElement('div');
  langRow.className = 'settings-panel-row';
  const langLabel = document.createElement('span');
  langLabel.textContent = t('settings.language');
  langRow.appendChild(langLabel);
  const langSelect = document.createElement('select');
  langSelect.setAttribute('aria-label', t('settings.language'));
  for (const lang of LANGUAGES) {
    const option = document.createElement('option');
    option.value = lang;
    option.textContent = lang === 'en' ? 'English' : '繁體中文';
    if (lang === getLanguage()) option.selected = true;
    langSelect.appendChild(option);
  }
  // No live re-render exists anywhere in this codebase (every panel is
  // built once at startup) — see i18n.js's own header comment. Reloading
  // is simpler and more honest than half-reactively patching a handful of
  // already-built panels.
  langSelect.addEventListener('change', () => {
    setLanguage(langSelect.value);
    window.location.reload();
  });
  langRow.appendChild(langSelect);
  panel.appendChild(langRow);

  const volumeRow = document.createElement('div');
  volumeRow.className = 'settings-panel-row';
  const volumeLabel = document.createElement('span');
  volumeLabel.textContent = t('settings.volume');
  volumeRow.appendChild(volumeLabel);
  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.min = '0';
  volumeSlider.max = '100';
  volumeSlider.value = String(getVolume());
  volumeSlider.setAttribute('aria-label', t('settings.volume'));
  volumeSlider.addEventListener('input', () => {
    setVolume(parseInt(volumeSlider.value, 10));
  });
  volumeRow.appendChild(volumeSlider);
  panel.appendChild(volumeRow);

  const volumeHint = document.createElement('small');
  volumeHint.className = 'settings-panel-hint';
  volumeHint.textContent = t('settings.volume.hint');
  panel.appendChild(volumeHint);

  container.appendChild(panel);

  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });
}
