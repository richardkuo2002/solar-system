// Event Toolkit — v0.5. ONE consolidated panel with an event-type
// dropdown, replacing v0.4's single-purpose Retrograde Lab panel. Each
// entry in EVENT_TYPES is just config plugged into the generic
// createLabPanel builder (render/lab-panel.js) — adding a new event type
// (Steps 2-3 of v0.5) means adding one more entry here, not a new DOM file.
import { createLabPanel } from './lab-panel.js';
import { makeCollapsible } from './collapsible-panel.js';
import { t } from '../core/i18n.js';
import { analyzeRetrograde, RETROGRADE_TARGETS } from '../analysis/retrograde.js';
import { analyzeOppositionConjunction, OUTER_TARGETS } from '../analysis/opposition.js';
import { analyzeGreatestElongation, analyzeInnerConjunction, INNER_TARGETS } from '../analysis/elongation-events.js';
import { analyzePhaseIllumination, samplePhaseSeries, PHASE_TARGETS } from '../analysis/phase.js';
import { analyzeLunarEclipse, analyzeSolarEclipse } from '../analysis/eclipse.js';
import { analyzeTransit } from '../analysis/transit.js';
import { analyzeAppulse, APPULSE_TARGETS } from '../analysis/appulse.js';
import { analyzeLunarOccultation, OCCULTATION_TARGETS } from '../analysis/occultation.js';
import { analyzeMoonConjunction, MOON_CONJUNCTION_TARGETS } from '../analysis/moon-conjunction.js';
import { analyzeBestObservationNight, BEST_NIGHT_TARGETS } from '../analysis/best-night.js';

const SOURCE_OPTIONS = [
  { value: 'auto', labelKey: 'sourceOption.auto' },
  { value: 'horizons', labelKey: 'sourceOption.horizons' },
  { value: 'cache', labelKey: 'sourceOption.cache' },
  { value: 'kepler', labelKey: 'sourceOption.kepler' },
].map((opt) => ({ value: opt.value, label: t(opt.labelKey) }));

/** Body-key select options (Target/Planet A/Planet B fields) — label is the translated display name, not the raw internal key. */
function targetOptions(keys) {
  return keys.map((key) => ({ value: key, label: t(`body.${key}`) }));
}

function formatRetrogradeEvent(event) {
  if (!event) return '—';
  return `${event.epochUtc}\nλ = ${event.lambdaDeg.toFixed(3)}° (dλ/dt ${event.lambdaDotDegPerDay.toExponential(2)} °/day)`;
}

function formatRetrogradeResult(result) {
  if (result.note) return result.note;
  return [
    t('result.targetSourceFrame', { target: t(`body.${result.target}`), source: result.source, frame: result.frame }),
    t('result.sampling', { hours: result.samples.intervalHours, count: result.samples.count }),
    t('result.solverBasic', { method: result.solver.method, tolerance: result.solver.toleranceSeconds }),
    '',
    t('result.firstStationaryPoint', { event: result.start.event }),
    formatRetrogradeEvent(result.start),
    '',
    t('result.secondStationaryPoint', { event: result.end.event }),
    formatRetrogradeEvent(result.end),
  ].join('\n');
}

function formatOppositionResult(result) {
  const lines = [
    t('result.targetSourceFrame', { target: t(`body.${result.target}`), source: result.reference.source, frame: result.reference.frame }),
    t('result.samplingEventsFound', { hours: result.input.intervalHours, count: result.result.events.length }),
    t('result.solverFull', { method: result.solver.method, tolerance: result.solver.toleranceSeconds, status: result.solver.status }),
    '',
  ];
  if (result.result.events.length === 0) {
    lines.push(t('result.none.oppositionConjunction'));
  } else {
    for (const event of result.result.events) {
      lines.push(t('result.eventKindEpoch', { kind: t(`eventKind.${event.event}`), epoch: event.epochUtc }));
      lines.push(t('result.elongation', { value: event.elongationDeg.toFixed(3) }));
    }
  }
  return lines.join('\n');
}

