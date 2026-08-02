/** Pure elevation math — no React/Expo/native imports (ADR 0003). */

/** One altitude reading. Deliberately not a GPS fix: the barometer feeds this same reducer. */
export interface AltitudeSample {
  timestamp: number;
  /** Metres; null when the source carried no altitude. */
  altitudeM: number | null;
}

export type ElevationTrend = 'climbing' | 'descending' | 'flat';

/** Widened from 5 to 8 (and, being even, its median averages two middle readings rather than
 * picking one): at 5, 600 samples of ±10 m sinusoidal noise (the 'noisy flat ground' test)
 * aliased into a slow drift the hysteresis below couldn't catch, banking 247 m of gain. */
export const ALTITUDE_MEDIAN_WINDOW = 8;
/** A move must clear this monotonically before it is banked — the guard against GPS
 * vertical noise (~15-50 m) inflating cumulative gain (ADR 0015). Tunable; paired with
 * ALTITUDE_MEDIAN_WINDOW above against the same noisy-flat failure — see task-2-report.md. */
export const ELEVATION_HYSTERESIS_M = 2;

/** Plain JSON by construction: the engine snapshots this (ADR 0007) once the live readout lands. */
export interface ElevationState {
  window: number[];
  anchorM: number | null;
  gainM: number;
  lossM: number;
  trend: ElevationTrend;
}

export interface ElevationStep {
  state: ElevationState;
  smoothedAltitudeM: number | null;
  trend: ElevationTrend;
}

export interface ElevationRollup {
  gainM: number;
  lossM: number;
  /** Smoothed and rebased so the first known altitude reads 0; null where the sample had none. */
  seriesM: (number | null)[];
}

export function createElevationState(): ElevationState {
  return { window: [], anchorM: null, gainM: 0, lossM: 0, trend: 'flat' };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function elevationStep(state: ElevationState, sample: AltitudeSample): ElevationStep {
  const raw = sample.altitudeM;
  if (raw === null || !Number.isFinite(raw)) {
    return { state, smoothedAltitudeM: null, trend: state.trend };
  }

  const window = [...state.window, raw].slice(-ALTITUDE_MEDIAN_WINDOW);
  const smoothed = median(window);

  if (state.anchorM === null) {
    const seeded = { ...state, window, anchorM: smoothed };
    return { state: seeded, smoothedAltitudeM: smoothed, trend: seeded.trend };
  }

  const delta = smoothed - state.anchorM;
  if (Math.abs(delta) < ELEVATION_HYSTERESIS_M) {
    const held = { ...state, window };
    return { state: held, smoothedAltitudeM: smoothed, trend: held.trend };
  }

  const banked: ElevationState = {
    window,
    anchorM: smoothed,
    gainM: delta > 0 ? state.gainM + delta : state.gainM,
    lossM: delta < 0 ? state.lossM - delta : state.lossM,
    trend: delta > 0 ? 'climbing' : 'descending',
  };
  return { state: banked, smoothedAltitudeM: smoothed, trend: banked.trend };
}

export function elevationRollup(samples: readonly AltitudeSample[]): ElevationRollup {
  let state = createElevationState();
  const smoothed: (number | null)[] = [];

  for (const sample of samples) {
    const step = elevationStep(state, sample);
    state = step.state;
    smoothed.push(step.smoothedAltitudeM);
  }

  // why rebase: absolute GPS altitude carries a bias of tens of metres, so only the
  // profile's shape is honest (ADR 0015 item 1).
  const base = smoothed.find((value) => value !== null) ?? null;
  return {
    gainM: state.gainM,
    lossM: state.lossM,
    seriesM: base === null ? smoothed : smoothed.map((v) => (v === null ? null : v - base)),
  };
}
