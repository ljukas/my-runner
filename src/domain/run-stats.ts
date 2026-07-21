import type { SegmentKind } from './plan';

export interface RunStatsSegment {
  kind: SegmentKind;
  actualDurationS: number;
}

export interface RunStats {
  /** Total seconds spent in run-kind segments. */
  timeRunningS: number;
  /** Number of run-kind segments in the recorded run. */
  runIntervals: number;
  /** Longest single run-kind segment, in seconds (0 if none). */
  longestRunS: number;
}

/** Aggregates a completed run's stored segments into the summary's grid stats. */
export function runStats(segments: RunStatsSegment[]): RunStats {
  const runs = segments.filter((s) => s.kind === 'run');
  return {
    timeRunningS: runs.reduce((sum, s) => sum + s.actualDurationS, 0),
    runIntervals: runs.length,
    longestRunS: runs.reduce((max, s) => Math.max(max, s.actualDurationS), 0),
  };
}

/** A segment carrying the recorded distance the pace derivations read (`null` when GPS was off). */
export interface PaceSegment extends RunStatsSegment {
  distanceM: number | null;
}

/**
 * Pace in seconds per kilometre, derived (never stored) from a distance and a
 * duration. `null` for a degenerate input — no distance or no elapsed time — so
 * callers render a placeholder instead of a bogus `0`/`∞`.
 */
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
 * The fastest (lowest-pace) `run` segment that has a recorded distance, or `null`
 * if none qualifies — the summary's "fastest interval" highlight. Returns the
 * input element itself (reference-preserving) so the caller can flag the matching
 * row with `===`. Ties keep the earlier segment (array-order-first) — callers pass
 * segments in `seq` order for the earliest interval to win.
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
