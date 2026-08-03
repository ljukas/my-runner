/** Pure elevation math — no React/Expo/native imports (ADR 0003). */

/** One altitude reading. Deliberately not a GPS fix: the barometer feeds this same reducer. */
export interface AltitudeSample {
  timestamp: number;
  /** Metres; null when the source carried no altitude. */
  altitudeM: number | null;
}

export type ElevationTrend = 'climbing' | 'descending' | 'flat';

/** why a parameter and not a constant: GPS needs a wide window and a ~10 m threshold to
 *  reject its own noise, while a barometer at ~1 m precision would have real terrain erased
 *  by those values. One shared pair would silently mis-tune whichever source came second. */
export interface ElevationConfig {
  medianWindow: number;
  hysteresisM: number;
}

/** Measured, not guessed — spec §3.5: at these values +-10 m noise banks 0 m of phantom
 *  gain over a 30-minute flat run while a real 40 m climb still reports 40 m. */
export const GPS_ELEVATION_CONFIG: ElevationConfig = { medianWindow: 31, hysteresisM: 10 };

/** Plain JSON by construction: the engine snapshots this (ADR 0007) once the live readout lands. */
export interface ElevationState {
  config: ElevationConfig;
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

export function createElevationState(
  config: ElevationConfig = GPS_ELEVATION_CONFIG,
): ElevationState {
  return { config, window: [], anchorM: null, gainM: 0, lossM: 0, trend: 'flat' };
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

  const window = [...state.window, raw].slice(-state.config.medianWindow);
  const smoothed = median(window);

  if (state.anchorM === null) {
    const seeded = { ...state, window, anchorM: smoothed };
    return { state: seeded, smoothedAltitudeM: smoothed, trend: seeded.trend };
  }

  const delta = smoothed - state.anchorM;
  if (Math.abs(delta) < state.config.hysteresisM) {
    const held = { ...state, window };
    return { state: held, smoothedAltitudeM: smoothed, trend: held.trend };
  }

  const banked: ElevationState = {
    config: state.config,
    window,
    anchorM: smoothed,
    gainM: delta > 0 ? state.gainM + delta : state.gainM,
    lossM: delta < 0 ? state.lossM - delta : state.lossM,
    trend: delta > 0 ? 'climbing' : 'descending',
  };
  return { state: banked, smoothedAltitudeM: smoothed, trend: banked.trend };
}

export function elevationRollup(
  samples: readonly AltitudeSample[],
  config: ElevationConfig = GPS_ELEVATION_CONFIG,
): ElevationRollup {
  let state = createElevationState(config);
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
