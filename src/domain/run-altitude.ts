/** Pure Run elevation — no React/Expo/native imports (ADR 0003). */

import { BAROMETER_ELEVATION_CONFIG, elevationRollup, pressureAltitudeM } from './elevation';

/** Structural: a stored `run_altitude_samples` row satisfies it without importing db types. */
export interface StoredAltitudeSample {
  /** ISO-8601; receipt time on iOS, capture time on Android — both on the fixes' wall clock. */
  at: string;
  pressureHpa: number;
}

export interface TimedAltitude {
  timestamp: number;
  /** Metres above the first reported altitude. */
  relativeM: number;
}

export interface RunElevation {
  gainM: number;
  lossM: number;
  /** Chronological; starts once the reducer's window has filled. */
  series: TimedAltitude[];
}

/**
 * A Run's elevation from its barometer samples, or null when too few survived to fill the reducer's
 * window. Ignores `epoch`/`relativeAltitudeM`: the input is pressure (ADR 0015, 2026-09-29 item 2).
 */
export function runElevation(samples: readonly StoredAltitudeSample[]): RunElevation | null {
  const timed: { timestamp: number; altitudeM: number }[] = [];
  for (const sample of samples) {
    const timestamp = Date.parse(sample.at);
    if (!Number.isFinite(timestamp) || !Number.isFinite(sample.pressureHpa)) continue;
    // why: a wall-clock step backwards would fold a sample out of order into the median.
    if (timed.length > 0 && timestamp < timed[timed.length - 1].timestamp) continue;
    timed.push({ timestamp, altitudeM: pressureAltitudeM(sample.pressureHpa) });
  }

  const rollup = elevationRollup(timed, BAROMETER_ELEVATION_CONFIG);
  const series: TimedAltitude[] = [];
  rollup.seriesM.forEach((relativeM, index) => {
    if (relativeM !== null) series.push({ timestamp: timed[index].timestamp, relativeM });
  });
  if (series.length === 0) return null;

  return { gainM: rollup.gainM, lossM: rollup.lossM, series };
}
