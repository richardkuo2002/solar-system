// The Horizons-vs-local abstraction the rest of the app actually calls.
// Render loop always reads synchronously (getPositionSync) from cache or
// local Kepler math — never blocks a frame on network. A Horizons fetch is
// fired in the background when useful and swaps into the cache once it
// resolves, picked up by a later frame.
import { fetchHeliocentricPosition } from './horizons-client.js';
import { isOnlineHint, HORIZONS_ENABLED } from '../config.js';

// JPL Horizons body codes (planet center, not barycenter) for the v1 planet set.
export const HORIZONS_CODES = {
  mercury: '199', venus: '299', earth: '399', mars: '499',
  jupiter: '599', saturn: '699', uranus: '799', neptune: '899',
};

const CACHE_BUCKET_MS = 6 * 60 * 60 * 1000; // 6-hour buckets — fine-grained enough, avoids one fetch per frame
const MAX_CACHE_ENTRIES = 5000;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60 * 1000;

const cache = new Map(); // `${bodyKey}:${bucketStartMs}` -> {x,y,z,source:'horizons'}
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
 * Synchronous position lookup for the render loop.
 *
 * @param {string} bodyKey
 * @param {Date} jsDate
 * @param {(bodyKey: string, jsDate: Date) => {x:number,y:number,z:number}} localFallbackFn
 *   Fast, pure, synchronous local computation (e.g. Kepler elements->position).
 * @returns {{x:number,y:number,z:number,source:'horizons'|'local'}}
 */
export function getPositionSync(bodyKey, jsDate, localFallbackFn) {
  const key = bucketKey(bodyKey, jsDate);
  const cached = cache.get(key);
  if (cached) return cached;

  const bodyCode = HORIZONS_CODES[bodyKey];
  if (bodyCode && isHorizonsAvailable() && !inFlight.has(key)) {
    inFlight.add(key);
    fetchHeliocentricPosition(bodyCode, jsDate)
      .then((pos) => {
        cacheSet(key, { ...pos, source: 'horizons' });
      })
      .catch(() => {
        horizonsDisabledUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      })
      .finally(() => {
        inFlight.delete(key);
      });
  }

  const localPos = localFallbackFn(bodyKey, jsDate);
  return { ...localPos, source: 'local' };
}
