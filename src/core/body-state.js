// Canonical position-with-provenance shape every ephemeris source
// normalizes into — render/ and the HUD consume only this, never Kepler
// elements or a raw Horizons response directly. Pure factory, no
// validation ceremony: the handful of call sites that construct these
// (core/ephemeris.js's Kepler path, its Horizons-cache path, its Sun
// helper) all live in this codebase and are easy to keep honest by
// inspection — no runtime schema library needed for 3 fixed producers.
//
// See docs/accuracy.md for what each field means in practice (which
// bodies get which `source`/`quality`, what's NOT modeled, etc).

export const CENTER_SUN = 'SUN';
export const FRAME_ECLIPJ2000 = 'ECLIPJ2000';

/**
 * @param {object} fields
 * @param {string} fields.bodyId
 * @param {number} fields.epochJd
 * @param {string} fields.epochUtc
 * @param {string} [fields.center]
 * @param {string} [fields.frame]
 * @param {'horizons-live'|'horizons-cache'|'kepler'} fields.source
 * @param {string} fields.sourceDetail
 * @param {'authoritative'|'fitted'|'approximate'} fields.quality
 * @param {{x:number,y:number,z:number}} fields.positionAu
 * @param {{x:number,y:number,z:number}} fields.velocityAuPerDay
 * @param {{startUtc:?string,endUtc:?string,note:?string}} [fields.validity]
 * @returns {object} the body-state contract object
 */
export function createBodyState({
  bodyId, epochJd, epochUtc, center = CENTER_SUN, frame = FRAME_ECLIPJ2000,
  source, sourceDetail, quality, positionAu, velocityAuPerDay,
  validity = { startUtc: null, endUtc: null, note: null },
}) {
  return {
    bodyId, epochJd, epochUtc, center, frame,
    source, sourceDetail, quality, positionAu, velocityAuPerDay, validity,
  };
}
