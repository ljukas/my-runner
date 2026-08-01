/** Pure Apple Health payload mapping — no React, Expo, native or DB imports (ADR 0003 §1). */

import type { SegmentedFix } from './geo';

/**
 * CoreLocation's marker for a value it did not measure. why not 0: Health reads 0 as a real,
 * measured zero — a stationary runner with perfect accuracy — where a negative reads as unknown.
 */
export const CL_UNKNOWN = -1;

/** A route point with every field HealthKit's `LocationForSaving` requires non-null (spec §3.2). */
export interface HealthRoutePoint {
  latitude: number;
  longitude: number;
  /** Epoch ms; the adapter converts to `Date` at the library boundary. */
  timestamp: number;
  altitude: number;
  course: number;
  speed: number;
  horizontalAccuracy: number;
  verticalAccuracy: number;
}

export function toHealthRoute(fixes: readonly SegmentedFix[]): HealthRoutePoint[] {
  return (
    fixes
      .filter((fix) => Number.isFinite(fix.timestamp))
      // HealthKit walks this as a path; `seq` is arrival order and can disagree with the fix's own clock (spec §5.1).
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((fix) => ({
        latitude: fix.lat,
        longitude: fix.lng,
        timestamp: fix.timestamp,
        altitude: fix.altitude ?? 0,
        horizontalAccuracy: fix.accuracy ?? CL_UNKNOWN,
        speed: fix.speed ?? CL_UNKNOWN,
        // Never recorded: run_points has no course or vertical-accuracy column (spec §5.1).
        course: CL_UNKNOWN,
        verticalAccuracy: CL_UNKNOWN,
      }))
  );
}

/** One interval's distance over its true wall-clock window. */
export interface HealthDistanceSample {
  startedAt: number;
  endedAt: number;
  meters: number;
}

/** The stored run fields Health needs; `startedAt`/`endedAt` are ISO-8601 UTC as persisted. */
export interface HealthRunInput {
  id: string;
  startedAt: string;
  endedAt: string;
  distanceM: number | null;
}

export interface HealthSegmentInput {
  seq: number;
  distanceM: number | null;
}

/** The platform-neutral payload crossing the HealthAdapter port (ADR 0011 §1). */
export interface HealthWorkoutInput {
  startedAt: number;
  endedAt: number;
  totalDistanceM: number | null;
  segmentSamples: HealthDistanceSample[];
  route: HealthRoutePoint[];
  /** The run's own id, reused as HealthKit's sync identifier so a retry replaces rather than duplicates. */
  syncIdentifier: string;
}

/**
 * why windows come from the fixes and not from `actual_duration_s`: segment durations exclude
 * paused time, so prefix-summing them would date every sample after a pause wrongly. A segment's
 * own points carry the true wall clock (spec §5.2).
 */
export function toHealthSegmentSamples(
  segments: readonly HealthSegmentInput[],
  fixes: readonly SegmentedFix[],
): HealthDistanceSample[] {
  const windows = new Map<number, { first: number; last: number }>();
  for (const fix of fixes) {
    // A single corrupt timestamp must not poison the whole window: Math.min/max propagate NaN permanently.
    if (!Number.isFinite(fix.timestamp)) continue;
    const window = windows.get(fix.segmentSeq);
    if (window) {
      window.first = Math.min(window.first, fix.timestamp);
      window.last = Math.max(window.last, fix.timestamp);
    } else {
      windows.set(fix.segmentSeq, { first: fix.timestamp, last: fix.timestamp });
    }
  }

  const samples: HealthDistanceSample[] = [];
  for (const segment of segments) {
    const window = windows.get(segment.seq);
    if (!window || !hasMeasurableDistance(segment.distanceM)) continue;
    samples.push({ startedAt: window.first, endedAt: window.last, meters: segment.distanceM });
  }
  return samples;
}

// null covers GPS off; a negative or Infinity value is equally unusable and would serialize to null
// across the bridge boundary anyway, so require a real, finite, positive distance.
function hasMeasurableDistance(distanceM: number | null): distanceM is number {
  return distanceM !== null && Number.isFinite(distanceM) && distanceM > 0;
}

export function toHealthWorkout(
  run: HealthRunInput,
  segments: readonly HealthSegmentInput[],
  fixes: readonly SegmentedFix[],
): HealthWorkoutInput {
  return {
    startedAt: Date.parse(run.startedAt),
    endedAt: Date.parse(run.endedAt),
    totalDistanceM: run.distanceM,
    segmentSamples: toHealthSegmentSamples(segments, fixes),
    route: toHealthRoute(fixes),
    syncIdentifier: run.id,
  };
}
