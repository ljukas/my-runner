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
  for (const pause of [...pauses].sort((a, b) => a.startedAt - b.startedAt)) {
    const pausedAt = Math.min(pause.startedAt, window.endedAt);
    if (pausedAt > from) windows.push({ startMs: from, endMs: pausedAt });
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

// why one part per interval: HealthKit spreads a sample evenly over the active time it spans, so a
// sample across a pause would cost the total the paused share, and one across intervals would give
// a run and a walk the same pace. Without intervals the parts are the stretches between pauses.
// Each part is weighted by the route run in it, or by its time without one; the last takes the
// remainder so the parts sum to the total.
function distanceParts(
  input: HealthWorkoutInput,
  sample: HealthDistanceSample,
  route: readonly HealthRoutePoint[],
): HealthKitWorkout['distances'] {
  const windows =
    input.segments.length > 0
      ? input.segments.map((s) => ({ startMs: s.startedAt, endMs: s.endedAt }))
      : activeWindows(sample, input.pauses);
  const byRoute = windows.map((w) => routeMetresIn(route, w));
  const weights = byRoute.some((m) => m > 0) ? byRoute : windows.map((w) => w.endMs - w.startMs);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let assigned = 0;
  return windows
    .map((window, i) => {
      const last = i === windows.length - 1;
      // why the clamp: the remainder after shares rounded up can be a hair below zero, and a
      // negative quantity would fail the whole save; a part with no weight gets no distance.
      const meters =
        weights[i] === 0
          ? 0
          : last
            ? Math.max(0, sample.meters - assigned)
            : (sample.meters * weights[i]) / totalWeight;
      assigned += meters;
      return { ...window, meters, syncIdentifier: `${input.syncIdentifier}:distance:${i}` };
    })
    .filter((part) => part.meters > 0);
}

// per ADR 0011 (2026-10-01 amendment): the distance samples and the route each carry their own
// sync identifier, so a re-save replaces every piece rather than relying on HealthKit to cascade.
// per Apple's route guidance (creating-a-workout-route): no point with an accuracy worse than 50 m.
function isDrawable(point: HealthRoutePoint): boolean {
  return point.horizontalAccuracy > 0 && point.horizontalAccuracy <= 50;
}

export function toHealthKitWorkout(input: HealthWorkoutInput, version: number): HealthKitWorkout {
  const id = input.syncIdentifier;
  const route = input.route.filter(isDrawable);
  return {
    startMs: input.startedAt,
    endMs: input.endedAt,
    syncIdentifier: id,
    syncVersion: version,
    distances: input.distanceSample ? distanceParts(input, input.distanceSample, route) : [],
    pauses: input.pauses.map((p) => ({ startMs: p.startedAt, endMs: p.endedAt })),
    segments: input.segments.map((s) => ({
      kind: KIND[s.activity],
      startMs: s.startedAt,
      endMs: s.endedAt,
    })),
    route:
      route.length > 0
        ? {
            syncIdentifier: `${id}:route`,
            points: route.map(({ timestamp, ...point }) => ({
              ...point,
              timestampMs: timestamp,
            })),
          }
        : null,
  };
}
