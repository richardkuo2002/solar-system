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
import { t } from '../core/i18n.js';

const TARGET_KEYS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
const DEFAULT_LAT_DEG = 22.6273;  // Kaohsiung
const DEFAULT_LON_DEG = 120.3014;
const DEFAULT_ELEVATION_M = 0;

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
    t('observer.result.target', { name: t(`body.${target}`) }),
    t('observer.result.utc', { value: utcText }),
    t('observer.result.local', { value: localText }),
    '',
    t('observer.result.raDec', { ra: r.raDeg.toFixed(3), dec: r.decDeg.toFixed(3) }),
    t('observer.result.altAz', { alt: r.altDeg.toFixed(3), az: r.azDeg.toFixed(3), horizon: t(r.aboveHorizon ? 'observer.horizon.above' : 'observer.horizon.below') }),
    t('observer.result.distance', { value: r.distanceAu.toFixed(5) }),
    '',
  ];
  if (r.note) {
    lines.push(r.note);
  } else if (r.events.length === 0) {
    lines.push(t('observer.result.noEvents'));
  } else {
    lines.push(t('observer.result.eventsHeader', { date: input.atUtc.slice(0, 10) }));
    for (const e of r.events) {
      const label = t(`observer.event.${e.event}`).padEnd(14, ' ');
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
  title.textContent = t('observer.title');
  panel.appendChild(title);

  const body = document.createElement('div');
  body.className = 'observer-panel-body';
  panel.appendChild(body);

  const form = document.createElement('div');
  form.className = 'observer-panel-form';

  const latInput = document.createElement('input');
  latInput.type = 'number'; latInput.step = '0.0001'; latInput.min = '-90'; latInput.max = '90'; latInput.value = String(DEFAULT_LAT_DEG);
  form.appendChild(field(t('observer.field.latitude'), latInput));

  const lonInput = document.createElement('input');
  lonInput.type = 'number'; lonInput.step = '0.0001'; lonInput.min = '-180'; lonInput.max = '180'; lonInput.value = String(DEFAULT_LON_DEG);
  form.appendChild(field(t('observer.field.longitude'), lonInput));

  const elevInput = document.createElement('input');
  elevInput.type = 'number'; elevInput.step = '1'; elevInput.value = String(DEFAULT_ELEVATION_M);
  form.appendChild(field(t('observer.field.elevation'), elevInput));

  const timeInput = document.createElement('input');
  timeInput.type = 'datetime-local';
  timeInput.value = toDatetimeLocalValue(new Date());
  form.appendChild(field(t('observer.field.time'), timeInput));

  const timeHint = document.createElement('small');
  timeHint.className = 'observer-panel-hint';
  timeHint.textContent = t('observer.hint.time');
  form.appendChild(timeHint);

  const targetSelect = document.createElement('select');
  for (const key of TARGET_KEYS) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = t(`body.${key}`);
    targetSelect.appendChild(option);
  }
  form.appendChild(field(t('observer.field.target'), targetSelect));

  const errorText = document.createElement('pre');
  errorText.className = 'observer-panel-error';
  errorText.hidden = true;

  const observeBtn = document.createElement('button');
  observeBtn.textContent = t('observer.button.observe');
  observeBtn.addEventListener('click', () => {
    const atDate = new Date(timeInput.value);
    if (!timeInput.value || Number.isNaN(atDate.getTime())) {
      setError(t('observer.error.timeRequired'));
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
  resultsText.textContent = t('observer.results.none');
  body.appendChild(resultsText);

  const canvas = document.createElement('canvas');
  canvas.width = 272;
  canvas.height = 140;
  canvas.className = 'observer-panel-canvas';
  body.appendChild(canvas);

  container.appendChild(panel);
  // v1.11.1 — start collapsed on narrow viewports so a phone-width page load
  // isn't immediately covered; same one-time matchMedia check touch-controls.js
  // already uses for its own pointer-coarse gate. `?.` twice (call + the
  // .matches read after it) so an environment without matchMedia degrades
  // to "not narrow" instead of throwing during panel construction.
  makeCollapsible(title, body, { startCollapsed: Boolean(window.matchMedia?.('(max-width: 700px)')?.matches) });

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
