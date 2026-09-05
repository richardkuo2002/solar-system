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

  function render() {
    titleEl.textContent = `${bodyEl.hidden ? '▸' : '▾'} ${baseText}`;
  }

  titleEl.addEventListener('click', () => {
    bodyEl.hidden = !bodyEl.hidden;
    render();
  });

  render();
}
