// Export JSON/CSV buttons for the Event Toolkit — v0.5, step 4. First
// file-download precedent in this codebase (no existing Blob/
// URL.createObjectURL/<a download> anywhere else) — plain vanilla, no
// dependency, since the actual need (save a string as a downloaded file)
// is well within a few lines of standard browser API.
import { toExportableJson, toExportableCsv } from '../analysis/export.js';

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// v1.7 — chart PNG export. event-charts.js's clearCanvas fills each chart
// with a semi-transparent rgba(0,0,0,0.2) background (meant to sit over
// this app's own dark UI), so exporting the canvas verbatim would look
// broken against a plain white viewer — painted onto an opaque backing
// canvas first, matching the app's own dark chrome, then read out via
// toDataURL (a `<a download>` href, not a Blob — no other change needed
// versus downloadBlob's pattern above).
const CHART_BACKGROUND_COLOR = '#141420';

function downloadCanvasPng(canvasEl, filename) {
  const flattened = document.createElement('canvas');
  flattened.width = canvasEl.width;
  flattened.height = canvasEl.height;
  const ctx = flattened.getContext('2d');
  ctx.fillStyle = CHART_BACKGROUND_COLOR;
  ctx.fillRect(0, 0, flattened.width, flattened.height);
  ctx.drawImage(canvasEl, 0, 0);

  const a = document.createElement('a');
  a.href = flattened.toDataURL('image/png');
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * @param {HTMLElement} container
 * @param {() => object|null} getCurrentResult  closure into the panel's
 *   last-rendered result; buttons stay disabled until this returns one
 * @param {{apparentPathCanvas?: HTMLCanvasElement, timelineCanvas?: HTMLCanvasElement}} [canvases]
 *   v1.7 — present canvases each get a "Download ... PNG" button; absent
 *   ones (chartKind: 'none', or the apparent-path canvas when chartKind is
 *   just 'timeline') get none.
 * @returns {{ setResult(result:object|null): void }}
 */
export function createExportButtons(container, getCurrentResult, canvases = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'event-toolkit-export';

  const jsonBtn = document.createElement('button');
  jsonBtn.textContent = 'Export JSON';
  jsonBtn.disabled = true;
  jsonBtn.addEventListener('click', () => {
    const result = getCurrentResult();
    if (!result) return;
    downloadBlob(toExportableJson(result), `${result.id ?? result.type ?? 'event'}.json`, 'application/json');
  });

  const csvBtn = document.createElement('button');
  csvBtn.textContent = 'Export CSV';
  csvBtn.disabled = true;
  csvBtn.addEventListener('click', () => {
    const result = getCurrentResult();
    if (!result) return;
    downloadBlob(toExportableCsv(result), `${result.id ?? result.type ?? 'event'}.csv`, 'text/csv');
  });

  wrapper.appendChild(jsonBtn);
  wrapper.appendChild(csvBtn);

  const bothCanvasesPresent = !!(canvases.apparentPathCanvas && canvases.timelineCanvas);
  const pngButtons = [];
  const addPngButton = (canvasEl, label, suffix) => {
    if (!canvasEl) return;
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.disabled = true;
    btn.addEventListener('click', () => {
      const result = getCurrentResult();
      if (!result) return;
      downloadCanvasPng(canvasEl, `${result.id ?? result.type ?? 'chart'}${suffix}.png`);
    });
    wrapper.appendChild(btn);
    pngButtons.push(btn);
  };
  addPngButton(canvases.apparentPathCanvas, bothCanvasesPresent ? 'Download Path PNG' : 'Download Chart PNG', '-path');
  addPngButton(canvases.timelineCanvas, bothCanvasesPresent ? 'Download Timeline PNG' : 'Download Chart PNG', '-timeline');

  container.appendChild(wrapper);

  return {
    setResult(result) {
      jsonBtn.disabled = !result;
      csvBtn.disabled = !result;
      for (const btn of pngButtons) btn.disabled = !result;
    },
  };
}
