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

/**
 * @param {HTMLElement} container
 * @param {() => object|null} getCurrentResult  closure into the panel's
 *   last-rendered result; buttons stay disabled until this returns one
 * @returns {{ setResult(result:object|null): void }}
 */
export function createExportButtons(container, getCurrentResult) {
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
  container.appendChild(wrapper);

  return {
    setResult(result) {
      jsonBtn.disabled = !result;
      csvBtn.disabled = !result;
    },
  };
}
