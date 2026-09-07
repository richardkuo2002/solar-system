// Planet Info Panel — v0.7. A dedicated panel, not a lab-panel.js/
// EVENT_TYPES entry (same reasoning as observer-panel.js): this is a
// render-on-select display with no form/analyze-button/export, so the
// generic builder's shape doesn't fit. Bespoke DOM, reusing
// `.observer-panel*`'s color/border/font values via a new
// `.body-info-panel*` class prefix for visual consistency.
//
// Purely presentational — src/app.js#buildBodyInfo owns "which data table,
// which fields exist for this body's category" and hands this a plain
// object; this file only formats whatever fields are present. Fields
// absent for a category (e.g. no mass for moons/comets/dwarf planets) are
// simply not in the object — that's a data-availability gap, not an
// approximation needing a "not modeled" disclaimer the way docs/accuracy.md
// documents actual astronomy approximations.

import { t } from '../core/i18n.js';

const CATEGORY_KEYS = {
  sun: 'star', planet: 'planet', moon: 'moon', comet: 'comet', dwarf: 'dwarfPlanet',
};

function formatMass(massKg, massRelativeToEarth) {
  // "m x 10^e kg" reads easier than raw toExponential()'s "5.972e+24".
  const exp = Math.floor(Math.log10(massKg));
  const mantissa = massKg / 10 ** exp;
  return t('bodyInfo.mass.value', { mantissa: mantissa.toFixed(3), exp, earthRatio: massRelativeToEarth.toFixed(3) });
}

function formatInfoText(info) {
  const lines = [];
  if (info.radiusKm != null) {
    const note = info.radiusNote ? ` (${info.radiusNote})` : '';
    lines.push(t('bodyInfo.radius', { value: Math.round(info.radiusKm).toLocaleString(), note }));
  }
  if (info.massKg != null) {
    lines.push(t('bodyInfo.mass', { value: formatMass(info.massKg, info.massRelativeToEarth) }));
  }
  if (info.rotationPeriodDays != null) {
    const retro = info.rotationPeriodDays < 0 ? t('bodyInfo.retrogradeSuffix') : '';
    lines.push(t('bodyInfo.rotationPeriod', { value: Math.abs(info.rotationPeriodDays).toFixed(3), retro }));
  }
  if (info.axialTiltDeg != null) {
    lines.push(t('bodyInfo.axialTilt', { value: info.axialTiltDeg.toFixed(2) }));
  }
  if (info.orbitalPeriodDays != null) {
    const years = info.orbitalPeriodDays / 365.25;
    const sourceNote = info.orbitalPeriodSource === 'kepler-derived' ? t('bodyInfo.keplerEstimateSuffix') : '';
    lines.push(t('bodyInfo.orbitalPeriod', { days: info.orbitalPeriodDays.toFixed(1), years: years.toFixed(2), note: sourceNote }));
  }
  if (info.semiMajorAxisAu != null) {
    lines.push(t('bodyInfo.semiMajorAxis', { value: info.semiMajorAxisAu.toFixed(3) }));
  }
  if (info.eccentricity != null) {
    lines.push(t('bodyInfo.eccentricity', { value: info.eccentricity.toFixed(3) }));
  }
  if (info.inclinationDeg != null) {
    lines.push(t('bodyInfo.inclination', { value: info.inclinationDeg.toFixed(2) }));
  }
  if (info.orbitRadiusKm != null) {
    lines.push(t('bodyInfo.orbitRadius', { value: Math.round(info.orbitRadiusKm).toLocaleString() }));
  }
  if (info.parentName != null) {
    lines.push(t('bodyInfo.orbits', { name: info.parentName }));
  }
  return lines.join('\n');
}

/**
 * @param {HTMLElement} container
 * @returns {{ render(info:object): void }}
 */
export function createBodyInfoPanel(container) {
  const panel = document.createElement('div');
  panel.className = 'body-info-panel';

  const title = document.createElement('div');
  title.className = 'body-info-panel-title';
  panel.appendChild(title);

  const resultsText = document.createElement('pre');
  resultsText.className = 'body-info-panel-results';
  panel.appendChild(resultsText);

  const hint = document.createElement('small');
  hint.className = 'body-info-panel-hint';
  hint.textContent = t('bodyInfo.hint');
  panel.appendChild(hint);

  container.appendChild(panel);

  return {
    render(info) {
      const categoryKey = CATEGORY_KEYS[info.category];
      const category = categoryKey ? t(`bodyInfo.category.${categoryKey}`) : info.category;
      title.textContent = `${info.name} (${category})`;
      resultsText.textContent = formatInfoText(info);
    },
  };
}
