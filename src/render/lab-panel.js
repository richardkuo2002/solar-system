// Generic "analysis lab" panel builder — DOM-only, holds no analysis state
// itself. Generalizes v0.4's one-off retrograde-lab-panel.js (title +
// fixed-metadata row + input form + results text + 0-2 charts + scrub
// slider) into a config-driven factory so v0.5's several event types don't
// each duplicate ~150 lines of DOM boilerplate — every event type in the
// Event Toolkit is just one config object plugged into this.
import { drawApparentPathCanvas, drawLongitudeTimelineCanvas, highlightCursorOnCharts } from './event-charts.js';
import { createExportButtons } from './export-buttons.js';
import { dateFromJulianDate } from '../core/orbital-elements.js';

// v1.8.5 — see the analyzeBtn click handler below: caps startUtc/endUtc
// range divided by intervalHours. 50,000 is generous headroom over every
// EVENT_TYPES default (the largest, opposition/conjunction's ~1.5-year
// range at 24h, is ~540) while still catching the runaway cases that
// measurably freeze the main thread for seconds.
const MAX_SAMPLES = 50000;

/**
 * @param {HTMLElement} container
 * @param {object} config
 * @param {string} config.className        base CSS class, e.g. 'event-toolkit'
 * @param {string} config.title
 * @param {string} config.fixedText         e.g. 'Observer: Earth (geocenter) · Frame: Geocentric ECLIPJ2000'
 * @param {Array<{key:string, type:'date'|'number'|'select', label:string, default?:*, min?:number, max?:number, options?:{value:string,label:string}[]}>} config.fields
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
      if (field.type === 'number' && field.max != null) el.max = String(field.max);
    }
    el.title = field.label;
    // v1.8.6 — `title` alone isn't reliably announced by screen readers
    // and is invisible on touch. observer-panel.js already wraps its
    // inputs in a <label> for the same concept; this generic builder
    // serves ~10 different Event Toolkit field sets, so aria-label here
    // covers all of them in one place instead of restructuring each.
    el.setAttribute('aria-label', field.label);
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
        let value = Number.isFinite(parsed) ? parsed : field.default;
        // v1.8.5 — field.min/max were previously only the <input> HTML
        // attribute, which this click handler's own parseFloat() never
        // enforced (a user could type below `min`, e.g. an intervalHours
        // of 0.001 despite min:1). Clamp here so config-declared bounds
        // actually hold.
        if (field.min != null) value = Math.max(value, field.min);
        if (field.max != null) value = Math.min(value, field.max);
        params[field.key] = value;
      } else {
        params[field.key] = el.value;
      }
    }
    // v1.8.5 — an interval fine enough (or a date range wide enough)
    // relative to each other makes the analysis loop synchronously block
    // the main thread for seconds, freezing animate() — measured: a 2-month
    // range at 0.001h intervals blocked ~4.2s, and 1800-2050 at 1h/sample
    // blocked ~7.2s. Every EVENT_TYPES entry with an intervalHours field
    // also has startUtc/endUtc, so this one generic check (rather than a
    // per-event-type one) covers all of them.
    if ('intervalHours' in params && 'startUtc' in params && 'endUtc' in params) {
      const rangeHours = (new Date(params.endUtc).getTime() - new Date(params.startUtc).getTime()) / 3600000;
      const estimatedSamples = rangeHours / params.intervalHours;
      if (estimatedSamples > MAX_SAMPLES) {
        setError(`Sample interval too fine for this date range (~${Math.round(estimatedSamples).toLocaleString()} samples, max ${MAX_SAMPLES.toLocaleString()}) — increase the interval or shorten the range.`);
        return;
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
  // v1.8.6 — a bare range input announces as "slider, 0" with no context;
  // aria-valuetext (updated alongside the visible chart highlight below)
  // gives it the actual date being scrubbed to instead of a meaningless
  // sample index.
  scrub.setAttribute('aria-label', 'Scrub through result over time');
  if (chartKind !== 'none') panel.appendChild(scrub);

  let currentResult = null;
  const exportButtons = createExportButtons(panel, () => currentResult, { apparentPathCanvas, timelineCanvas });

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
    scrub.setAttribute('aria-valuetext', dateFromJulianDate(cursorJd).toISOString().slice(0, 10));
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
        scrub.setAttribute('aria-valuetext', dateFromJulianDate(series.timesJd[0]).toISOString().slice(0, 10));
      }

      resultsText.textContent = formatResult(result, series);
    },
  };
}
