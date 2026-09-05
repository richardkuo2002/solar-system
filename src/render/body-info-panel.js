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

const CATEGORY_LABELS = {
  sun: 'Star', planet: 'Planet', moon: 'Moon', comet: 'Comet', dwarf: 'Dwarf Planet',
};

function formatMass(massKg, massRelativeToEarth) {
  // "m x 10^e kg" reads easier than raw toExponential()'s "5.972e+24".
  const exp = Math.floor(Math.log10(massKg));
  const mantissa = massKg / 10 ** exp;
  return `${mantissa.toFixed(3)} × 10^${exp} kg (${massRelativeToEarth.toFixed(3)}× Earth)`;
}

function formatInfoText(info) {
  const lines = [];
  if (info.radiusKm != null) {
    const note = info.radiusNote ? ` (${info.radiusNote})` : '';
    lines.push(`Radius: ${Math.round(info.radiusKm).toLocaleString()} km${note}`);
  }
  if (info.massKg != null) {
    lines.push(`Mass: ${formatMass(info.massKg, info.massRelativeToEarth)}`);
  }
  if (info.rotationPeriodDays != null) {
    const retro = info.rotationPeriodDays < 0 ? ' (retrograde)' : '';
    lines.push(`Rotation period: ${Math.abs(info.rotationPeriodDays).toFixed(3)} days${retro}`);
  }
  if (info.axialTiltDeg != null) {
    lines.push(`Axial tilt: ${info.axialTiltDeg.toFixed(2)}°`);
  }
  if (info.orbitalPeriodDays != null) {
    const years = info.orbitalPeriodDays / 365.25;
    const sourceNote = info.orbitalPeriodSource === 'kepler-derived' ? ' (Kepler\'s 3rd law estimate)' : '';
    lines.push(`Orbital period: ${info.orbitalPeriodDays.toFixed(1)} days (${years.toFixed(2)} yr)${sourceNote}`);
  }
  if (info.semiMajorAxisAu != null) {
    lines.push(`Semi-major axis: ${info.semiMajorAxisAu.toFixed(3)} AU`);
  }
  if (info.eccentricity != null) {
    lines.push(`Eccentricity: ${info.eccentricity.toFixed(3)}`);
  }
  if (info.inclinationDeg != null) {
    lines.push(`Inclination: ${info.inclinationDeg.toFixed(2)}°`);
  }
  if (info.orbitRadiusKm != null) {
    lines.push(`Orbit radius: ${Math.round(info.orbitRadiusKm).toLocaleString()} km`);
  }
  if (info.parentName != null) {
    lines.push(`Orbits: ${info.parentName}`);
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
  hint.textContent = 'Orbital periods for planets/comets/dwarf planets are a Kepler\'s-3rd-law '
    + 'estimate (T ≈ a^1.5); moon/Charon periods are direct data. Mass shown for the Sun and 8 planets only.';
  panel.appendChild(hint);

  container.appendChild(panel);

  return {
    render(info) {
      title.textContent = `${info.name} (${CATEGORY_LABELS[info.category] ?? info.category})`;
      resultsText.textContent = formatInfoText(info);
    },
  };
}
