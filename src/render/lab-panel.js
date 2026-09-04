// Generic "analysis lab" panel builder — DOM-only, holds no analysis state
// itself. Generalizes v0.4's one-off retrograde-lab-panel.js (title +
// fixed-metadata row + input form + results text + 0-2 charts + scrub
// slider) into a config-driven factory so v0.5's several event types don't
// each duplicate ~150 lines of DOM boilerplate — every event type in the
// Event Toolkit is just one config object plugged into this.
import { drawApparentPathCanvas, drawLongitudeTimelineCanvas, highlightCursorOnCharts } from './event-charts.js';
import { createExportButtons } from './export-buttons.js';

/**
 * @param {HTMLElement} container
 * @param {object} config
 * @param {string} config.className        base CSS class, e.g. 'event-toolkit'
 * @param {string} config.title
 * @param {string} config.fixedText         e.g. 'Observer: Earth (geocenter) · Frame: Geocentric ECLIPJ2000'
 * @param {Array<{key:string, type:'date'|'number'|'select', label:string, default?:*, min?:number, options?:{value:string,label:string}[]}>} config.fields
 * @param {string} config.analyzeLabel
 * @param {'path+timeline'|'timeline'|'none'} config.chartKind
 * @param {(result:object, series:object) => string} config.formatResult
 * @param {(result:object) => number[]} [config.getMarkers]        epochJd values to mark on both charts (default: none)
 * @param {(result:object) => {startJd:number,endJd:number}|null} [config.getHighlight]  shaded band on the timeline (default: none)
 * @param {object} callbacks
 * @param {(params:object) => void} callbacks.onAnalyze
 * @param {(cursorJd:number) => void} [callbacks.onCursorChange]  fired while scrubbing
 * @returns {{ setBusy(busy:boolean):void, setError(message:string|null):void, renderResult(result:object, series:object):void }}
 */
export function createLabPanel(container, config, callbacks = {}) {
  const {
    className, title, fixedText, fields, analyzeLabel, chartKind, formatResult,
    getMarkers = () => [], getHighlight = () => null,
  } = config;
  const { onAnalyze, onCursorChange } = callbacks;

  const panel = document.createElement('div');
  panel.className = className;

  const titleEl = document.createElement('div');
  titleEl.className = `${className}-title`;
  titleEl.textContent = title;
  panel.appendChild(titleEl);

  const fixedEl = document.createElement('div');
  fixedEl.className = `${className}-fixed`;
  fixedEl.textContent = fixedText;
  panel.appendChild(fixedEl);

  const form = document.createElement('div');
  form.className = `${className}-form`;

  const inputs = {}; // field key -> input/select element
  for (const field of fields) {
    let el;
    if (field.type === 'select') {
      el = document.createElement('select');
      for (const opt of field.options) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === field.default) option.selected = true;
        el.appendChild(option);
      }
    } else {
      el = document.createElement('input');
      el.type = field.type; // 'date' | 'number'
      if (field.default != null) el.value = String(field.default);
      if (field.type === 'number' && field.min != null) el.min = String(field.min);
    }
    el.title = field.label;
    inputs[field.key] = el;
    form.appendChild(el);
  }

  const errorText = document.createElement('pre');
  errorText.className = `${className}-error`;
  errorText.hidden = true;

  const analyzeBtn = document.createElement('button');
  analyzeBtn.textContent = analyzeLabel;
  analyzeBtn.addEventListener('click', () => {
    const params = {};
    for (const field of fields) {
      const el = inputs[field.key];
      if (field.type === 'date') {
        if (!el.value) {
          setError(`${field.label} is required`);
          return;
        }
        params[field.key] = `${el.value}T00:00:00Z`;
      } else if (field.type === 'number') {
        const parsed = parseFloat(el.value);
        params[field.key] = Number.isFinite(parsed) ? parsed : field.default;
      } else {
        params[field.key] = el.value;
      }
    }
    setError(null);
    onAnalyze?.(params);
  });
  form.appendChild(analyzeBtn);
  panel.appendChild(form);
  panel.appendChild(errorText);

  const resultsText = document.createElement('pre');
  resultsText.className = `${className}-results`;
  resultsText.textContent = 'No analysis run yet.';
  panel.appendChild(resultsText);

  let apparentPathCanvas = null;
  let timelineCanvas = null;
  if (chartKind === 'path+timeline') {
    apparentPathCanvas = document.createElement('canvas');
    apparentPathCanvas.width = 220;
    apparentPathCanvas.height = 220;
    apparentPathCanvas.className = `${className}-canvas`;
    panel.appendChild(apparentPathCanvas);
  }
  if (chartKind === 'path+timeline' || chartKind === 'timeline') {
    timelineCanvas = document.createElement('canvas');
    timelineCanvas.width = 320;
    timelineCanvas.height = 140;
    timelineCanvas.className = `${className}-canvas`;
    panel.appendChild(timelineCanvas);
  }

  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.className = `${className}-scrub`;
  scrub.min = '0';
  scrub.max = '0';
  scrub.value = '0';
  scrub.disabled = true;
  if (chartKind !== 'none') panel.appendChild(scrub);

  let currentResult = null;
  const exportButtons = createExportButtons(panel, () => currentResult);

  container.appendChild(panel);

  let currentSeries = null;

  function setError(message) {
    errorText.hidden = !message;
    errorText.textContent = message ?? '';
  }

  scrub.addEventListener('input', () => {
    if (!currentSeries) return;
    const idx = parseInt(scrub.value, 10);
    const cursorJd = currentSeries.timesJd[idx];
    highlightCursorOnCharts(apparentPathCanvas, timelineCanvas, currentSeries, cursorJd);
    onCursorChange?.(cursorJd);
  });

  return {
    setBusy(busy) {
      analyzeBtn.disabled = busy;
      analyzeBtn.textContent = busy ? 'Analyzing…' : analyzeLabel;
    },

    setError,

    /**
     * @param {object} result  the analyze*() result object
     * @param {{timesJd:number[], valueDeg?:number[], xAu?:number[], yAu?:number[]}} series
     */
    renderResult(result, series) {
      currentSeries = series;
      currentResult = result;
      exportButtons.setResult(result);

      const markerEpochsJd = getMarkers(result);
      const highlightIntervalJd = getHighlight(result);

      if (apparentPathCanvas) drawApparentPathCanvas(apparentPathCanvas, series, markerEpochsJd);
      if (timelineCanvas) drawLongitudeTimelineCanvas(timelineCanvas, series, markerEpochsJd, highlightIntervalJd);

      if (chartKind !== 'none' && series?.timesJd?.length) {
        scrub.max = String(series.timesJd.length - 1);
        scrub.value = '0';
        scrub.disabled = false;
      }

      resultsText.textContent = formatResult(result, series);
    },
  };
}
