// Small, permanent texture-credit line — no per-file listing here, just a
// pointer to ATTRIBUTION.md for the full breakdown. Same
// createXxxUI(container, ...) shape as ui-controls.js's builders.
import { t } from '../core/i18n.js';

export function createAttributionFooter(container) {
  const el = document.createElement('div');
  el.className = 'attribution-footer';
  // "Solar System Scope" is a company name, kept as-is in every language;
  // {ssLink}/{fullLink} placeholders keep the actual <a> markup out of the
  // dictionary strings themselves.
  const ssLink = '<a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar System Scope</a>';
  const fullLink = `<a href="ATTRIBUTION.md" target="_blank" rel="noopener">${t('attribution.fullLink')}</a>`;
  el.innerHTML = t('attribution.text', { ssLink, fullLink });
  container.appendChild(el);
}
