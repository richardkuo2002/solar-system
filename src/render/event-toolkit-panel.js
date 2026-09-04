// Event Toolkit — v0.5. ONE consolidated panel with an event-type
// dropdown, replacing v0.4's single-purpose Retrograde Lab panel. Each
// entry in EVENT_TYPES is just config plugged into the generic
// createLabPanel builder (render/lab-panel.js) — adding a new event type
// (Steps 2-3 of v0.5) means adding one more entry here, not a new DOM file.
import { createLabPanel } from './lab-panel.js';
import { analyzeMarsRetrograde } from '../analysis/retrograde.js';
import { analyzeOppositionConjunction, OUTER_TARGETS } from '../analysis/opposition.js';
import { analyzeGreatestElongation, analyzeInnerConjunction, INNER_TARGETS } from '../analysis/elongation-events.js';
import { analyzePhaseIllumination, samplePhaseSeries, PHASE_TARGETS } from '../analysis/phase.js';

const SOURCE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'horizons', label: 'Horizons' },
  { value: 'cache', label: 'Cache' },
  { value: 'kepler', label: 'Kepler' },
];

function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function formatRetrogradeEvent(event) {
  if (!event) return '—';
  return `${event.epochUtc}\nλ = ${event.lambdaDeg.toFixed(3)}° (dλ/dt ${event.lambdaDotDegPerDay.toExponential(2)} °/day)`;
}

function formatRetrogradeResult(result) {
  if (result.note) return result.note;
  return [
    `Source: ${result.source}  Frame: ${result.frame}`,
    `Sampling: ${result.samples.intervalHours}h × ${result.samples.count} points`,
    `Solver: ${result.solver.method}, tolerance ${result.solver.toleranceSeconds}s`,
    '',
    `First stationary point (${result.start.event}):`,
    formatRetrogradeEvent(result.start),
    '',
    `Second stationary point (${result.end.event}):`,
    formatRetrogradeEvent(result.end),
  ].join('\n');
}

function formatOppositionResult(result) {
  const lines = [
    `Target: ${capitalize(result.target)}  Source: ${result.reference.source}  Frame: ${result.reference.frame}`,
    `Sampling: ${result.input.intervalHours}h × events found: ${result.result.events.length}`,
    `Solver: ${result.solver.method}, tolerance ${result.solver.toleranceSeconds}s, status: ${result.solver.status}`,
    '',
  ];
  if (result.result.events.length === 0) {
    lines.push('No opposition/conjunction found in this range.');
  } else {
    for (const event of result.result.events) {
      lines.push(`${capitalize(event.event)} — ${event.epochUtc}`);
      lines.push(`  elongation = ${event.elongationDeg.toFixed(3)}°`);
    }
  }
  return lines.join('\n');
}

function formatPhaseResult(result) {
  const lines = [
    `Target: ${capitalize(result.target)}  Source: ${result.reference.source}  Frame: ${result.reference.frame}`,
    `Solver: ${result.solver.method}, status: ${result.solver.status}`,
    '',
    `Phase angle = ${result.result.phaseAngleDeg.toFixed(2)}°`,
    `Illuminated fraction = ${(result.result.illuminatedFraction * 100).toFixed(1)}%`,
  ];
  if (result.target === 'moon') {
    lines.push('', 'Note: Moon position uses a separate circular-orbit approximation (see docs/accuracy.md) — may not exactly match the live 3D scene.');
  }
  return lines.join('\n');
}

function formatSignedElongationResult(noneMessage) {
  return (result) => {
    const lines = [
      `Target: ${capitalize(result.target)}  Source: ${result.reference.source}  Frame: ${result.reference.frame}`,
      `Sampling: ${result.input.intervalHours}h × events found: ${result.result.events.length}`,
      `Solver: ${result.solver.method}, tolerance ${result.solver.toleranceSeconds}s, status: ${result.solver.status}`,
      '',
    ];
    if (result.result.events.length === 0) {
      lines.push(noneMessage);
    } else {
      for (const event of result.result.events) {
        lines.push(`${capitalize(event.event.replace(/-/g, ' '))} — ${event.epochUtc}`);
        lines.push(`  signed elongation = ${event.signedElongationDeg.toFixed(3)}° (+ = east, − = west)`);
      }
    }
    return lines.join('\n');
  };
}

