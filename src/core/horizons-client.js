// Raw JPL Horizons REST client. Free public API
// (https://ssd.jpl.nasa.gov/api/horizons.api), no key/auth required.
// One-body-per-request — there's no true multi-target vectors endpoint, so
// "batch" (in ephemeris.js) means several of these calls via Promise.all.
//
// DOM-free: uses only global `fetch`/`AbortController`/`URLSearchParams`,
// all available in both browsers and modern Node, so this stays
// Node-testable (the smoke test exercises parseVectorsBlock directly and
// stubs global.fetch — no live network calls in the smoke test itself).

export class HorizonsUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'HorizonsUnavailableError';
    this.cause = cause;
  }
}

const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatDate(jsDate) {
  return `${jsDate.getUTCFullYear()}-${pad(jsDate.getUTCMonth() + 1)}-${pad(jsDate.getUTCDate())}`;
}

/**
 * Parses the $$SOE / $$EOE delimited vector-table block from a Horizons
 * text response, returning the first row's heliocentric position (AU) and
 * velocity (AU/day). Isolated behind one function so it's the single point
 * of change if Horizons' output format shifts.
 *
 * Real output interleaves a position line ("X = ... Y = ... Z = ...") and a
 * velocity line ("VX= ... VY= ... VZ= ...") per timestamp, position first
 * — the standard Horizons vector-table order (VEC_TABLE='2', position +
 * velocity, requested by fetchHeliocentricPosition below).
 */
export function parseVectorsBlock(rawText) {
  const startIdx = rawText.indexOf('$$SOE');
  const endIdx = rawText.indexOf('$$EOE');
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new HorizonsUnavailableError('Horizons response missing $$SOE/$$EOE markers');
  }
  const block = rawText.slice(startIdx + '$$SOE'.length, endIdx);
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);

  const xyzLine = lines.find((l) => /X\s*=/.test(l) && /Y\s*=/.test(l) && /Z\s*=/.test(l));
  if (!xyzLine) {
    throw new HorizonsUnavailableError('Horizons response missing an X/Y/Z line');
  }
  const posMatch = xyzLine.match(/X\s*=\s*([-\d.eE+]+)\s+Y\s*=\s*([-\d.eE+]+)\s+Z\s*=\s*([-\d.eE+]+)/);
  if (!posMatch) {
    throw new HorizonsUnavailableError(`Could not parse X/Y/Z from Horizons line: ${xyzLine}`);
  }
  const x = parseFloat(posMatch[1]);
  const y = parseFloat(posMatch[2]);
  const z = parseFloat(posMatch[3]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new HorizonsUnavailableError(`Parsed non-finite X/Y/Z from Horizons line: ${xyzLine}`);
  }

  // Velocity line is optional — VEC_TABLE='1' responses (position only)
  // won't have one, and callers that don't need velocity shouldn't have to
  // fabricate a fixture line for it.
  let vx = 0, vy = 0, vz = 0;
  const vLine = lines.find((l) => /VX\s*=/.test(l) && /VY\s*=/.test(l) && /VZ\s*=/.test(l));
  if (vLine) {
    const vMatch = vLine.match(/VX\s*=\s*([-\d.eE+]+)\s+VY\s*=\s*([-\d.eE+]+)\s+VZ\s*=\s*([-\d.eE+]+)/);
    if (!vMatch) {
      throw new HorizonsUnavailableError(`Could not parse VX/VY/VZ from Horizons line: ${vLine}`);
    }
    vx = parseFloat(vMatch[1]);
    vy = parseFloat(vMatch[2]);
    vz = parseFloat(vMatch[3]);
    if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) {
      throw new HorizonsUnavailableError(`Parsed non-finite VX/VY/VZ from Horizons line: ${vLine}`);
    }
  }
  return { x, y, z, vx, vy, vz };
}

/**
 * Fetches one body's heliocentric position (AU) at `jsDate`. Any non-2xx
 * response, timeout, network error, or parse failure is normalized into a
 * single HorizonsUnavailableError so callers (ephemeris.js) have one thing
 * to catch and fall back on.
 */
export async function fetchHeliocentricPosition(bodyCode, jsDate, { timeoutMs = 4000 } = {}) {
  const startDate = formatDate(jsDate);
  const stopDate = formatDate(new Date(jsDate.getTime() + 86400000));
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${bodyCode}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@10'", // Sun-centered, geometric (no light-time correction)
    START_TIME: `'${startDate}'`,
    STOP_TIME: `'${stopDate}'`,
    STEP_SIZE: "'1d'",
    VEC_TABLE: "'2'", // position + velocity — still the cheapest table beyond position-only
    REF_PLANE: 'ECLIPTIC',
    OUT_UNITS: 'AU-D',
  });
  const requestUrl = `${HORIZONS_URL}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(requestUrl, { signal: controller.signal });
    } catch (err) {
      throw new HorizonsUnavailableError('Horizons request failed (network/timeout)', err);
    }
    if (!response.ok) {
      throw new HorizonsUnavailableError(`Horizons responded with HTTP ${response.status}`);
    }
    let json;
    try {
      json = await response.json();
    } catch (err) {
      throw new HorizonsUnavailableError('Horizons response was not valid JSON', err);
    }
    if (!json.result) {
      throw new HorizonsUnavailableError('Horizons JSON response missing "result"');
    }
    // sourceUrl carried through so ephemeris.js can record it in the cache
    // entry without rebuilding the URL itself — construction stays here.
    return { ...parseVectorsBlock(json.result), sourceUrl: requestUrl };
  } finally {
    clearTimeout(timer);
  }
}
