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
