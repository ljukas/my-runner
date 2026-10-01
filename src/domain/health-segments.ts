/** Pure Health workout segmentation — no React, Expo, native or DB imports (ADR 0003 §1). */

import { wallClockAtActive } from './active-time';
import { pausedIntervals, type LoggedRunEvent } from './run-altitude';
import type { StoredSegmentKind } from './run-motion';
import type { RunStatsSegment } from './run-stats';

export type WorkoutActivity = 'running' | 'walking' | 'resting';

/** Epoch ms; `endedAt` is always later than `startedAt`. */
export interface WorkoutWindow {
  startedAt: number;
  endedAt: number;
}

export interface WorkoutSegment extends WorkoutWindow {
  activity: WorkoutActivity;
}

/** Structural: a stored `run_segments` row satisfies it without importing db types. */
export interface SegmentRow extends RunStatsSegment {
  seq: number;
}

// per ADR 0026 §8: a plan run's warm-up and cool-down are walks.
const ACTIVITY: Record<StoredSegmentKind, WorkoutActivity> = {
  warmup: 'walking',
  walk: 'walking',
  cooldown: 'walking',
  run: 'running',
  stopped: 'resting',
};

/** The runner's pauses, clamped to the workout; one the log ended in runs to the workout's end. */
export function pauseWindows(
  events: readonly LoggedRunEvent[],
  workout: WorkoutWindow,
): WorkoutWindow[] {
  const windows: WorkoutWindow[] = [];
  for (const pause of pausedIntervals(events)) {
    const startedAt = Math.max(pause.fromMs, workout.startedAt);
    const endedAt = Math.min(pause.toMs, workout.endedAt);
    if (endedAt > startedAt) windows.push({ startedAt, endedAt });
  }
  return windows;
}

/**
 * Each stored segment's active time as wall-clock windows (ADR 0026 §8): split at pauses, clamped
 * to the workout, in order, never overlapping, never empty. A tail the rows fall short of stays
 * uncovered; without an event log the rows are laid from the start with no pauses.
 */
export function segmentWindows(
  rows: readonly SegmentRow[],
  events: readonly LoggedRunEvent[],
  workout: WorkoutWindow,
): WorkoutSegment[] {
  const log = events.length > 0 ? events : [{ type: 'start', at: workout.startedAt }];
  const pauses = pauseWindows(log, workout);
  const segments: WorkoutSegment[] = [];
  let lastEnd = workout.startedAt;
  const push = (activity: WorkoutActivity, startedAt: number, endedAt: number) => {
    if (endedAt <= startedAt) return;
    segments.push({ activity, startedAt, endedAt });
    lastEnd = endedAt;
  };

  let activeS = 0;
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    const fromS = activeS;
    activeS += Math.max(0, row.actualDurationS);
    // why Infinity: null means a log that ended paused never reached that active time.
    let cursor = Math.max(wallClockAtActive(log, fromS) ?? Infinity, lastEnd);
    const end = Math.min(wallClockAtActive(log, activeS) ?? Infinity, workout.endedAt);
    const activity = ACTIVITY[row.kind];
    for (const pause of pauses) {
      if (pause.endedAt <= cursor) continue;
      if (pause.startedAt >= end) break;
      push(activity, cursor, pause.startedAt);
      cursor = pause.endedAt;
    }
    push(activity, cursor, end);
  }
  return segments;
}
