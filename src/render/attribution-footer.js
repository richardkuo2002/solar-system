// Small, permanent texture-credit line — no per-file listing here, just a
// pointer to ATTRIBUTION.md for the full breakdown. Same
// createXxxUI(container, ...) shape as ui-controls.js's builders.
export function createAttributionFooter(container) {
  const el = document.createElement('div');
  el.className = 'attribution-footer';
  el.innerHTML =
    'Planet textures: ' +
    '<a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar System Scope</a>' +
    ' (CC BY 4.0). Selected imagery: NASA/JPL, Steve Albers/NOAA SOS. ' +
    '<a href="ATTRIBUTION.md" target="_blank" rel="noopener">Full attribution</a>';
  container.appendChild(el);
}
