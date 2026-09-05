// Real-unit conversion constants — NOT display compression. Keep this
// separate from core/scale.js, which is exclusively nonlinear DISPLAY
// compression curves (compressDistance/compressSize/etc): mixing a real
// physical constant into that file would invite someone to reach for it
// when they actually need a scene-unit curve, or vice versa.

/** 1 AU in kilometers (IAU-defined exact value). */
export const KM_PER_AU = 149597870.7;

export const AU_PER_KM = 1 / KM_PER_AU;

/** Speed of light in AU/day (≈173.1446) — derived from the exact c in
 *  km/s rather than hardcoding the rounded figure. v1.6: annual
 *  aberration (analysis/observer.js). */
export const C_AU_PER_DAY = 299792.458 * 86400 * AU_PER_KM;
