import { activeElapsedMs, wallClockAtActive } from './active-time';
import { OPEN_LIMITS } from './free-run';
import type { LatLng, LocationFix } from './geo';
import { pausedIntervals, type LoggedRunEvent } from './run-altitude';
import { rollupOpenTrack, type MotionBucket } from './run-motion';

export interface OpenRunInput {
  /** The run's event log; it ends at its last event, whether or not that is an `end`. */
  events: readonly LoggedRunEvent[];
  /** Its accepted fixes, in `seq` order. */
  fixes: readonly LocationFix[];
  thresholdMps: number;
}

export interface DerivedOpenRun {
  outcome: 'save' | 'discard';
  endMs: number;
  activeDurationS: number;
  /** The log as saved: cut at `endMs`, which its `end` event now carries. */
  events: LoggedRunEvent[];
  buckets: MotionBucket[];
  distanceM: number;
  points: LatLng[];
}

function cutAt(events: readonly LoggedRunEvent[], atMs: number): LoggedRunEvent[] {
  return [
    ...events.filter((event) => event.type !== 'end' && event.at <= atMs),
    { type: 'end', at: atMs },
  ];
}

function fold(
  events: readonly LoggedRunEvent[],
  fixes: readonly LocationFix[],
  thresholdMps: number,
) {
  const startMs = events[0].at;
  const endMs = events[events.length - 1].at;
  return rollupOpenTrack(fixes, { thresholdMps, paused: pausedIntervals(events), startMs, endMs });
}

/**
 * How a finished free run is saved — the one place its end is settled, whether the runner ended
 * it, a limit did, or it was abandoned at launch (ADR 0026 §3, §6): capped at 4 h of active time,
 * a trailing stop of 30 min or more trimmed back to where the moving ended, and discarded when
 * what is left is under a minute.
 */
export function deriveOpenRun({ events, fixes, thresholdMps }: OpenRunInput): DerivedOpenRun {
  const endAt = events[events.length - 1].at;
  let log = cutAt(events, endAt);
  if (activeElapsedMs(log, endAt) > OPEN_LIMITS.capActiveS * 1000) {
    log = cutAt(log, wallClockAtActive(log, OPEN_LIMITS.capActiveS) ?? endAt);
  }

  let rollup = fold(log, fixes, thresholdMps);
  const last = rollup.buckets.at(-1);
  if (last?.kind === 'stopped' && last.activeS >= OPEN_LIMITS.stoppedLimitS) {
    log = cutAt(log, last.startMs);
    rollup = fold(log, fixes, thresholdMps);
  }

  const endMs = log[log.length - 1].at;
  const activeDurationS =
    rollup.buckets.length > 0
      ? rollup.buckets.reduce((sum, bucket) => sum + bucket.durationS, 0)
      : Math.round(activeElapsedMs(log, endMs) / 1000);
  return {
    outcome: activeDurationS < OPEN_LIMITS.minActiveS ? 'discard' : 'save',
    endMs,
    activeDurationS,
    events: log,
    buckets: rollup.buckets,
    distanceM: rollup.distanceM,
    points: rollup.points,
  };
}
