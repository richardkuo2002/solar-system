// JSON/CSV export for any Event Toolkit result — v0.5, step 4. Pure,
// Node-testable. Two result shapes exist in this codebase: v0.4's
// retrograde result (flat: `observer` is a string, `frame`/`source` are
// top-level, `start`/`end` stationary points) and v0.5's newer nested
// shape (opposition/elongation/phase: `observer:{type,bodyId}`,
// `reference:{frame,center,source}`, `result.events[]` or
// `result.{phaseAngleDeg,illuminatedFraction}`). Rather than migrating
// v0.4's already-shipped, tested result shape just to satisfy export
// uniformity, small accessor helpers read whichever shape a given result
// actually has.

function getFrame(result) {
  return result.reference?.frame ?? result.frame;
}
function getSource(result) {
  return result.reference?.source ?? result.source;
}
function getObserverBodyId(result) {
  if (result.observer && typeof result.observer === 'object') return result.observer.bodyId;
  if (typeof result.observer === 'string') return result.observer;
  return undefined;
}

/** Throws (naming the missing field) if a result is missing required
 *  reproducibility metadata — never silently exports an incomplete record. */
function assertReproducible(result) {
  for (const field of ['id', 'type', 'target', 'solver']) {
    if (result[field] == null) throw new Error(`export: result is missing required field "${field}"`);
  }
  if (getObserverBodyId(result) == null) throw new Error('export: result is missing required field "observer"');
  if (getFrame(result) == null) throw new Error('export: result is missing required field "reference.frame" (or legacy "frame")');
  if (getSource(result) == null) throw new Error('export: result is missing required field "reference.source" (or legacy "source")');
  if (result.solver.method == null) throw new Error('export: result is missing required field "solver.method"');
}

/**
 * Full-fidelity reproducibility export: everything needed to redo the
 * analysis (event type, target, observer, frame/center/source, input
 * parameters, solver method/tolerance) plus the result. `series` (dense
 * per-sample arrays, chart-only) is dropped — "reproducibility" means
 * inputs+method, not a raw data dump.
 */
export function toExportableJson(result) {
  assertReproducible(result);
  const { series, ...exportable } = result;
  return JSON.stringify(exportable, null, 2);
}

// One shared column set covers every event type. Opposition/elongation/
// conjunction flatten `result.result.events[]` into one row per event
// (`event.valueDeg` = elongationDeg or signedElongationDeg as applicable,
// `event.illuminatedFraction` blank). Phase/illumination has no events[] —
// flattened as exactly one synthetic row. Legacy retrograde flattens its
// start/end stationary points the same way, as two rows.
const CSV_COLUMNS = [
  'id', 'type', 'target', 'observer.type', 'observer.bodyId',
  'reference.frame', 'reference.center', 'reference.source',
  'input.startUtc', 'input.endUtc', 'input.intervalHours', 'input.atUtc',
  'solver.method', 'solver.toleranceSeconds', 'solver.status',
  'event.name', 'event.epochUtc', 'event.epochJd', 'event.valueDeg',
  'event.illuminatedFraction', 'event.classification', 'event.magnitude', 'units',
];

function baseRow(result) {
  const observerType = result.observer && typeof result.observer === 'object'
    ? result.observer.type
    : (typeof result.observer === 'string' ? 'geocenter' : '');
  return {
    id: result.id ?? '',
    type: result.type ?? '',
    target: result.target ?? '',
    'observer.type': observerType,
    'observer.bodyId': getObserverBodyId(result) ?? '',
    'reference.frame': getFrame(result) ?? '',
    'reference.center': result.reference?.center ?? '',
    'reference.source': getSource(result) ?? '',
    'input.startUtc': result.input?.startUtc ?? '',
    'input.endUtc': result.input?.endUtc ?? '',
    'input.intervalHours': result.input?.intervalHours ?? '',
    'input.atUtc': result.input?.atUtc ?? '',
    'solver.method': result.solver?.method ?? '',
    'solver.toleranceSeconds': result.solver?.toleranceSeconds ?? '',
    'solver.status': result.solver?.status ?? '',
  };
}

const EMPTY_EVENT_COLUMNS = {
  'event.name': '', 'event.epochUtc': '', 'event.epochJd': '', 'event.valueDeg': '',
  'event.illuminatedFraction': '', 'event.classification': '', 'event.magnitude': '', units: 'deg',
};

function flattenResult(result) {
  const base = baseRow(result);

  // v0.5 events[] shape: opposition/conjunction, greatest elongation, inner
  // conjunction, eclipses (v1.1 — classification/magnitude instead of a
  // degree value)
  if (result.result && Array.isArray(result.result.events)) {
    if (result.result.events.length === 0) return [{ ...base, ...EMPTY_EVENT_COLUMNS }];
    return result.result.events.map((e) => ({
      ...base,
      'event.name': e.event,
      'event.epochUtc': e.epochUtc,
      'event.epochJd': e.epochJd,
      'event.valueDeg': e.elongationDeg ?? e.signedElongationDeg ?? '',
      'event.illuminatedFraction': '',
      'event.classification': e.classification ?? '',
      'event.magnitude': e.magnitude ?? '',
      units: 'deg',
    }));
  }

  // phase/illumination shape: a single value result, no events[]
  if (result.result && 'illuminatedFraction' in result.result) {
    return [{
      ...base,
      'event.name': 'phase-illumination',
      'event.epochUtc': result.input?.atUtc ?? '',
      'event.epochJd': result.epochJd ?? '',
      'event.valueDeg': result.result.phaseAngleDeg,
      'event.illuminatedFraction': result.result.illuminatedFraction,
      units: 'deg',
    }];
  }

  // legacy v0.4 retrograde shape: start/end stationary points, not events[]
  if ('start' in result || 'end' in result) {
    const rows = [result.start, result.end]
      .filter(Boolean)
      .map((pt) => ({
        ...base,
        'event.name': pt.event,
        'event.epochUtc': pt.epochUtc,
        'event.epochJd': pt.epochJd,
        'event.valueDeg': pt.lambdaDeg,
        'event.illuminatedFraction': '',
        units: 'deg',
      }));
    return rows.length ? rows : [{ ...base, ...EMPTY_EVENT_COLUMNS }];
  }

  return [{ ...base, ...EMPTY_EVENT_COLUMNS }];
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toExportableCsv(result) {
  assertReproducible(result);
  const rows = flattenResult(result);
  const lines = [CSV_COLUMNS.join(','), ...rows.map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(','))];
  return lines.join('\n');
}