function formatPhaseResult(result) {
  const lines = [
    t('result.targetSourceFrame', { target: t(`body.${result.target}`), source: result.reference.source, frame: result.reference.frame }),
    t('result.solverStatusOnly', { method: result.solver.method, status: result.solver.status }),
    '',
    t('result.phaseAngle', { value: result.result.phaseAngleDeg.toFixed(2) }),
    t('result.illuminatedFraction', { value: (result.result.illuminatedFraction * 100).toFixed(1) }),
  ];
  if (result.target === 'moon') {
    lines.push('', t('result.note.phaseMoon'));
  }
  return lines.join('\n');
}

function formatSignedElongationResult(noneMessageKey) {
  return (result) => {
    const lines = [
      t('result.targetSourceFrame', { target: t(`body.${result.target}`), source: result.reference.source, frame: result.reference.frame }),
      t('result.samplingEventsFound', { hours: result.input.intervalHours, count: result.result.events.length }),
      t('result.solverFull', { method: result.solver.method, tolerance: result.solver.toleranceSeconds, status: result.solver.status }),
      '',
    ];
    if (result.result.events.length === 0) {
      lines.push(t(noneMessageKey));
    } else {
      for (const event of result.result.events) {
        lines.push(t('result.eventKindEpoch', { kind: t(`eventKind.${event.event}`), epoch: event.epochUtc }));
        lines.push(t('result.signedElongation', { value: event.signedElongationDeg.toFixed(3) }));
      }
    }
    return lines.join('\n');
  };
}

// v1.9 — contact-time table rows, in display order, per eclipse kind. Only
// rows whose Utc field is non-null for this event get printed (a partial
// lunar eclipse has no U2/U3, a penumbral one has neither U1-4; a partial
// solar eclipse has no C2/C3).
const LUNAR_CONTACT_ROWS = [
  ['p1Utc', 'contactRow.p1'], ['u1Utc', 'contactRow.u1'],
  ['u2Utc', 'contactRow.u2'], ['u3Utc', 'contactRow.u3'],
  ['u4Utc', 'contactRow.u4'], ['p4Utc', 'contactRow.p4'],
];
const SOLAR_CONTACT_ROWS = [
  ['c1Utc', 'contactRow.c1'], ['c2Utc', 'contactRow.c2'],
  ['c3Utc', 'contactRow.c3'], ['c4Utc', 'contactRow.c4'],
];

function formatContactLines(contacts, rows) {
  if (!contacts) return [];
  return rows
    .filter(([key]) => contacts[key] != null)
    .map(([key, labelKey]) => `    ${t(labelKey)}: ${contacts[key]}`);
}

function formatEclipseResult(noneMessageKey, contactRows) {
  return (result) => {
    const lines = [
      t('result.sourceFrame', { source: result.reference.source, frame: result.reference.frame }),
      t('result.samplingEventsFound', { hours: result.input.intervalHours, count: result.result.events.length }),
      t('result.solverFull', { method: result.solver.method, tolerance: result.solver.toleranceSeconds, status: result.solver.status }),
      '',
    ];
    if (result.result.events.length === 0) {
      lines.push(t(noneMessageKey));
    } else {
      for (const event of result.result.events) {
        lines.push(t('result.eventKindEpoch', { kind: t(`classification.${event.classification}`), epoch: event.epochUtc }));
        lines.push(t('result.magnitude', { value: event.magnitude.toFixed(3) }));
        lines.push(...formatContactLines(event.contacts, contactRows));
      }
    }
    lines.push('', t('result.note.eclipse'));
    return lines.join('\n');
  };
}

