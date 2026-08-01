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
  return fixes.map((fix) => ({
    latitude: fix.lat,
    longitude: fix.lng,
    timestamp: fix.timestamp,
    altitude: fix.altitude ?? 0,
    horizontalAccuracy: fix.accuracy ?? CL_UNKNOWN,
    speed: fix.speed ?? CL_UNKNOWN,
    // Never recorded: run_points has no course or vertical-accuracy column (spec §5.1).
    course: CL_UNKNOWN,
    verticalAccuracy: CL_UNKNOWN,
  }));
}

/** One interval's distance over its true wall-clock window. */
export interface HealthDistanceSample {
  startedAt: number;
  endedAt: number;
  meters: number;
}

/** The stored run fields Health needs; `startedAt`/`endedAt` are ISO-8601 UTC as persisted. */
export interface HealthRunInput {
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
    // Falsy covers both null (GPS off) and 0 (measured nothing) — neither is worth a sample.
    if (!window || !segment.distanceM) continue;
    samples.push({ startedAt: window.first, endedAt: window.last, meters: segment.distanceM });
  }
  return samples;
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
  };
}
