// Hand-rolled Canvas 2D drawing for the Event Toolkit's chart blocks:
// a two-body apparent-path plot and a value-vs-time timeline. Originally
// built for the Mars Retrograde Lab (v0.4, retrograde-charts.js) and
// generalized here for v0.5's other event types (opposition/conjunction,
// elongation, phase/illumination) — both functions were already
// mathematically generic on their input series; only field names and
// retrograde-flavored naming needed generalizing. No charting dependency:
// this codebase has zero browser-facing npm dependencies and the actual
// drawing need (grid + polyline + a few markers) is well within plain
// <canvas> 2D — adding a library for this would be new, unrequested
// complexity.

const GRID_COLOR = '#333';
const AXIS_COLOR = '#555';
const PATH_COLOR = '#6cf';
const MARKER_COLOR = '#f80';
const CURSOR_COLOR = '#fff';
const HIGHLIGHT_BAND_COLOR = 'rgba(255,140,0,0.18)';

function clearCanvas(ctx, canvasEl) {
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
}

function nearestIndex(timesJd, jd) {
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < timesJd.length; i += 1) {
    const delta = Math.abs(timesJd[i] - jd);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

/**
 * Apparent-path chart — a two-body difference vector (e.g. target-minus-
 * observer, AU) plotted against a reference grid with direction arrows
 * along the path. This is a geometric plot, not a sky-projected RA/Dec
 * view — no such transform exists in this codebase; documented in README
 * as a known simplification. `series` needs `{xAu, yAu, timesJd}`.
 */
export function drawApparentPathCanvas(canvasEl, series, markerEpochsJd = []) {
  const ctx = canvasEl.getContext('2d');
  const { xAu, yAu, timesJd } = series;
  clearCanvas(ctx, canvasEl);

  const minX = Math.min(...xAu);
  const maxX = Math.max(...xAu);
  const minY = Math.min(...yAu);
  const maxY = Math.max(...yAu);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const pad = 24;
  const w = canvasEl.width - pad * 2;
  const h = canvasEl.height - pad * 2;

  const toPx = (x, y) => ({
    px: pad + ((x - minX) / spanX) * w,
    py: canvasEl.height - pad - ((y - minY) / spanY) * h, // AU +y up, canvas +y down
  });

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const gx = pad + (i / 4) * w;
    const gy = pad + (i / 4) * h;
    ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, canvasEl.height - pad); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(canvasEl.width - pad, gy); ctx.stroke();
  }
  ctx.strokeStyle = AXIS_COLOR;
  ctx.strokeRect(pad, pad, w, h);

  ctx.strokeStyle = PATH_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  xAu.forEach((x, i) => {
    const { px, py } = toPx(x, yAu[i]);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // Direction arrows every ~1/12th of the series.
  const arrowStep = Math.max(1, Math.floor(xAu.length / 12));
  ctx.fillStyle = PATH_COLOR;
  for (let i = arrowStep; i < xAu.length; i += arrowStep) {
    const from = toPx(xAu[i - 1], yAu[i - 1]);
    const to = toPx(xAu[i], yAu[i]);
    const angle = Math.atan2(to.py - from.py, to.px - from.px);
    ctx.save();
    ctx.translate(to.px, to.py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-6, -3); ctx.lineTo(-6, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = MARKER_COLOR;
  for (const jd of markerEpochsJd) {
    const idx = nearestIndex(timesJd, jd);
    const { px, py } = toPx(xAu[idx], yAu[idx]);
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  canvasEl.__labChart = { kind: 'apparent-path', series, markerEpochsJd, toPx };
}

/**
 * Value-vs-time timeline — unwrapped longitude, elongation, or any other
 * degree-valued series, with marker points and an optional shaded
 * highlight interval (retrograde interval, opposition-to-conjunction
 * span, etc). `series` needs `{timesJd, valueDeg}`.
 */
export function drawLongitudeTimelineCanvas(canvasEl, series, markerEpochsJd = [], highlightIntervalJd = null) {
  const ctx = canvasEl.getContext('2d');
  const { timesJd, valueDeg } = series;
  clearCanvas(ctx, canvasEl);

  const minT = timesJd[0];
  const maxT = timesJd[timesJd.length - 1];
  const spanT = maxT - minT || 1;
  const minL = Math.min(...valueDeg);
  const maxL = Math.max(...valueDeg);
  const spanL = maxL - minL || 1;
  const pad = 24;
  const w = canvasEl.width - pad * 2;
  const h = canvasEl.height - pad * 2;

  const toPx = (t, l) => ({
    px: pad + ((t - minT) / spanT) * w,
    py: canvasEl.height - pad - ((l - minL) / spanL) * h,
  });

  if (highlightIntervalJd) {
    const { startJd, endJd } = highlightIntervalJd;
    const a = toPx(startJd, minL).px;
    const b = toPx(endJd, minL).px;
    ctx.fillStyle = HIGHLIGHT_BAND_COLOR;
    ctx.fillRect(Math.min(a, b), pad, Math.abs(b - a), h);
  }

  ctx.strokeStyle = AXIS_COLOR;
  ctx.strokeRect(pad, pad, w, h);

  ctx.strokeStyle = PATH_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  timesJd.forEach((t, i) => {
    const { px, py } = toPx(t, valueDeg[i]);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.fillStyle = MARKER_COLOR;
  for (const jd of markerEpochsJd) {
    const idx = nearestIndex(timesJd, jd);
    const { px, py } = toPx(timesJd[idx], valueDeg[idx]);
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  canvasEl.__labChart = { kind: 'timeline', series, markerEpochsJd, highlightIntervalJd, toPx };
}

/**
 * Scrub-slider sync: redraws both charts from their last-drawn state
 * (cached on the canvas element by the two functions above) plus a cursor
 * marker at the sample nearest `cursorJd`.
 */
export function highlightCursorOnCharts(canvasEl2, canvasEl3, series, cursorJd) {
  const idx = nearestIndex(series.timesJd, cursorJd);

  const path = canvasEl2?.__labChart;
  if (path) {
    drawApparentPathCanvas(canvasEl2, path.series, path.markerEpochsJd);
    const { px, py } = path.toPx(path.series.xAu[idx], path.series.yAu[idx]);
    const ctx = canvasEl2.getContext('2d');
    ctx.fillStyle = CURSOR_COLOR;
    ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
  }

  const timeline = canvasEl3?.__labChart;
  if (timeline) {
    drawLongitudeTimelineCanvas(canvasEl3, timeline.series, timeline.markerEpochsJd, timeline.highlightIntervalJd);
    const { px, py } = timeline.toPx(timeline.series.timesJd[idx], timeline.series.valueDeg[idx]);
    const ctx = canvasEl3.getContext('2d');
    ctx.fillStyle = CURSOR_COLOR;
    ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
  }
}
