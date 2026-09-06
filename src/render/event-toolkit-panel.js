// Event Toolkit — v0.5. ONE consolidated panel with an event-type
// dropdown, replacing v0.4's single-purpose Retrograde Lab panel. Each
// entry in EVENT_TYPES is just config plugged into the generic
// createLabPanel builder (render/lab-panel.js) — adding a new event type
// (Steps 2-3 of v0.5) means adding one more entry here, not a new DOM file.
import { createLabPanel } from './lab-panel.js';
import { makeCollapsible } from './collapsible-panel.js';
import { analyzeRetrograde, RETROGRADE_TARGETS } from '../analysis/retrograde.js';
import { analyzeOppositionConjunction, OUTER_TARGETS } from '../analysis/opposition.js';
import { analyzeGreatestElongation, analyzeInnerConjunction, INNER_TARGETS } from '../analysis/elongation-events.js';
import { analyzePhaseIllumination, samplePhaseSeries, PHASE_TARGETS } from '../analysis/phase.js';
import { analyzeLunarEclipse, analyzeSolarEclipse } from '../analysis/eclipse.js';
import { analyzeTransit } from '../analysis/transit.js';
import { analyzeAppulse, APPULSE_TARGETS } from '../analysis/appulse.js';
import { analyzeLunarOccultation, OCCULTATION_TARGETS } from '../analysis/occultation.js';
import { analyzeMoonConjunction, MOON_CONJUNCTION_TARGETS } from '../analysis/moon-conjunction.js';

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
    `Target: ${capitalize(result.target)}  Source: ${result.source}  Frame: ${result.frame}`,
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
    lines.push('', 'Note: this uses the analysis-path Moon model (Meeus lunar theory, see docs/accuracy.md) — the live 3D scene\'s visual Moon uses a separate, less precise circular approximation, so the two may not exactly match.');
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

// v1.9 — contact-time table rows, in display order, per eclipse kind. Only
// rows whose Utc field is non-null for this event get printed (a partial
// lunar eclipse has no U2/U3, a penumbral one has neither U1-4; a partial
// solar eclipse has no C2/C3).
const LUNAR_CONTACT_ROWS = [
  ['p1Utc', 'P1 (penumbral begin)'], ['u1Utc', 'U1 (partial begin)'],
  ['u2Utc', 'U2 (total begin)'], ['u3Utc', 'U3 (total end)'],
  ['u4Utc', 'U4 (partial end)'], ['p4Utc', 'P4 (penumbral end)'],
];
const SOLAR_CONTACT_ROWS = [
  ['c1Utc', 'C1 (partial begin)'], ['c2Utc', 'C2 (total/annular begin)'],
  ['c3Utc', 'C3 (total/annular end)'], ['c4Utc', 'C4 (partial end)'],
];

function formatContactLines(contacts, rows) {
  if (!contacts) return [];
  return rows
    .filter(([key]) => contacts[key] != null)
    .map(([key, label]) => `    ${label}: ${contacts[key]}`);
}

function formatEclipseResult(noneMessage, contactRows) {
  return (result) => {
    const lines = [
      `Source: ${result.reference.source}  Frame: ${result.reference.frame}`,
      `Sampling: ${result.input.intervalHours}h × events found: ${result.result.events.length}`,
      `Solver: ${result.solver.method}, tolerance ${result.solver.toleranceSeconds}s, status: ${result.solver.status}`,
      '',
    ];
    if (result.result.events.length === 0) {
      lines.push(noneMessage);
    } else {
      for (const event of result.result.events) {
        lines.push(`${capitalize(event.classification)} — ${event.epochUtc}`);
        lines.push(`  magnitude ≈ ${event.magnitude.toFixed(3)}`);
        lines.push(...formatContactLines(event.contacts, contactRows));
      }
    }
    lines.push('', 'Note: geometric approximation — spherical Sun/Earth/Moon, no Besselian elements. Contact times found by a fixed-window scan around the greatest-eclipse instant (see docs/accuracy.md). Lunar shadow radii include the standard 1.01 atmospheric-enlargement factor.');
    return lines.join('\n');
  };
}

