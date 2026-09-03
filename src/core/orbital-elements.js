// Time propagation of Standish-1992-style osculating elements (value + rate
// per Julian century) into the {a,e,i,om,w,meanAnomalyRad} shape kepler.js
// expects. Pure math, Node-testable.

import { normalizeAngle } from './kepler.js';
import { compressMoonOrbit } from './scale.js';

const J2000_JD = 2451545.0;
const MS_PER_DAY = 86400000;
const DEG_TO_RAD = Math.PI / 180;

/** Julian Date for a JS Date. */
export function julianDateFromDate(jsDate) {
  return jsDate.getTime() / MS_PER_DAY + 2440587.5;
}

function at(pair, T) {
  const [value, ratePerCentury] = pair;
  return value + ratePerCentury * T;
}

/**
 * Propagate one planet's base elements (each an [value, rate/century] pair,
 * angles in degrees per the Standish table convention) to the given Julian
 * Date, returning the {a, e, i, om, w, meanAnomalyRad} shape kepler.js's
 * elementsToPosition expects (angles in radians).
 */
export function elementsAtDate(baseElements, julianDate) {
  const T = (julianDate - J2000_JD) / 36525;
  const { a, e, i, L, wBar, om } = baseElements;

  const aAtT = at(a, T);
  const eAtT = at(e, T);
  const iDeg = at(i, T);
  const LDeg = at(L, T);
  const wBarDeg = at(wBar, T);
  const omDeg = at(om, T);

  const wDeg = wBarDeg - omDeg;
  const meanAnomalyDeg = LDeg - wBarDeg;

  return {
    a: aAtT,
    e: eAtT,
    i: iDeg * DEG_TO_RAD,
    om: omDeg * DEG_TO_RAD,
    w: wDeg * DEG_TO_RAD,
    meanAnomalyRad: normalizeAngle(meanAnomalyDeg * DEG_TO_RAD),
  };
}

/**
 * Angle (radians, [0, 2*PI)) for a simple circular orbit given how many
 * days have elapsed since an arbitrary epoch and the orbital period —
 * used for v1 moons (data/moons.js), which use a near-circular
 * approximation rather than full Standish-table elements.
 */
export function circularOrbitAngle(daysSinceEpoch, periodDays) {
  return normalizeAngle((daysSinceEpoch / periodDays) * 2 * Math.PI);
}

/**
 * Local-space (parent-relative) scene position for a moon at `currentJD`,
 * using the circular-orbit approximation above + scale.js's
 * compressMoonOrbit. Pure — safe to keep in core/ (no THREE import) so
 * render/bodies.js just calls this instead of duplicating the math in a
 * THREE-importing file where it couldn't be Node-tested.
 */
export function moonLocalPosition(moonData, parentRadiusKm, parentSceneRadius, currentJD, epochJD) {
  const angle = circularOrbitAngle(currentJD - epochJD, moonData.periodDays);
  const r = compressMoonOrbit(moonData.orbitKm, parentRadiusKm, parentSceneRadius);
  return { x: r * Math.cos(angle), y: 0, z: r * Math.sin(angle) };
}
