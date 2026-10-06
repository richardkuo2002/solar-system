// Always-visible readout of what's actually driving the current positions
// — time, selected body, and which of Kepler/Horizons-cache/Horizons-live
// produced its position, plus center/frame/units. Exists so "where did
// this number come from" is never a mystery (see docs/accuracy.md).
// Same createXxxUI(container, ...) shape as ui-controls.js's builders.

import { J2000_JD } from '../core/orbital-elements.js';
import { t } from '../core/i18n.js';
import { makeCollapsible } from './collapsible-panel.js';

const SOURCE_KEYS = {
  'horizons-live': 'horizonsLive',
  'horizons-cache': 'horizonsCache',
  kepler: 'kepler',
};

export function createEphemerisHud(container) {
  const el = document.createElement('div');
  el.className = 'ephemeris-hud';

  // v1.14 — used to be 7 permanently-expanded lines; on mobile that was
  // (along with body-info-panel.js's same-vintage bug) a big chunk of the
  // fixed vertical space pushing the 3D scene off-screen. Sim time +
  // selected body are the two fields people actually glance at mid-drag,
  // so they stay as the always-visible title/summary line; the rest
  // (source/center/frame/unit/reliability — the "where did this number
  // come from" detail, see docs/accuracy.md) moves into the collapsible
  // body, same `makeCollapsible` + mobile-default-collapsed pattern as
  // Observer Mode/Event Toolkit/body-info-panel.js.
  const title = document.createElement('div');
  title.className = 'ephemeris-hud-title';
  el.appendChild(title);

  const body = document.createElement('div');
  body.className = 'ephemeris-hud-body';
  el.appendChild(body);

  const source = document.createElement('div');
  const center = document.createElement('div');
  const frame = document.createElement('div');
  const unit = document.createElement('div');
  const reliability = document.createElement('div');
  body.append(source, center, frame, unit, reliability);
  container.appendChild(el);

  const collapsible = makeCollapsible(title, body, { startCollapsed: Boolean(window.matchMedia?.('(max-width: 700px)')?.matches) });

  return {
    /**
     * @param {Date} currentDate
     * @param {string} bodyName  display name, e.g. "Mars"
     * @param {object|null} state  body-state (see core/body-state.js), or
     *   null for a moon (moons use the hardcoded descriptor instead)
     * @param {string|null} [moonParentName]  set when `state` is null
     */
    update(currentDate, bodyName, state, moonParentName = null) {
      const y = currentDate.getUTCFullYear();
      const mo = String(currentDate.getUTCMonth() + 1).padStart(2, '0');
      const d = String(currentDate.getUTCDate()).padStart(2, '0');
      const hh = String(currentDate.getUTCHours()).padStart(2, '0');
      const mm = String(currentDate.getUTCMinutes()).padStart(2, '0');
      const simTimeText = t('hud.simTime', { value: `${y}-${mo}-${d} ${hh}:${mm} UTC` });
      const selectedText = t('hud.selectedBody', { name: bodyName });
      collapsible.setTitle(`${simTimeText} · ${selectedText}`);
      if (moonParentName) {
        source.textContent = t('hud.source', { value: t('hud.source.moon') });
        center.textContent = t('hud.center', { value: moonParentName });
        frame.textContent = t('hud.frame', { value: t('hud.frame.moon') });
        unit.textContent = t('hud.unit.scene');
        reliability.textContent = '';
      } else {
        source.textContent = t('hud.source', { value: t(`hud.source.${SOURCE_KEYS[state.source]}`) });
        // `state.center`/`state.frame` are always the 'SUN'/'ECLIPJ2000'
        // protocol constants (core/body-state.js) — center is translated
        // as a body name, frame is a reference-frame code shown verbatim
        // (not prose — same convention as an astronomy paper would use in
        // any language).
        center.textContent = t('hud.center', { value: t('body.sun') });
        frame.textContent = t('hud.frame', { value: state.frame });
        unit.textContent = t('hud.unit.au');
        // v1.4 — Kepler-only positions drift further from truth the further
        // the date is from J2000 (docs/accuracy.md already states this);
        // Horizons-cache and the Sun's exact origin stay silent here since
        // they don't carry this caveat.
        if (state.quality === 'approximate') {
          const yearsFromJ2000 = Math.abs(state.epochJd - J2000_JD) / 365.25;
          const outOfRange = state.validity && (
            currentDate < new Date(state.validity.startUtc) || currentDate > new Date(state.validity.endUtc)
          );
          reliability.textContent = t('hud.reliability', { years: yearsFromJ2000.toFixed(0), note: outOfRange ? t('hud.reliability.outOfRange') : '' });
        } else {
          reliability.textContent = '';
        }
      }
    },
  };
}