export const EVENT_TYPES = [
  {
    key: 'retrograde',
    label: 'Retrograde (Mars)',
    fixedText: 'Target: Mars · Observer: Earth (geocenter) · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'startUtc', type: 'date', label: 'Start date', default: '2007-09-01' },
      { key: 'endUtc', type: 'date', label: 'End date', default: '2008-03-01' },
      { key: 'intervalHours', type: 'number', label: 'Sample interval (hours)', default: 6, min: 1 },
      { key: 'ephemerisSource', type: 'select', label: 'Ephemeris source', default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: 'Analyze retrograde motion',
    chartKind: 'path+timeline',
    analyze: (params) => analyzeMarsRetrograde(params),
    formatResult: formatRetrogradeResult,
    getMarkers: (result) => [result.start?.epochJd, result.end?.epochJd].filter((v) => v != null),
    getHighlight: (result) => (result.start && result.end ? { startJd: result.start.epochJd, endJd: result.end.epochJd } : null),
    // for the shared line-of-sight visual — app.js reads this off the result, not the config
    resultTarget: () => 'mars',
  },
  {
    key: 'opposition',
    label: 'Opposition / Conjunction',
    fixedText: 'Observer: Earth (geocenter) · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'target', type: 'select', label: 'Target', default: 'mars', options: OUTER_TARGETS.map((t) => ({ value: t, label: capitalize(t) })) },
      { key: 'startUtc', type: 'date', label: 'Start date', default: '2022-01-01' },
      { key: 'endUtc', type: 'date', label: 'End date', default: '2023-06-01' },
      { key: 'intervalHours', type: 'number', label: 'Sample interval (hours)', default: 24, min: 1 },
      { key: 'ephemerisSource', type: 'select', label: 'Ephemeris source', default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: 'Analyze opposition/conjunction',
    chartKind: 'path+timeline',
    analyze: (params) => analyzeOppositionConjunction(params),
    formatResult: formatOppositionResult,
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'elongation',
    label: 'Greatest Elongation',
    fixedText: 'Observer: Earth (geocenter) · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'target', type: 'select', label: 'Target', default: 'venus', options: INNER_TARGETS.map((t) => ({ value: t, label: capitalize(t) })) },
      { key: 'startUtc', type: 'date', label: 'Start date', default: '2023-01-01' },
      { key: 'endUtc', type: 'date', label: 'End date', default: '2023-12-01' },
      { key: 'intervalHours', type: 'number', label: 'Sample interval (hours)', default: 12, min: 1 },
      { key: 'ephemerisSource', type: 'select', label: 'Ephemeris source', default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: 'Analyze greatest elongation',
    chartKind: 'timeline',
    analyze: (params) => analyzeGreatestElongation(params),
    formatResult: formatSignedElongationResult('No greatest elongation found in this range.'),
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'inner-conjunction',
    label: 'Inferior / Superior Conjunction',
    fixedText: 'Observer: Earth (geocenter) · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'target', type: 'select', label: 'Target', default: 'venus', options: INNER_TARGETS.map((t) => ({ value: t, label: capitalize(t) })) },
      { key: 'startUtc', type: 'date', label: 'Start date', default: '2023-01-01' },
      { key: 'endUtc', type: 'date', label: 'End date', default: '2023-12-01' },
      { key: 'intervalHours', type: 'number', label: 'Sample interval (hours)', default: 12, min: 1 },
      { key: 'ephemerisSource', type: 'select', label: 'Ephemeris source', default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: 'Analyze conjunction',
    chartKind: 'timeline',
    analyze: (params) => analyzeInnerConjunction(params),
    formatResult: formatSignedElongationResult('No inferior/superior conjunction found in this range.'),
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'phase',
    label: 'Phase / Illumination',
    fixedText: 'Observer: Earth (geocenter) · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'target', type: 'select', label: 'Target', default: 'moon', options: PHASE_TARGETS.map((t) => ({ value: t, label: capitalize(t) })) },
      { key: 'atUtc', type: 'date', label: 'Date', default: '2024-01-01' },
      { key: 'ephemerisSource', type: 'select', label: 'Ephemeris source', default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: 'Analyze phase / illumination',
    chartKind: 'timeline',
    // Single-epoch result + a short ±15-day illuminated-fraction strip for
    // visual context, folded into `series` so the shared lab-panel/chart
    // plumbing (built for interval-search event types) still applies —
    // the headline numbers are in formatResult, not primarily the chart.
    analyze: (params) => {
      const result = analyzePhaseIllumination(params);
      const atMs = new Date(params.atUtc).getTime();
      const windowStart = new Date(atMs - 15 * 86400 * 1000).toISOString();
      const windowEnd = new Date(atMs + 15 * 86400 * 1000).toISOString();
      const series = samplePhaseSeries(result.target, windowStart, windowEnd, 12, { ephemerisSource: params.ephemerisSource });
      return { ...result, series };
    },
    formatResult: formatPhaseResult,
    getMarkers: (result) => [result.epochJd].filter((v) => v != null),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
];

/**
 * @param {HTMLElement} container
 * @param {object} callbacks
 * @param {(result:object, targetKey:string) => void} callbacks.onAnalyzed  fired after a successful analysis
 * @param {(cursorJd:number) => void} [callbacks.onCursorChange]
 */
export function createEventToolkitPanel(container, callbacks) {
  const wrapper = document.createElement('div');
  wrapper.className = 'event-toolkit';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'event-toolkit-type-select';
  for (const eventType of EVENT_TYPES) {
    const option = document.createElement('option');
    option.value = eventType.key;
    option.textContent = eventType.label;
    typeSelect.appendChild(option);
  }
  wrapper.appendChild(typeSelect);

  const panelMount = document.createElement('div');
  wrapper.appendChild(panelMount);
  container.appendChild(wrapper);

  function mount(eventTypeKey) {
    panelMount.replaceChildren();
    const eventType = EVENT_TYPES.find((e) => e.key === eventTypeKey);
    const labPanel = createLabPanel(panelMount, {
      className: 'event-toolkit-lab',
      title: eventType.label,
      fixedText: eventType.fixedText,
      fields: eventType.fields,
      analyzeLabel: eventType.analyzeLabel,
      chartKind: eventType.chartKind,
      formatResult: eventType.formatResult,
      getMarkers: eventType.getMarkers,
      getHighlight: eventType.getHighlight,
    }, {
      onAnalyze(params) {
        labPanel.setBusy(true);
        try {
          const result = eventType.analyze(params);
          labPanel.renderResult(result, result.series);
          callbacks.onAnalyzed?.(result, eventType.resultTarget(result));
        } catch (err) {
          labPanel.setError(err.message);
        } finally {
          labPanel.setBusy(false);
        }
      },
      onCursorChange(cursorJd) {
        callbacks.onCursorChange?.(cursorJd);
      },
    });
  }

  typeSelect.addEventListener('change', () => mount(typeSelect.value));
  mount(EVENT_TYPES[0].key);
}