function formatTransitResult(result) {
  const lines = [
    t('result.targetSourceFrame', { target: t(`body.${result.target}`), source: result.reference.source, frame: result.reference.frame }),
    t('result.samplingEventsFound', { hours: result.input.intervalHours, count: result.result.events.length }),
    t('result.solverFull', { method: result.solver.method, tolerance: result.solver.toleranceSeconds, status: result.solver.status }),
    '',
  ];
  if (result.result.events.length === 0) {
    lines.push(t('result.none.transit'));
  } else {
    for (const event of result.result.events) {
      lines.push(t('result.eventKindEpoch', { kind: t(`classification.${event.classification}`), epoch: event.epochUtc }));
      lines.push(t('result.separationMagnitude', { sep: event.separationDeg.toFixed(3), mag: event.magnitude.toFixed(3) }));
    }
  }
  lines.push('', t('result.note.transit'));
  return lines.join('\n');
}

function formatAppulseResult(result) {
  const lines = [
    t('result.appulsePair', { a: t(`body.${result.input.planetA}`), b: t(`body.${result.input.planetB}`), source: result.reference.source, frame: result.reference.frame }),
    t('result.samplingClosestApproachFound', { hours: result.input.intervalHours, count: result.result.events.length }),
    t('result.solverFull', { method: result.solver.method, tolerance: result.solver.toleranceSeconds, status: result.solver.status }),
    '',
  ];
  if (result.result.events.length === 0) {
    lines.push(t('result.none.appulse'));
  } else {
    for (const event of result.result.events) {
      lines.push(t('result.closestApproach', { epoch: event.epochUtc }));
      lines.push(t('result.separation', { value: event.separationDeg.toFixed(3) }));
    }
  }
  lines.push('', t('result.note.appulse'));
  return lines.join('\n');
}

function formatMoonConjunctionResult(result) {
  const lines = [
    t('result.targetSourceFrame', { target: t(`body.${result.target}`), source: result.reference.source, frame: result.reference.frame }),
    t('result.samplingClosestApproachFound', { hours: result.input.intervalHours, count: result.result.events.length }),
    t('result.solverFull', { method: result.solver.method, tolerance: result.solver.toleranceSeconds, status: result.solver.status }),
    '',
  ];
  if (result.result.events.length === 0) {
    lines.push(t('result.none.moonConjunction'));
  } else {
    for (const event of result.result.events) {
      lines.push(t('result.closestApproach', { epoch: event.epochUtc }));
      lines.push(t('result.separationMoon', { value: event.separationDeg.toFixed(3), occultNote: event.wouldOccult ? t('result.wouldOccultNote') : '' }));
      if (!event.aboveHorizon) lines.push(t('result.belowHorizonNote'));
    }
  }
  lines.push('', t('result.note.moonConjunction'));
  return lines.join('\n');
}

function formatOccultationResult(result) {
  const lines = [
    t('result.targetSourceFrame', { target: t(`body.${result.target}`), source: result.reference.source, frame: result.reference.frame }),
    t('result.samplingEventsFound', { hours: result.input.intervalHours, count: result.result.events.length }),
    t('result.solverFull', { method: result.solver.method, tolerance: result.solver.toleranceSeconds, status: result.solver.status }),
    '',
  ];
  if (result.result.events.length === 0) {
    lines.push(t('result.none.occultation'));
  } else {
    for (const event of result.result.events) {
      lines.push(t('result.eventKindEpoch', { kind: t(`classification.${event.classification}`), epoch: event.epochUtc }));
      lines.push(t('result.separationMagnitude', { sep: event.separationDeg.toFixed(3), mag: event.magnitude.toFixed(3) }));
    }
  }
  lines.push('', t('result.note.occultation'));
  return lines.join('\n');
}

