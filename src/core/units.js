// Real-unit conversion constants — NOT display compression. Keep this
// separate from core/scale.js, which is exclusively nonlinear DISPLAY
// compression curves (compressDistance/compressSize/etc): mixing a real
// physical constant into that file would invite someone to reach for it
// when they actually need a scene-unit curve, or vice versa.

/** 1 AU in kilometers (IAU-defined exact value). */
export const KM_PER_AU = 149597870.7;

export const AU_PER_KM = 1 / KM_PER_AU;
