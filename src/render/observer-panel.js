// Observer Mode panel — v0.6. A dedicated panel, NOT a lab-panel.js/
// EVENT_TYPES entry: three adjacent lat/lon/elevation inputs need visible
// <label>s (lab-panel.js's fields render as title-tooltip-only number
// boxes), the altitude chart needs a fixed 0°-referenced axis + horizon
// line (drawLongitudeTimelineCanvas autoscales, wrong for this), and
// export is deliberately out of scope this iteration (lab-panel.js wires
// it unconditionally). Bespoke DOM, reusing `.event-toolkit-lab*`'s
// color/font/padding values via a new `.observer-panel*` class prefix for
// visual consistency, not the JS builder itself.
import { drawAltitudeCurveCanvas } from './event-charts.js';
import { makeCollapsible } from './collapsible-panel.js';

const TARGET_OPTIONS = [
  { value: 'sun', label: 'Sun' },
  { value: 'moon', label: 'Moon' },
  { value: 'mercury', label: 'Mercury' },
  { value: 'venus', label: 'Venus' },
  { value: 'mars', label: 'Mars' },
  { value: 'jupiter', label: 'Jupiter' },
  { value: 'saturn', label: 'Saturn' },
  { value: 'uranus', label: 'Uranus' },
  { value: 'neptune', label: 'Neptune' },
];
const DEFAULT_LAT_DEG = 22.6273;  // Kaohsiung
const DEFAULT_LON_DEG = 120.3014;
const DEFAULT_ELEVATION_M = 0;

const EVENT_LABELS = {
  rise: 'Rise', set: 'Set', transit: 'Transit', 'lower-transit': 'Lower transit',
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** `<input type="datetime-local">`'s expected local-wall-clock value format. */
function toDatetimeLocalValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function field(labelText, inputEl) {
  const row = document.createElement('label');
  row.className = 'observer-panel-field';
  const span = document.createElement('span');
  span.textContent = labelText;
  row.appendChild(span);
  row.appendChild(inputEl);
  return row;
}

function formatResultText(result) {
  const { target, input, result: r } = result;
  const utcText = input.atUtc;
  const localText = new Date(input.atUtc).toLocaleString();
  const lines = [
    `Target: ${target[0].toUpperCase()}${target.slice(1)}`,
    `UTC:   ${utcText}`,
    `Local: ${localText}`,
    '',
    `RA: ${r.raDeg.toFixed(3)}°  Dec: ${r.decDeg.toFixed(3)}°`,
    `Alt: ${r.altDeg.toFixed(3)}°  Az: ${r.azDeg.toFixed(3)}°  — ${r.aboveHorizon ? 'above horizon' : 'below horizon'}`,
    `Distance: ${r.distanceAu.toFixed(5)} AU`,
    '',
  ];
  if (r.note) {
    lines.push(r.note);
  } else if (r.events.length === 0) {
    lines.push('No rise/transit/set found on this UTC day.');
  } else {
    lines.push(`Rise/transit/set for the UTC day of ${input.atUtc.slice(0, 10)}:`);
    for (const e of r.events) {
      const label = (EVENT_LABELS[e.event] ?? e.event).padEnd(14, ' ');
      lines.push(`${label} ${e.epochUtc}  (alt ${e.altDeg.toFixed(1)}°, az ${e.azDeg.toFixed(1)}°)`);
    }
  }
  return lines.join('\n');
}

/**
 * @param {HTMLElement} container
 * @param {{ onObserve: (params:{target,atUtc,latDeg,lonDeg,elevationM}) => void }} callbacks
 * @returns {{ renderResult(result:object):void, setError(message:string|null):void }}
 */
export function createObserverPanel(container, { onObserve } = {}) {
  const panel = document.createElement('div');
  panel.className = 'observer-panel';

  const title = document.createElement('div');
  title.className = 'observer-panel-title';
  title.textContent = 'Observer Mode';
  panel.appendChild(title);

  const body = document.createElement('div');
  body.className = 'observer-panel-body';
  panel.appendChild(body);

  const form = document.createElement('div');
  form.className = 'observer-panel-form';

  const latInput = document.createElement('input');
  latInput.type = 'number'; latInput.step = '0.0001'; latInput.min = '-90'; latInput.max = '90'; latInput.value = String(DEFAULT_LAT_DEG);
  form.appendChild(field('Latitude (°)', latInput));

  const lonInput = document.createElement('input');
  lonInput.type = 'number'; lonInput.step = '0.0001'; lonInput.min = '-180'; lonInput.max = '180'; lonInput.value = String(DEFAULT_LON_DEG);
  form.appendChild(field('Longitude (°)', lonInput));

  const elevInput = document.createElement('input');
  elevInput.type = 'number'; elevInput.step = '1'; elevInput.value = String(DEFAULT_ELEVATION_M);
  form.appendChild(field('Elevation (m)', elevInput));

  const timeInput = document.createElement('input');
  timeInput.type = 'datetime-local';
  timeInput.value = toDatetimeLocalValue(new Date());
  form.appendChild(field('Observation time', timeInput));

  const timeHint = document.createElement('small');
  timeHint.className = 'observer-panel-hint';
  timeHint.textContent = 'Local time — the altitude curve covers the full UTC day of this instant.';
  form.appendChild(timeHint);

  const targetSelect = document.createElement('select');
  for (const opt of TARGET_OPTIONS) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    targetSelect.appendChild(option);
  }
  form.appendChild(field('Target', targetSelect));

  const errorText = document.createElement('pre');
  errorText.className = 'observer-panel-error';
  errorText.hidden = true;

  const observeBtn = document.createElement('button');
  observeBtn.textContent = 'Observe';
  observeBtn.addEventListener('click', () => {
    const atDate = new Date(timeInput.value);
    if (!timeInput.value || Number.isNaN(atDate.getTime())) {
      setError('Observation time is required');
      return;
    }
    const latDeg = parseFloat(latInput.value);
    const lonDeg = parseFloat(lonInput.value);
    const elevationM = parseFloat(elevInput.value);
    setError(null);
    onObserve?.({
      target: targetSelect.value,
      atUtc: atDate.toISOString(),
      latDeg: Number.isFinite(latDeg) ? latDeg : DEFAULT_LAT_DEG,
      lonDeg: Number.isFinite(lonDeg) ? lonDeg : DEFAULT_LON_DEG,
      elevationM: Number.isFinite(elevationM) ? elevationM : DEFAULT_ELEVATION_M,
    });
  });
  form.appendChild(observeBtn);
  body.appendChild(form);
  body.appendChild(errorText);

  const resultsText = document.createElement('pre');
  resultsText.className = 'observer-panel-results';
  resultsText.textContent = 'No observation run yet.';
  body.appendChild(resultsText);

  const canvas = document.createElement('canvas');
  canvas.width = 272;
  canvas.height = 140;
  canvas.className = 'observer-panel-canvas';
  body.appendChild(canvas);

  container.appendChild(panel);
  makeCollapsible(title, body);

  function setError(message) {
    errorText.hidden = !message;
    errorText.textContent = message ?? '';
  }

  return {
    setError,
    renderResult(result) {
      resultsText.textContent = formatResultText(result);
      drawAltitudeCurveCanvas(canvas, result.series, result.result.events);
    },
  };
}
