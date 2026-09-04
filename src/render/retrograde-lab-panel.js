// "Retrograde Lab" panel — v0.4. DOM-only; holds no analysis state itself,
// just input fields + a results/chart display. Modeled on
// createSurfaceControlsUI's input-row+button layout (ui-controls.js).
import { unwrapAnglesRad, RAD_TO_DEG } from '../analysis/longitude.js';
import { drawApparentPathCanvas, drawLongitudeTimelineCanvas, highlightCursorOnCharts } from './retrograde-charts.js';

const SOURCE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'horizons', label: 'Horizons' },
  { value: 'cache', label: 'Cache' },
  { value: 'kepler', label: 'Kepler' },
];

function formatEvent(event) {
  if (!event) return '—';
  return `${event.epochUtc}\nλ = ${event.lambdaDeg.toFixed(3)}° (dλ/dt ${event.lambdaDotDegPerDay.toExponential(2)} °/day)`;
}

/**
 * @param {HTMLElement} container
 * @param {object} callbacks
 * @param {(params: {startUtc:string, endUtc:string, intervalHours:number, ephemerisSource:string}) => void} callbacks.onAnalyze
 * @param {(cursorJd: number) => void} [callbacks.onCursorChange]  fired while scrubbing, so app.js can move the line-of-sight line
 */
export function createRetrogradeLabUI(container, callbacks) {
  const panel = document.createElement('div');
  panel.className = 'retrograde-lab';

  const title = document.createElement('div');
  title.className = 'retrograde-lab-title';
  title.textContent = 'Retrograde Lab — Mars';
  panel.appendChild(title);

  const fixedRow = document.createElement('div');
  fixedRow.className = 'retrograde-lab-fixed';
  fixedRow.textContent = 'Target: Mars · Observer: Earth (geocenter) · Frame: Geocentric ECLIPJ2000';
  panel.appendChild(fixedRow);

  const form = document.createElement('div');
  form.className = 'retrograde-lab-form';

  const startInput = document.createElement('input');
  startInput.type = 'date';
  startInput.title = 'Start date';
  startInput.value = '2007-09-01';

  const endInput = document.createElement('input');
  endInput.type = 'date';
  endInput.title = 'End date';
  endInput.value = '2008-03-01';

  const intervalInput = document.createElement('input');
  intervalInput.type = 'number';
  intervalInput.min = '1';
  intervalInput.value = '6';
  intervalInput.title = 'Sample interval (hours)';

  const sourceSelect = document.createElement('select');
  sourceSelect.title = 'Ephemeris source';
  for (const { value, label } of SOURCE_OPTIONS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === 'kepler') option.selected = true; // see README: dense scans always use Kepler internally regardless of this
    sourceSelect.appendChild(option);
  }

  const analyzeBtn = document.createElement('button');
  analyzeBtn.textContent = 'Analyze retrograde motion';
  analyzeBtn.addEventListener('click', () => {
    if (!startInput.value || !endInput.value) return;
    callbacks.onAnalyze({
      startUtc: `${startInput.value}T00:00:00Z`,
      endUtc: `${endInput.value}T00:00:00Z`,
      intervalHours: parseFloat(intervalInput.value) || 6,
      ephemerisSource: sourceSelect.value,
    });
  });

  form.append(startInput, endInput, intervalInput, sourceSelect, analyzeBtn);
  panel.appendChild(form);

  const resultsText = document.createElement('pre');
  resultsText.className = 'retrograde-lab-results';
  resultsText.textContent = 'No analysis run yet.';
  panel.appendChild(resultsText);

  const apparentPathCanvas = document.createElement('canvas');
  apparentPathCanvas.width = 220;
  apparentPathCanvas.height = 220;
  apparentPathCanvas.className = 'retrograde-lab-canvas';
  panel.appendChild(apparentPathCanvas);

  const timelineCanvas = document.createElement('canvas');
  timelineCanvas.width = 320;
  timelineCanvas.height = 140;
  timelineCanvas.className = 'retrograde-lab-canvas';
  panel.appendChild(timelineCanvas);

  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.className = 'retrograde-lab-scrub';
  scrub.min = '0';
  scrub.max = '0';
  scrub.value = '0';
  scrub.disabled = true;
  panel.appendChild(scrub);

  container.appendChild(panel);

  let currentSeries = null; // { timesJd, lambdaRad, xAu, yAu, lambdaDeg }

  scrub.addEventListener('input', () => {
    if (!currentSeries) return;
    const idx = parseInt(scrub.value, 10);
    const cursorJd = currentSeries.timesJd[idx];
    highlightCursorOnCharts(apparentPathCanvas, timelineCanvas, currentSeries, cursorJd);
    callbacks.onCursorChange?.(cursorJd);
  });

  return {
    setBusy(busy) {
      analyzeBtn.disabled = busy;
      analyzeBtn.textContent = busy ? 'Analyzing…' : 'Analyze retrograde motion';
    },

    /**
     * @param {object} result  analyzeMarsRetrograde's result object
     * @param {{timesJd:number[], lambdaRad:number[], xAu:number[], yAu:number[]}} series
     *   the raw sampled series (from sampleGeocentricLongitudeSeries), used to draw the charts
     */
    renderResult(result, series) {
      const lambdaDeg = unwrapAnglesRad(series.lambdaRad).map((v) => v * RAD_TO_DEG);
      currentSeries = { ...series, lambdaDeg };

      const stationaryEpochsJd = [result.start?.epochJd, result.end?.epochJd].filter((v) => v != null);
      const retrogradeIntervalJd = result.start && result.end
        ? { startJd: result.start.epochJd, endJd: result.end.epochJd }
        : null;

      drawApparentPathCanvas(apparentPathCanvas, currentSeries, stationaryEpochsJd);
      drawLongitudeTimelineCanvas(timelineCanvas, currentSeries, stationaryEpochsJd, retrogradeIntervalJd);

      scrub.max = String(series.timesJd.length - 1);
      scrub.value = '0';
      scrub.disabled = false;

      if (result.note) {
        resultsText.textContent = result.note;
        return;
      }

      resultsText.textContent = [
        `Source: ${result.source}  Frame: ${result.frame}`,
        `Sampling: ${result.samples.intervalHours}h × ${result.samples.count} points`,
        `Solver: ${result.solver.method}, tolerance ${result.solver.toleranceSeconds}s`,
        '',
        `First stationary point (${result.start.event}):`,
        formatEvent(result.start),
        '',
        `Second stationary point (${result.end.event}):`,
        formatEvent(result.end),
        '',
        'Opposition: not computed (see v0.5)',
      ].join('\n');
    },
  };
}
