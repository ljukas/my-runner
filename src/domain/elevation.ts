/** Pure elevation math — no React/Expo/native imports (ADR 0003). */

import { median } from './math';

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

/** Measured, not guessed (spec §3.5): +-10 m noise banks 0.00 m of phantom gain over 200 seeds of a
 *  flat 30-minute run, while a real 40 m climb still reports 40 m. why not narrower once warm-up was
 *  fixed: window 25 still admits a 10 m worst case and 21 a 21 m one. */
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
  /** null until the median window has filled, and for a sample carrying no altitude. */
  smoothedAltitudeM: number | null;
}

export interface ElevationRollup {
  gainM: number;
  lossM: number;
  /** Index-aligned with the input; rebased so the first reported altitude reads 0, null wherever `elevationStep` reported none. */
  seriesM: (number | null)[];
}

export function createElevationState(
  config: ElevationConfig = GPS_ELEVATION_CONFIG,
): ElevationState {
  return { config, window: [], anchorM: null, gainM: 0, lossM: 0, trend: 'flat' };
}

export function elevationStep(state: ElevationState, sample: AltitudeSample): ElevationStep {
  const raw = sample.altitudeM;
  if (raw === null || !Number.isFinite(raw)) return { state, smoothedAltitudeM: null };

  const window = [...state.window, raw].slice(-state.config.medianWindow);

  // why nothing until the window fills: altitude is worst at acquisition, and a partial median lets
  // one bad opening reading become the anchor AND the rebase base (3.56 m mean phantom gain, 22.38
  // worst, over 200 seeds — spec §9.2).
  if (window.length < state.config.medianWindow) {
    return { state: { ...state, window }, smoothedAltitudeM: null };
  }

  const smoothed = median(window);

  if (state.anchorM === null) {
    return { state: { ...state, window, anchorM: smoothed }, smoothedAltitudeM: smoothed };
  }

  const delta = smoothed - state.anchorM;
  if (Math.abs(delta) < state.config.hysteresisM) {
    return { state: { ...state, window }, smoothedAltitudeM: smoothed };
  }

  const banked: ElevationState = {
    config: state.config,
    window,
    anchorM: smoothed,
    gainM: delta > 0 ? state.gainM + delta : state.gainM,
    lossM: delta < 0 ? state.lossM - delta : state.lossM,
    trend: delta > 0 ? 'climbing' : 'descending',
  };
  return { state: banked, smoothedAltitudeM: smoothed };
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