function formatBestNightResult(result) {
  const lines = [
    t('result.targetSourceFrame', { target: t(`body.${result.target}`), source: result.reference.source, frame: result.reference.frame }),
    t('result.samplingNightlyCandidatesFound', { count: result.result.events.length }),
    t('result.solverStatusOnly', { method: result.solver.method, status: result.solver.status }),
    '',
  ];
  if (result.result.events.length === 0) {
    lines.push(t('result.none.bestNight'));
  } else {
    for (const event of result.result.events) {
      lines.push(t('result.bestNightRow', { rank: event.rank, date: event.epochUtc.slice(0, 10), score: event.score.toFixed(0), classification: t(`classification.${event.classification}`) }));
      const moon = event.moonAboveHorizon
        ? t('result.moonIlluminatedAbove', { pct: (event.moonIlluminatedFraction * 100).toFixed(0) })
        : t('result.moonBelowHorizon');
      lines.push(t('result.bestNightDetail', { alt: event.peakAltitudeDeg.toFixed(0), distance: event.distanceAu.toFixed(2), moon }));
    }
  }
  lines.push('', t('result.note.bestNight'));
  return lines.join('\n');
}

// Shared field labels — the same handful of concepts (date range, sample
// interval, observer location, ephemeris source) repeat across most of the
// 12 event types below, so they're translated once here instead of once
// per event type.
const FIELD = {
  target: t('field.target'),
  startDate: t('field.startDate'),
  endDate: t('field.endDate'),
  date: t('field.date'),
  intervalHours: t('field.intervalHours'),
  ephemerisSource: t('field.ephemerisSource'),
  observerLat: t('field.observerLat'),
  observerLon: t('field.observerLon'),
  observerElevation: t('field.observerElevation'),
  planetA: t('field.planetA'),
  planetB: t('field.planetB'),
};

