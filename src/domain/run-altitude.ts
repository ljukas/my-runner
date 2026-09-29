/** Pure Run elevation — no React/Expo/native imports (ADR 0003). */

import { BAROMETER_ELEVATION_CONFIG, elevationRollup, pressureAltitudeM } from './elevation';

/** Structural: a stored `run_altitude_samples` row satisfies it without importing db types. */
export interface StoredAltitudeSample {
  /** ISO-8601; receipt time on iOS, capture time on Android — both on the fixes' wall clock. */
  at: string;
  pressureHpa: number;
}

/** Structural: the engine's `RunEvent`, as `runs.event_log_json` stores it. */
export interface LoggedRunEvent {
  type: string;
  at: number;
}

// why lenient: a run saved before the event log was persisted carries none, and a malformed log
// must cost the pause adjustment, never the rest of the summary or the export.
export function parseEventLog(json: string | null): LoggedRunEvent[] {
  if (!json) return [];
  try {
    const events: unknown = JSON.parse(json);
    if (!Array.isArray(events)) return [];
    return events.filter(
      (event): event is LoggedRunEvent =>
        typeof event?.type === 'string' && Number.isFinite(event?.at),
    );
  } catch {
    return [];
  }
}

/** Epoch ms; `toMs` is Infinity for a pause the run ended in. */
export interface PausedInterval {
  fromMs: number;
  toMs: number;
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

/** The runner-initiated pauses in an event log, which a `skip` inside does not split. */
export function pausedIntervals(events: readonly LoggedRunEvent[]): PausedInterval[] {
  const intervals: PausedInterval[] = [];
  let pausedAt: number | null = null;
  for (const event of events) {
    if (event.type === 'pause' && pausedAt === null) pausedAt = event.at;
    if (event.type === 'resume' && pausedAt !== null) {
      intervals.push({ fromMs: pausedAt, toMs: event.at });
      pausedAt = null;
    }
  }
  if (pausedAt !== null) intervals.push({ fromMs: pausedAt, toMs: Infinity });
  return intervals;
}

/**
 * A Run's elevation from its barometer samples, or null when too few survived to fill the reducer's
 * window. Ignores `epoch`/`relativeAltitudeM`: the input is pressure (ADR 0015, 2026-09-29 item 2).
 * Drops samples inside `pauses` and rebases the altitude across each (item 3).
 */
export function runElevation(
  samples: readonly StoredAltitudeSample[],
  pauses: readonly PausedInterval[] = [],
): RunElevation | null {
  const timed: { timestamp: number; altitudeM: number }[] = [];
  let lastTimestamp = -Infinity;
  let offsetM = 0;
  for (const sample of samples) {
    const parsed = Date.parse(sample.at);
    if (!Number.isFinite(parsed) || !Number.isFinite(sample.pressureHpa)) continue;
    // why clamped rather than dropped: rows arrive in `seq` order, so a wall-clock step backwards
    // leaves the pressure valid and in order — only its timestamp is wrong, and only for bucketing.
    const timestamp = Math.max(parsed, lastTimestamp);
    lastTimestamp = timestamp;
    if (pauses.some((pause) => timestamp >= pause.fromMs && timestamp < pause.toMs)) continue;

    const rawM = pressureAltitudeM(sample.pressureHpa);
    const previous = timed.at(-1);
    if (
      previous &&
      pauses.some((pause) => pause.fromMs >= previous.timestamp && pause.toMs <= timestamp)
    ) {
      offsetM = previous.altitudeM - rawM;
    }
    timed.push({ timestamp, altitudeM: rawM + offsetM });
  }

  const rollup = elevationRollup(timed, BAROMETER_ELEVATION_CONFIG);
  const series: TimedAltitude[] = [];
  rollup.seriesM.forEach((relativeM, index) => {
    if (relativeM !== null) series.push({ timestamp: timed[index].timestamp, relativeM });
  });
  if (series.length === 0) return null;

  return { gainM: rollup.gainM, lossM: rollup.lossM, series };
}
