// Always-visible readout of what's actually driving the current positions
// — time, selected body, and which of Kepler/Horizons-cache/Horizons-live
// produced its position, plus center/frame/units. Exists so "where did
// this number come from" is never a mystery (see docs/accuracy.md).
// Same createXxxUI(container, ...) shape as ui-controls.js's builders.

import { J2000_JD } from '../core/orbital-elements.js';

const SOURCE_LABELS = {
  'horizons-live': 'JPL Horizons (live)',
  'horizons-cache': 'JPL Horizons (cached)',
  kepler: 'Kepler propagation',
};

// Moons/Charon are deliberately outside the AU body-state contract (see
// core/body-state.js and docs/accuracy.md) — always the same honest,
// hardcoded descriptor rather than a fabricated AU position.
const MOON_SOURCE_LABEL = 'Kepler propagation (circular approx.)';
const MOON_FRAME_LABEL = 'orbital plane (parent-relative, not AU)';

export function createEphemerisHud(container) {
  const el = document.createElement('div');
  el.className = 'ephemeris-hud';
  const simTime = document.createElement('div');
  const selected = document.createElement('div');
  const source = document.createElement('div');
  const center = document.createElement('div');
  const frame = document.createElement('div');
  const unit = document.createElement('div');
  const reliability = document.createElement('div');
  el.append(simTime, selected, source, center, frame, unit, reliability);
  container.appendChild(el);

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
      simTime.textContent = `Simulation time: ${y}-${mo}-${d} ${hh}:${mm} UTC`;
      selected.textContent = `Selected body: ${bodyName}`;
      if (moonParentName) {
        source.textContent = `Ephemeris source: ${MOON_SOURCE_LABEL}`;
        center.textContent = `Reference center: ${moonParentName}`;
        frame.textContent = `Reference frame: ${MOON_FRAME_LABEL}`;
        unit.textContent = 'Position unit: scene units (not AU)';
        reliability.textContent = '';
      } else {
        source.textContent = `Ephemeris source: ${SOURCE_LABELS[state.source]}`;
        center.textContent = `Reference center: ${state.center[0]}${state.center.slice(1).toLowerCase()}`;
        frame.textContent = `Reference frame: ${state.frame}`;
        unit.textContent = 'Position unit: AU';
        // v1.4 — Kepler-only positions drift further from truth the further
        // the date is from J2000 (docs/accuracy.md already states this);
        // Horizons-cache and the Sun's exact origin stay silent here since
        // they don't carry this caveat.
        if (state.quality === 'approximate') {
          const yearsFromJ2000 = Math.abs(state.epochJd - J2000_JD) / 365.25;
          const outOfRange = state.validity && (
            currentDate < new Date(state.validity.startUtc) || currentDate > new Date(state.validity.endUtc)
          );
          reliability.textContent = `Precision: ~${yearsFromJ2000.toFixed(0)} yr from J2000 elements`
            + (outOfRange ? " — outside the table's valid date range" : '');
        } else {
          reliability.textContent = '';
        }
      }
    },
  };
}