export const EVENT_TYPES = [
  {
    key: 'retrograde',
    label: t('eventType.retrograde.label'),
    fixedText: t('eventType.geocentricFixedText'),
    fields: [
      { key: 'target', type: 'select', label: FIELD.target, default: 'mars', options: targetOptions(RETROGRADE_TARGETS) },
      { key: 'startUtc', type: 'date', label: FIELD.startDate, default: '2007-09-01' },
      { key: 'endUtc', type: 'date', label: FIELD.endDate, default: '2008-03-01' },
      { key: 'intervalHours', type: 'number', label: FIELD.intervalHours, default: 6, min: 1 },
      { key: 'ephemerisSource', type: 'select', label: FIELD.ephemerisSource, default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: t('eventType.retrograde.analyzeLabel'),
    chartKind: 'path+timeline',
    analyze: (params) => analyzeRetrograde(params),
    formatResult: formatRetrogradeResult,
    getMarkers: (result) => [result.start?.epochJd, result.end?.epochJd].filter((v) => v != null),
    getHighlight: (result) => (result.start && result.end ? { startJd: result.start.epochJd, endJd: result.end.epochJd } : null),
    // for the shared line-of-sight visual — app.js reads this off the result, not the config
    resultTarget: (result) => result.target,
  },
  {
    key: 'opposition',
    label: t('eventType.opposition.label'),
    fixedText: t('eventType.geocentricFixedText'),
    fields: [
      { key: 'target', type: 'select', label: FIELD.target, default: 'mars', options: targetOptions(OUTER_TARGETS) },
      { key: 'startUtc', type: 'date', label: FIELD.startDate, default: '2022-01-01' },
      { key: 'endUtc', type: 'date', label: FIELD.endDate, default: '2023-06-01' },
      { key: 'intervalHours', type: 'number', label: FIELD.intervalHours, default: 24, min: 1 },
      { key: 'ephemerisSource', type: 'select', label: FIELD.ephemerisSource, default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: t('eventType.opposition.analyzeLabel'),
    chartKind: 'path+timeline',
    analyze: (params) => analyzeOppositionConjunction(params),
    formatResult: formatOppositionResult,
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'elongation',
    label: t('eventType.elongation.label'),
    fixedText: t('eventType.geocentricFixedText'),
    fields: [
      { key: 'target', type: 'select', label: FIELD.target, default: 'venus', options: targetOptions(INNER_TARGETS) },
      { key: 'startUtc', type: 'date', label: FIELD.startDate, default: '2023-01-01' },
      { key: 'endUtc', type: 'date', label: FIELD.endDate, default: '2023-12-01' },
      { key: 'intervalHours', type: 'number', label: FIELD.intervalHours, default: 12, min: 1 },
      { key: 'ephemerisSource', type: 'select', label: FIELD.ephemerisSource, default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: t('eventType.elongation.analyzeLabel'),
    chartKind: 'timeline',
    analyze: (params) => analyzeGreatestElongation(params),
    formatResult: formatSignedElongationResult('result.none.greatestElongation'),
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'inner-conjunction',
    label: t('eventType.innerConjunction.label'),
    fixedText: t('eventType.geocentricFixedText'),
    fields: [
      { key: 'target', type: 'select', label: FIELD.target, default: 'venus', options: targetOptions(INNER_TARGETS) },
      { key: 'startUtc', type: 'date', label: FIELD.startDate, default: '2023-01-01' },
      { key: 'endUtc', type: 'date', label: FIELD.endDate, default: '2023-12-01' },
      { key: 'intervalHours', type: 'number', label: FIELD.intervalHours, default: 12, min: 1 },
      { key: 'ephemerisSource', type: 'select', label: FIELD.ephemerisSource, default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: t('eventType.innerConjunction.analyzeLabel'),
    chartKind: 'timeline',
    analyze: (params) => analyzeInnerConjunction(params),
    formatResult: formatSignedElongationResult('result.none.innerConjunction'),
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'phase',
    label: t('eventType.phase.label'),
    fixedText: t('eventType.geocentricFixedText'),
    fields: [
      { key: 'target', type: 'select', label: FIELD.target, default: 'moon', options: targetOptions(PHASE_TARGETS) },
      { key: 'atUtc', type: 'date', label: FIELD.date, default: '2024-01-01' },
      { key: 'ephemerisSource', type: 'select', label: FIELD.ephemerisSource, default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: t('eventType.phase.analyzeLabel'),
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
  {
    key: 'lunar-eclipse',
    label: t('eventType.lunarEclipse.label'),
    fixedText: t('eventType.lunarEclipse.fixedText'),
    fields: [
      { key: 'startUtc', type: 'date', label: FIELD.startDate, default: '2022-10-01' },
      { key: 'endUtc', type: 'date', label: FIELD.endDate, default: '2022-12-01' },
      { key: 'intervalHours', type: 'number', label: FIELD.intervalHours, default: 6, min: 1 },
    ],
    analyzeLabel: t('eventType.lunarEclipse.analyzeLabel'),
    chartKind: 'timeline',
    analyze: (params) => analyzeLunarEclipse(params),
    formatResult: formatEclipseResult('result.none.lunarEclipse', LUNAR_CONTACT_ROWS),
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'solar-eclipse',
    label: t('eventType.solarEclipse.label'),
    fixedText: t('eventType.solarEclipse.fixedText'),
    fields: [
      { key: 'startUtc', type: 'date', label: FIELD.startDate, default: '2024-03-01' },
      { key: 'endUtc', type: 'date', label: FIELD.endDate, default: '2024-05-01' },
      { key: 'intervalHours', type: 'number', label: FIELD.intervalHours, default: 6, min: 1 },
      { key: 'latDeg', type: 'number', label: FIELD.observerLat, default: 32.7767, min: -90, max: 90 },
      { key: 'lonDeg', type: 'number', label: FIELD.observerLon, default: -96.7970, min: -180, max: 180 },
      { key: 'elevationM', type: 'number', label: FIELD.observerElevation, default: 0, min: 0 },
    ],
    analyzeLabel: t('eventType.solarEclipse.analyzeLabel'),
    chartKind: 'timeline',
    analyze: (params) => analyzeSolarEclipse(params),
    formatResult: formatEclipseResult('result.none.solarEclipse', SOLAR_CONTACT_ROWS),
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'transit',
    label: t('eventType.transit.label'),
    fixedText: t('eventType.transit.fixedText'),
    fields: [
      { key: 'target', type: 'select', label: FIELD.target, default: 'mercury', options: targetOptions(INNER_TARGETS) },
      { key: 'startUtc', type: 'date', label: FIELD.startDate, default: '2019-11-01' },
      { key: 'endUtc', type: 'date', label: FIELD.endDate, default: '2019-12-01' },
      { key: 'intervalHours', type: 'number', label: FIELD.intervalHours, default: 24, min: 1 },
      { key: 'latDeg', type: 'number', label: FIELD.observerLat, default: 40.7128, min: -90, max: 90 },
      { key: 'lonDeg', type: 'number', label: FIELD.observerLon, default: -74.0060, min: -180, max: 180 },
      { key: 'elevationM', type: 'number', label: FIELD.observerElevation, default: 0, min: 0 },
    ],
    analyzeLabel: t('eventType.transit.analyzeLabel'),
    chartKind: 'timeline',
    analyze: (params) => analyzeTransit(params),
    formatResult: formatTransitResult,
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'appulse',
    label: t('eventType.appulse.label'),
    fixedText: t('eventType.geocentricFixedText'),
    fields: [
      { key: 'planetA', type: 'select', label: FIELD.planetA, default: 'jupiter', options: targetOptions(APPULSE_TARGETS) },
      { key: 'planetB', type: 'select', label: FIELD.planetB, default: 'saturn', options: targetOptions(APPULSE_TARGETS) },
      { key: 'startUtc', type: 'date', label: FIELD.startDate, default: '2020-11-01' },
      { key: 'endUtc', type: 'date', label: FIELD.endDate, default: '2021-01-15' },
      { key: 'intervalHours', type: 'number', label: FIELD.intervalHours, default: 24, min: 1 },
      { key: 'ephemerisSource', type: 'select', label: FIELD.ephemerisSource, default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: t('eventType.appulse.analyzeLabel'),
    chartKind: 'timeline',
    analyze: (params) => analyzeAppulse(params),
    formatResult: formatAppulseResult,
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'lunar-occultation',
    label: t('eventType.lunarOccultation.label'),
    fixedText: t('eventType.lunarOccultation.fixedText'),
    fields: [
      { key: 'target', type: 'select', label: FIELD.target, default: 'venus', options: targetOptions(OCCULTATION_TARGETS) },
      { key: 'startUtc', type: 'date', label: FIELD.startDate, default: '2021-11-01' },
      { key: 'endUtc', type: 'date', label: FIELD.endDate, default: '2021-11-15' },
      { key: 'intervalHours', type: 'number', label: FIELD.intervalHours, default: 24, min: 1 },
      { key: 'latDeg', type: 'number', label: FIELD.observerLat, default: 35.6762, min: -90, max: 90 },
      { key: 'lonDeg', type: 'number', label: FIELD.observerLon, default: 139.6503, min: -180, max: 180 },
      { key: 'elevationM', type: 'number', label: FIELD.observerElevation, default: 0, min: 0 },
    ],
    analyzeLabel: t('eventType.lunarOccultation.analyzeLabel'),
    chartKind: 'timeline',
    analyze: (params) => analyzeLunarOccultation(params),
    formatResult: formatOccultationResult,
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'moon-conjunction',
    label: t('eventType.moonConjunction.label'),
    fixedText: t('eventType.moonConjunction.fixedText'),
    fields: [
      { key: 'target', type: 'select', label: FIELD.target, default: 'venus', options: targetOptions(MOON_CONJUNCTION_TARGETS) },
      { key: 'startUtc', type: 'date', label: FIELD.startDate, default: '2022-05-20' },
      { key: 'endUtc', type: 'date', label: FIELD.endDate, default: '2022-06-01' },
      { key: 'intervalHours', type: 'number', label: FIELD.intervalHours, default: 24, min: 1 },
      { key: 'latDeg', type: 'number', label: FIELD.observerLat, default: 35.6892, min: -90, max: 90 },
      { key: 'lonDeg', type: 'number', label: FIELD.observerLon, default: 51.3890, min: -180, max: 180 },
      { key: 'elevationM', type: 'number', label: FIELD.observerElevation, default: 0, min: 0 },
    ],
    analyzeLabel: t('eventType.moonConjunction.analyzeLabel'),
    chartKind: 'timeline',
    analyze: (params) => analyzeMoonConjunction(params),
    formatResult: formatMoonConjunctionResult,
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'best-night',
    label: t('eventType.bestNight.label'),
    fixedText: t('eventType.bestNight.fixedText'),
    fields: [
      { key: 'target', type: 'select', label: FIELD.target, default: 'jupiter', options: targetOptions(BEST_NIGHT_TARGETS) },
      { key: 'startUtc', type: 'date', label: FIELD.startDate, default: '2024-10-01' },
      { key: 'endUtc', type: 'date', label: FIELD.endDate, default: '2024-12-01' },
      { key: 'latDeg', type: 'number', label: FIELD.observerLat, default: 35.6892, min: -90, max: 90 },
      { key: 'lonDeg', type: 'number', label: FIELD.observerLon, default: 51.3890, min: -180, max: 180 },
      { key: 'elevationM', type: 'number', label: FIELD.observerElevation, default: 0, min: 0 },
    ],
    analyzeLabel: t('eventType.bestNight.analyzeLabel'),
    chartKind: 'timeline',
    analyze: (params) => analyzeBestObservationNight(params),
    formatResult: formatBestNightResult,
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
];

/**
 * @param {HTMLElement} container
 * @param {object} callbacks
 * @param {(result:object, targetKey:string, primaryEpochJd:number|null) => void} callbacks.onAnalyzed  fired after a successful analysis; `primaryEpochJd` is the event type's first marker epoch (v1.10), or `null` if it found none
 * @param {(cursorJd:number) => void} [callbacks.onCursorChange]
 */
export function createEventToolkitPanel(container, callbacks) {
  const wrapper = document.createElement('div');
  wrapper.className = 'event-toolkit';

  // A dedicated top-level title, separate from each event type's own
  // lab-panel title (which changes text per selected type) — this one is
  // the collapse toggle for the whole toolkit, dropdown included.
  const title = document.createElement('div');
  title.className = 'event-toolkit-title';
  title.textContent = t('eventToolkit.title');
  wrapper.appendChild(title);

  const body = document.createElement('div');
  body.className = 'event-toolkit-body';
  wrapper.appendChild(body);

  const typeSelect = document.createElement('select');
  typeSelect.className = 'event-toolkit-type-select';
  typeSelect.setAttribute('aria-label', t('eventToolkit.typeAriaLabel'));
  for (const eventType of EVENT_TYPES) {
    const option = document.createElement('option');
    option.value = eventType.key;
    option.textContent = eventType.label;
    typeSelect.appendChild(option);
  }
  body.appendChild(typeSelect);

  const panelMount = document.createElement('div');
  body.appendChild(panelMount);
  container.appendChild(wrapper);
  // v1.11.1 — see observer-panel.js's identical comment (v1.11.2: fixed to
  // guard both the call and the .matches read).
  makeCollapsible(title, body, { startCollapsed: Boolean(window.matchMedia?.('(max-width: 700px)')?.matches) });

  function mount(eventTypeKey) {
    panelMount.replaceChildren();
    const eventType = EVENT_TYPES.find((e) => e.key === eventTypeKey);
    const labPanel = createLabPanel(panelMount, {
      className: 'event-toolkit-lab',
      title: eventType.label,
      fixedText: eventType.fixedText,
      fields: eventType.fields,
      storageKey: `event-toolkit:${eventType.key}`,
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
          // v1.10 — pass the first marker epoch (if any) so app.js can jump
          // the main simulated clock straight to it, the same way scrubbing
          // already does, instead of leaving the scene sitting wherever it
          // was before Analyze was clicked.
          callbacks.onAnalyzed?.(result, eventType.resultTarget(result), eventType.getMarkers(result)[0] ?? null);
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
