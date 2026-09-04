// The Horizons-vs-Kepler resolver — every position lookup in the app goes
// through getBodyState (planets/comets/dwarf-planets) or sunBodyState
// (the Sun), and gets back one normalized body-state object (see
// core/body-state.js) regardless of which source actually produced it.
// Render loop always reads synchronously — never blocks a frame on
// network. A Horizons fetch is fired in the background when useful and
// swaps into the cache once it resolves, picked up by a later frame; no
// caller ever synchronously observes a fetch that just resolved, so
// `source: 'horizons-live'` is a documented-but-structurally-unreachable
// value in this architecture (see docs/accuracy.md) — only
// 'horizons-cache' or 'kepler' are ever actually returned.
import { fetchHeliocentricPosition } from './horizons-client.js';
import { elementsAtDate, julianDateFromDate, elementsVelocity } from './orbital-elements.js';
import { elementsToPosition } from './kepler.js';
import { createBodyState } from './body-state.js';
import { isOnlineHint, HORIZONS_ENABLED } from '../config.js';

// JPL Horizons body codes (planet center, not barycenter) for the v1 planet set.
// Deliberately not extended to Sun/moons/comets/Pluto — see docs/accuracy.md;
// those bodies always report source:'kepler', quality:'approximate' honestly
// rather than gaining new Horizons providers.
export const HORIZONS_CODES = {
  mercury: '199', venus: '299', earth: '399', mars: '499',
  jupiter: '599', saturn: '699', uranus: '799', neptune: '899',
};

const STANDISH_VALIDITY = { startUtc: '1800-01-01T00:00:00Z', endUtc: '2050-01-01T00:00:00Z', note: 'Standish (1992) table valid range' };

const CACHE_BUCKET_MS = 6 * 60 * 60 * 1000; // 6-hour buckets — fine-grained enough, avoids one fetch per frame
const MAX_CACHE_ENTRIES = 5000;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60 * 1000;

const cache = new Map(); // `${bodyKey}:${bucketStartMs}` -> {x,y,z,vx,vy,vz,fetchedAtMs,sourceUrl}
const inFlight = new Set(); // cache keys currently being fetched, avoids duplicate requests
let horizonsDisabledUntil = 0;

function bucketKey(bodyKey, jsDate) {
  const bucketed = Math.floor(jsDate.getTime() / CACHE_BUCKET_MS) * CACHE_BUCKET_MS;
  return `${bodyKey}:${bucketed}`;
}

function cacheSet(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value); // drop the oldest entry (insertion order)
  }
  cache.set(key, value);
}

export function isHorizonsAvailable() {
  // Coerced with !! so this always returns a real boolean, not whatever the
  // last operand of the && chain happened to be — a previous bug in
  // isOnlineHint() returned `undefined` here instead of `false` on Node 21+
  // (which defines `navigator` but not `navigator.onLine`), silently
  // skipping every Horizons attempt with no error.
  return !!(HORIZONS_ENABLED && isOnlineHint() && Date.now() >= horizonsDisabledUntil);
}

/** Test/debug hook: force the circuit breaker open or closed. */
export function resetCircuitBreaker() {
  horizonsDisabledUntil = 0;
}

/**
 * Synchronous, normalized body-state lookup for the render loop — the one
 * function planets/comets/dwarf-planets all go through.
 *
 * @param {string} bodyKey
 * @param {Date} jsDate
 * @param {object} baseElements  raw [value,rate] Standish-table shape
 *   (PLANETS[key].elements / COMETS[key].elements / DWARF_PLANETS[key].elements)
 * @returns {object} body-state (see core/body-state.js) — every field
 *   populated, never null/undefined, for every body this supports.
 */
export function getBodyState(bodyKey, jsDate, baseElements) {
  const epochJd = julianDateFromDate(jsDate);
  const epochUtc = jsDate.toISOString();
  const key = bucketKey(bodyKey, jsDate);
  const cached = cache.get(key);
  if (cached) {
    return createBodyState({
      bodyId: bodyKey, epochJd, epochUtc,
      source: 'horizons-cache', sourceDetail: 'JPL Horizons API (cached)',
      quality: 'authoritative',
      positionAu: { x: cached.x, y: cached.y, z: cached.z },
      velocityAuPerDay: { x: cached.vx, y: cached.vy, z: cached.vz },
      validity: {
        startUtc: null, endUtc: null,
        note: `fetched ${new Date(cached.fetchedAtMs).toISOString()} from ${cached.sourceUrl}`,
      },
    });
  }

  const bodyCode = HORIZONS_CODES[bodyKey];
  if (bodyCode && isHorizonsAvailable() && !inFlight.has(key)) {
    inFlight.add(key);
    fetchHeliocentricPosition(bodyCode, jsDate)
      .then((pos) => {
        cacheSet(key, { ...pos, fetchedAtMs: Date.now() });
      })
      .catch(() => {
        horizonsDisabledUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      })
      .finally(() => {
        inFlight.delete(key);
      });
  }

  const els = elementsAtDate(baseElements, epochJd);
  return createBodyState({
    bodyId: bodyKey, epochJd, epochUtc,
    source: 'kepler', sourceDetail: 'Kepler propagation (Standish 1992 elements)',
    quality: 'approximate',
    positionAu: elementsToPosition(els),
    velocityAuPerDay: elementsVelocity(baseElements, epochJd),
    validity: STANDISH_VALIDITY,
  });
}

/**
 * The Sun sits at the exact origin of this heliocentric frame by
 * definition — not propagated, not looked up. Doesn't go through
 * getBodyState: it has no `elements` and no Horizons code.
 */
export function sunBodyState(jsDate) {
  const epochJd = julianDateFromDate(jsDate);
  return createBodyState({
    bodyId: 'sun', epochJd, epochUtc: jsDate.toISOString(),
    source: 'kepler', sourceDetail: 'Heliocentric origin (Sun defines the center of this frame)',
    quality: 'authoritative',
    positionAu: { x: 0, y: 0, z: 0 },
    velocityAuPerDay: { x: 0, y: 0, z: 0 },
    validity: { startUtc: null, endUtc: null, note: 'Exact by definition, not propagated' },
  });
}
