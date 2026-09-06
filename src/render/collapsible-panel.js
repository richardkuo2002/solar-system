// Small shared helper for a click-to-collapse panel header — added for
// the Observer Mode and Event Toolkit panels, which are the two tallest
// fixed-position overlays and the ones users asked to be able to shrink.
// No new visual language: reuses the existing `el.hidden = bool` idiom
// already used everywhere else in this codebase (lab-panel.js,
// observer-panel.js, hover-labels.js, touch-controls.js) instead of a new
// `display`/animation-based accordion.

/**
 * Makes `titleEl` a click target that shows/hides `bodyEl`. Defaults to
 * expanded (matches the pre-existing always-visible behavior) — collapsing
 * is an opt-in per click, not a new default state to relearn.
 * @param {HTMLElement} titleEl
 * @param {HTMLElement} bodyEl
 */
export function makeCollapsible(titleEl, bodyEl) {
  const baseText = titleEl.textContent;
  titleEl.classList.add('collapsible-title');
  // v1.8.6 — titleEl was a plain <div> with only a click handler: no
  // tabindex meant keyboard users could never reach it via Tab, and no
  // role/keydown handler meant even a focused div did nothing on
  // Enter/Space. role="button" + tabindex make it a real, Tab-reachable
  // control; aria-expanded lets a screen reader announce the current
  // state the same way the ▾/▸ glyph communicates it visually.
  titleEl.setAttribute('role', 'button');
  titleEl.setAttribute('tabindex', '0');

  function render() {
    titleEl.textContent = `${bodyEl.hidden ? '▸' : '▾'} ${baseText}`;
    titleEl.setAttribute('aria-expanded', String(!bodyEl.hidden));
  }

  function toggle() {
    bodyEl.hidden = !bodyEl.hidden;
    render();
  }

  titleEl.addEventListener('click', toggle);
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Space must not also scroll the page
      toggle();
    }
  });

  render();
}