function formatTransitResult(result) {
  const lines = [
    `Target: ${capitalize(result.target)}  Source: ${result.reference.source}  Frame: ${result.reference.frame}`,
    `Sampling: ${result.input.intervalHours}h × events found: ${result.result.events.length}`,
    `Solver: ${result.solver.method}, tolerance ${result.solver.toleranceSeconds}s, status: ${result.solver.status}`,
    '',
  ];
  if (result.result.events.length === 0) {
    lines.push('No transit visible from this location in this range.');
  } else {
    for (const event of result.result.events) {
      lines.push(`${capitalize(event.classification)} — ${event.epochUtc}`);
      lines.push(`  separation ≈ ${event.separationDeg.toFixed(3)}°, magnitude ≈ ${event.magnitude.toFixed(3)}`);
    }
  }
  lines.push('', 'Note: geometric approximation — spherical Sun/planet, no atmospheric refraction, no contact-time table. See docs/accuracy.md.');
  return lines.join('\n');
}

function formatAppulseResult(result) {
  const lines = [
    `${capitalize(result.input.planetA)} ↔ ${capitalize(result.input.planetB)}  Source: ${result.reference.source}  Frame: ${result.reference.frame}`,
    `Sampling: ${result.input.intervalHours}h × closest-approach events found: ${result.result.events.length}`,
    `Solver: ${result.solver.method}, tolerance ${result.solver.toleranceSeconds}s, status: ${result.solver.status}`,
    '',
  ];
  if (result.result.events.length === 0) {
    lines.push('No closest-approach event found in this range.');
  } else {
    for (const event of result.result.events) {
      lines.push(`Closest approach — ${event.epochUtc}`);
      lines.push(`  separation = ${event.separationDeg.toFixed(3)}°`);
    }
  }
  lines.push('', 'Note: geocentric ("how close in Earth\'s sky"), not tied to any one observer\'s horizon.');
  return lines.join('\n');
}

function formatMoonConjunctionResult(result) {
  const lines = [
    `Target: ${capitalize(result.target)}  Source: ${result.reference.source}  Frame: ${result.reference.frame}`,
    `Sampling: ${result.input.intervalHours}h × closest-approach events found: ${result.result.events.length}`,
    `Solver: ${result.solver.method}, tolerance ${result.solver.toleranceSeconds}s, status: ${result.solver.status}`,
    '',
  ];
  if (result.result.events.length === 0) {
    lines.push('No conjunction found in this range.');
  } else {
    for (const event of result.result.events) {
      lines.push(`Closest approach — ${event.epochUtc}`);
      lines.push(`  separation = ${event.separationDeg.toFixed(3)}°${event.wouldOccult ? ' (close enough to be a lunar occultation — see that event type for full circumstances)' : ''}`);
      if (!event.aboveHorizon) lines.push('  (Moon or target below the horizon at this location)');
    }
  }
  lines.push('', 'Note: topocentric (this observer\'s actual sky), unlike Planetary Appulse which is geocentric — the Moon\'s ~1° parallax makes that distinction matter here.');
  return lines.join('\n');
}

function formatOccultationResult(result) {
  const lines = [
    `Target: ${capitalize(result.target)}  Source: ${result.reference.source}  Frame: ${result.reference.frame}`,
    `Sampling: ${result.input.intervalHours}h × events found: ${result.result.events.length}`,
    `Solver: ${result.solver.method}, tolerance ${result.solver.toleranceSeconds}s, status: ${result.solver.status}`,
    '',
  ];
  if (result.result.events.length === 0) {
    lines.push('No lunar occultation visible from this location in this range.');
  } else {
    for (const event of result.result.events) {
      lines.push(`${capitalize(event.classification)} — ${event.epochUtc}`);
      lines.push(`  separation ≈ ${event.separationDeg.toFixed(3)}°, magnitude ≈ ${event.magnitude.toFixed(3)}`);
    }
  }
  lines.push('', 'Note: geometric approximation — spherical Moon/planet, no atmospheric refraction, no limb profile. Limb-grazing events are unresolvable at this model\'s precision. See docs/accuracy.md.');
  return lines.join('\n');
}

