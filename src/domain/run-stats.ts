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
