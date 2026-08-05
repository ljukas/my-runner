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
        // Never recorded: run_points has no course column (spec §5.1).
        course: CL_UNKNOWN,
        // CoreLocation's own negative-means-invalid convention makes CL_UNKNOWN a safe, un-clamped fallback.
        verticalAccuracy: fix.altitudeAccuracy ?? CL_UNKNOWN,
      }))
  );
}

/** The run's total distance over its own wall-clock window — one sample per session, not per segment. */
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

/** The platform-neutral payload crossing the HealthAdapter port (ADR 0011 §1). */
export interface HealthWorkoutInput {
  startedAt: number;
  endedAt: number;
  totalDistanceM: number | null;
  distanceSample: HealthDistanceSample | null;
  route: HealthRoutePoint[];
  /** The run's own id, reused as HealthKit's sync identifier so a retry replaces rather than duplicates. */
  syncIdentifier: string;
}

// null covers GPS off; a negative or Infinity value is equally unusable and would serialize to null
// across the bridge boundary anyway, so require a real, finite, positive distance.
function hasMeasurableDistance(distanceM: number | null): distanceM is number {
  return distanceM !== null && Number.isFinite(distanceM) && distanceM > 0;
}

// per ADR 0011 amendment (item 7): one sample per run, not per segment.
export function toHealthDistanceSample(run: HealthRunInput): HealthDistanceSample | null {
  if (!hasMeasurableDistance(run.distanceM)) return null;
  return {
    startedAt: Date.parse(run.startedAt),
    endedAt: Date.parse(run.endedAt),
    meters: run.distanceM,
  };
}

export function toHealthWorkout(
  run: HealthRunInput,
  fixes: readonly SegmentedFix[],
): HealthWorkoutInput {
  return {
    startedAt: Date.parse(run.startedAt),
    endedAt: Date.parse(run.endedAt),
    totalDistanceM: run.distanceM,
    distanceSample: toHealthDistanceSample(run),
    route: toHealthRoute(fixes),
    syncIdentifier: run.id,
  };
}
