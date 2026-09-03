// Simulated clock: holds a *simulated* date (not wall-clock), independent
// of rendering. Pure/immutable-returning so it stays trivially Node-testable
// — callers own the single mutable `timeState` variable and pass in
// `realDeltaSeconds` themselves (this module never touches
// performance.now()/Date.now() for elapsed time).

const MS_PER_DAY = 86400000;

export function createTimeController({ startDate = new Date(), speedDaysPerSecond = 1 } = {}) {
  return {
    currentDate: new Date(startDate.getTime()),
    speedDaysPerSecond,
    playing: false,
    direction: 1,
  };
}

/** Advance currentDate by direction * speedDaysPerSecond * realDeltaSeconds days. No-op if paused. */
export function tick(state, realDeltaSeconds) {
  if (!state.playing) return state;
  const deltaMs = state.direction * state.speedDaysPerSecond * realDeltaSeconds * MS_PER_DAY;
  return { ...state, currentDate: new Date(state.currentDate.getTime() + deltaMs) };
}

export function play(state) {
  return { ...state, playing: true };
}

export function pause(state) {
  return { ...state, playing: false };
}

export function togglePlayPause(state) {
  return { ...state, playing: !state.playing };
}

export function setSpeed(state, daysPerSecond) {
  return { ...state, speedDaysPerSecond: daysPerSecond };
}

export function reverse(state) {
  return { ...state, direction: state.direction * -1 };
}

/** Set currentDate directly; keeps playing/speed/direction unchanged. */
export function jumpToDate(state, jsDate) {
  return { ...state, currentDate: new Date(jsDate.getTime()) };
}
