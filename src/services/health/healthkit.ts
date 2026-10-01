/** Pure HealthKit payload mapping — no React, Expo, native or DB imports (ADR 0003 §1). */

import { haversineMeters } from '@/domain/geo';
import type { HealthDistanceSample, HealthRoutePoint, HealthWorkoutInput } from '@/domain/health';
import type { WorkoutActivity, WorkoutWindow } from '@/domain/health-segments';
import type {
  HealthKitSegmentKind,
  HealthKitWindow,
  HealthKitWorkout,
} from '@/modules/apple-health/types';

const KIND: Record<WorkoutActivity, HealthKitSegmentKind> = {
  running: 'run',
  walking: 'walk',
  resting: 'rest',
};

function activeWindows(window: WorkoutWindow, pauses: readonly WorkoutWindow[]): HealthKitWindow[] {
  const windows: HealthKitWindow[] = [];
  let from = window.startedAt;
  for (const pause of pauses) {
    if (pause.startedAt > from) windows.push({ startMs: from, endMs: pause.startedAt });
    from = Math.max(from, pause.endedAt);
  }
  if (window.endedAt > from) windows.push({ startMs: from, endMs: window.endedAt });
  return windows;
}

// Legs crossing a pause belong to neither side, so a teleport across it never counts.
function routeMetresIn(route: readonly HealthRoutePoint[], { startMs, endMs }: HealthKitWindow) {
  let metres = 0;
  for (let i = 1; i < route.length; i += 1) {
    const [a, b] = [route[i - 1], route[i]];
    if (a.timestamp < startMs || b.timestamp > endMs) continue;
    metres += haversineMeters(
      { lat: a.latitude, lng: a.longitude },
      { lat: b.latitude, lng: b.longitude },
    );
  }
  return metres;
}

// why split: HealthKit spreads a sample evenly over the workout's active time, so one sample across
// a pause would cost the workout total the paused share. Each part is weighted by the route run in
// it, or by its time without one; the last takes the remainder so the parts sum to the total.
function distanceParts(
  sample: HealthDistanceSample,
  pauses: readonly WorkoutWindow[],
  route: readonly HealthRoutePoint[],
  id: string,
): HealthKitWorkout['distances'] {
  const windows = activeWindows(sample, pauses);
  const byRoute = windows.map((w) => routeMetresIn(route, w));
  const weights = byRoute.some((m) => m > 0) ? byRoute : windows.map((w) => w.endMs - w.startMs);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let assigned = 0;
  return windows.map((window, i) => {
    const last = i === windows.length - 1;
    const meters = last ? sample.meters - assigned : (sample.meters * weights[i]) / totalWeight;
    assigned += meters;
    return { ...window, meters, syncIdentifier: `${id}:distance:${i}` };
  });
}

// per ADR 0011 (2026-10-01 amendment): the distance samples and the route each carry their own
// sync identifier, so a re-save replaces every piece rather than relying on HealthKit to cascade.
export function toHealthKitWorkout(input: HealthWorkoutInput, version: number): HealthKitWorkout {
  const id = input.syncIdentifier;
  return {
    startMs: input.startedAt,
    endMs: input.endedAt,
    syncIdentifier: id,
    syncVersion: version,
    distances: input.distanceSample
      ? distanceParts(input.distanceSample, input.pauses, input.route, id)
      : [],
    pauses: input.pauses.map((p) => ({ startMs: p.startedAt, endMs: p.endedAt })),
    segments: input.segments.map((s) => ({
      kind: KIND[s.activity],
      startMs: s.startedAt,
      endMs: s.endedAt,
    })),
    route:
      input.route.length > 0
        ? {
            syncIdentifier: `${id}:route`,
            points: input.route.map(({ timestamp, ...point }) => ({
              ...point,
              timestampMs: timestamp,
            })),
          }
        : null,
  };
}