export const EVENT_TYPES = [
  {
    key: 'retrograde',
    label: 'Retrograde Motion',
    fixedText: 'Observer: Earth (geocenter) · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'target', type: 'select', label: 'Target', default: 'mars', options: RETROGRADE_TARGETS.map((t) => ({ value: t, label: capitalize(t) })) },
      { key: 'startUtc', type: 'date', label: 'Start date', default: '2007-09-01' },
      { key: 'endUtc', type: 'date', label: 'End date', default: '2008-03-01' },
      { key: 'intervalHours', type: 'number', label: 'Sample interval (hours)', default: 6, min: 1 },
      { key: 'ephemerisSource', type: 'select', label: 'Ephemeris source', default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: 'Analyze retrograde motion',
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
  {
    key: 'lunar-eclipse',
    label: 'Lunar Eclipse',
    fixedText: 'Target: Moon · Observer: Earth (geocenter) · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'startUtc', type: 'date', label: 'Start date', default: '2022-10-01' },
      { key: 'endUtc', type: 'date', label: 'End date', default: '2022-12-01' },
      { key: 'intervalHours', type: 'number', label: 'Sample interval (hours)', default: 6, min: 1 },
    ],
    analyzeLabel: 'Analyze lunar eclipses',
    chartKind: 'timeline',
    analyze: (params) => analyzeLunarEclipse(params),
    formatResult: formatEclipseResult('No lunar eclipse found in this range.', LUNAR_CONTACT_ROWS),
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'solar-eclipse',
    label: 'Solar Eclipse',
    fixedText: 'Target: Moon · Observer: a specific location on Earth\'s surface · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'startUtc', type: 'date', label: 'Start date', default: '2024-03-01' },
      { key: 'endUtc', type: 'date', label: 'End date', default: '2024-05-01' },
      { key: 'intervalHours', type: 'number', label: 'Sample interval (hours)', default: 6, min: 1 },
      { key: 'latDeg', type: 'number', label: 'Observer latitude (deg)', default: 32.7767, min: -90, max: 90 },
      { key: 'lonDeg', type: 'number', label: 'Observer longitude (deg)', default: -96.7970, min: -180, max: 180 },
      { key: 'elevationM', type: 'number', label: 'Observer elevation (m)', default: 0, min: 0 },
    ],
    analyzeLabel: 'Analyze solar eclipses',
    chartKind: 'timeline',
    analyze: (params) => analyzeSolarEclipse(params),
    formatResult: formatEclipseResult('No solar eclipse visible from this location in this range.', SOLAR_CONTACT_ROWS),
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'transit',
    label: 'Transit of Mercury/Venus',
    fixedText: 'Observer: a specific location on Earth\'s surface · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'target', type: 'select', label: 'Target', default: 'mercury', options: INNER_TARGETS.map((t) => ({ value: t, label: capitalize(t) })) },
      { key: 'startUtc', type: 'date', label: 'Start date', default: '2019-11-01' },
      { key: 'endUtc', type: 'date', label: 'End date', default: '2019-12-01' },
      { key: 'intervalHours', type: 'number', label: 'Sample interval (hours)', default: 24, min: 1 },
      { key: 'latDeg', type: 'number', label: 'Observer latitude (deg)', default: 40.7128, min: -90, max: 90 },
      { key: 'lonDeg', type: 'number', label: 'Observer longitude (deg)', default: -74.0060, min: -180, max: 180 },
      { key: 'elevationM', type: 'number', label: 'Observer elevation (m)', default: 0, min: 0 },
    ],
    analyzeLabel: 'Analyze transits',
    chartKind: 'timeline',
    analyze: (params) => analyzeTransit(params),
    formatResult: formatTransitResult,
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'appulse',
    label: 'Planetary Appulse',
    fixedText: 'Observer: Earth (geocenter) · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'planetA', type: 'select', label: 'Planet A', default: 'jupiter', options: APPULSE_TARGETS.map((t) => ({ value: t, label: capitalize(t) })) },
      { key: 'planetB', type: 'select', label: 'Planet B', default: 'saturn', options: APPULSE_TARGETS.map((t) => ({ value: t, label: capitalize(t) })) },
      { key: 'startUtc', type: 'date', label: 'Start date', default: '2020-11-01' },
      { key: 'endUtc', type: 'date', label: 'End date', default: '2021-01-15' },
      { key: 'intervalHours', type: 'number', label: 'Sample interval (hours)', default: 24, min: 1 },
      { key: 'ephemerisSource', type: 'select', label: 'Ephemeris source', default: 'kepler', options: SOURCE_OPTIONS },
    ],
    analyzeLabel: 'Analyze appulse',
    chartKind: 'timeline',
    analyze: (params) => analyzeAppulse(params),
    formatResult: formatAppulseResult,
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'lunar-occultation',
    label: 'Lunar Occultation of a Planet',
    fixedText: 'Occulter: Moon · Observer: a specific location on Earth\'s surface · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'target', type: 'select', label: 'Target', default: 'venus', options: OCCULTATION_TARGETS.map((t) => ({ value: t, label: capitalize(t) })) },
      { key: 'startUtc', type: 'date', label: 'Start date', default: '2021-11-01' },
      { key: 'endUtc', type: 'date', label: 'End date', default: '2021-11-15' },
      { key: 'intervalHours', type: 'number', label: 'Sample interval (hours)', default: 24, min: 1 },
      { key: 'latDeg', type: 'number', label: 'Observer latitude (deg)', default: 35.6762, min: -90, max: 90 },
      { key: 'lonDeg', type: 'number', label: 'Observer longitude (deg)', default: 139.6503, min: -180, max: 180 },
      { key: 'elevationM', type: 'number', label: 'Observer elevation (m)', default: 0, min: 0 },
    ],
    analyzeLabel: 'Analyze occultations',
    chartKind: 'timeline',
    analyze: (params) => analyzeLunarOccultation(params),
    formatResult: formatOccultationResult,
    getMarkers: (result) => result.result.events.map((e) => e.epochJd),
    getHighlight: () => null,
    resultTarget: (result) => result.target,
  },
  {
    key: 'moon-conjunction',
    label: 'Moon Conjunction',
    fixedText: 'Occulter: Moon (conjunction only, not necessarily overlapping) · Observer: a specific location on Earth\'s surface · Frame: Geocentric ECLIPJ2000',
    fields: [
      { key: 'target', type: 'select', label: 'Target', default: 'venus', options: MOON_CONJUNCTION_TARGETS.map((t) => ({ value: t, label: capitalize(t) })) },
      { key: 'startUtc', type: 'date', label: 'Start date', default: '2022-05-20' },
      { key: 'endUtc', type: 'date', label: 'End date', default: '2022-06-01' },
      { key: 'intervalHours', type: 'number', label: 'Sample interval (hours)', default: 24, min: 1 },
      { key: 'latDeg', type: 'number', label: 'Observer latitude (deg)', default: 35.6892, min: -90, max: 90 },
      { key: 'lonDeg', type: 'number', label: 'Observer longitude (deg)', default: 51.3890, min: -180, max: 180 },
      { key: 'elevationM', type: 'number', label: 'Observer elevation (m)', default: 0, min: 0 },
    ],
    analyzeLabel: 'Analyze conjunctions',
    chartKind: 'timeline',
    analyze: (params) => analyzeMoonConjunction(params),
    formatResult: formatMoonConjunctionResult,
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
  title.textContent = 'Event Toolkit';
  wrapper.appendChild(title);

  const body = document.createElement('div');
  body.className = 'event-toolkit-body';
  wrapper.appendChild(body);

  const typeSelect = document.createElement('select');
  typeSelect.className = 'event-toolkit-type-select';
  typeSelect.setAttribute('aria-label', 'Event type');
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
  makeCollapsible(title, body);

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
