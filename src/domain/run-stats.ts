import { MIN_MEASURED_SPEED_MPS } from './geo';
import type { SegmentKind } from './plan';
import type { StoredSegmentKind } from './run-motion';

export interface RunStatsSegment {
  kind: SegmentKind;
  actualDurationS: number;
}

export interface RunStats {
  /** Total seconds spent in run-kind segments. */
  timeRunningS: number;
}

/** Aggregates a completed run's stored segments into the summary's grid stats. */
export function runStats(segments: RunStatsSegment[]): RunStats {
  const runs = segments.filter((s) => s.kind === 'run');
  return {
    timeRunningS: runs.reduce((sum, s) => sum + s.actualDurationS, 0),
  };
}

/** A segment plus its recorded distance; `distanceM` is null when GPS was off. */
export interface PaceSegment extends RunStatsSegment {
  distanceM: number | null;
}

/**
 * Whether a recorded distance represents movement worth presenting, rather than drift that cleared
 * the deadband — see `MIN_MEASURED_SPEED_MPS`. Callers hide distance, pace and splits when false.
 */
export function hasMeasuredDistance(
  distanceM: number | null,
  durationS: number,
): distanceM is number {
  if (distanceM === null || durationS <= 0) return false;
  return distanceM / durationS >= MIN_MEASURED_SPEED_MPS;
}

/** Pace in seconds per km; null for degenerate input (no distance or no time) so callers show a placeholder. */
export function paceSecPerKm(distanceM: number, durationS: number): number | null {
  if (distanceM <= 0 || durationS <= 0) return null;
  return (durationS / distanceM) * 1000;
}

/** Pace for one stored segment; `null` when it lacks a recorded distance or a valid pace. */
export function segmentPaceSecPerKm(segment: PaceSegment): number | null {
  if (segment.distanceM === null) return null;
  return paceSecPerKm(segment.distanceM, segment.actualDurationS);
}

/**
 * Fastest (lowest-pace) `run` segment with a recorded distance, or null. Returns the
 * input element itself so callers can flag the row by `===`; ties keep the earlier segment.
 */
export function bestRunSegment<T extends PaceSegment>(segments: T[]): T | null {
  let best: T | null = null;
  let bestPace: number | null = null;
  for (const segment of segments) {
    if (segment.kind !== 'run') continue;
    const pace = segmentPaceSecPerKm(segment);
    if (pace === null) continue;
    if (bestPace === null || pace < bestPace) {
      best = segment;
      bestPace = pace;
    }
  }
  return best;
}

export interface BucketSegment {
  kind: StoredSegmentKind;
  actualDurationS: number;
  distanceM: number | null;
}

/** Paces in s/km (null without distance or time); `movingTimeS` is run + walk time. */
export interface BucketStats {
  runPaceSecPerKm: number | null;
  walkPaceSecPerKm: number | null;
  movingPaceSecPerKm: number | null;
  movingTimeS: number;
}

/**
 * A free run's paces (ADR 0026 §5): each is summed distance over summed time, and stopped buckets —
 * time and drift alike — are in none of them.
 */
export function bucketStats(segments: readonly BucketSegment[]): BucketStats {
  const total = (kind: 'run' | 'walk') =>
    segments
      .filter((s) => s.kind === kind)
      .reduce((sum, s) => ({ s: sum.s + s.actualDurationS, m: sum.m + (s.distanceM ?? 0) }), {
        s: 0,
        m: 0,
      });
  const run = total('run');
  const walk = total('walk');
  return {
    runPaceSecPerKm: paceSecPerKm(run.m, run.s),
    walkPaceSecPerKm: paceSecPerKm(walk.m, walk.s),
    movingPaceSecPerKm: paceSecPerKm(run.m + walk.m, run.s + walk.s),
    movingTimeS: run.s + walk.s,
  };
}
