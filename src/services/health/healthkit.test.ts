import { describe, expect, test } from 'bun:test';

import { CL_UNKNOWN, type HealthRoutePoint, type HealthWorkoutInput } from '@/domain/health';
import { toHealthKitWorkout } from './healthkit';

const START = Date.parse('2026-10-01T06:00:00.000Z');
const END = Date.parse('2026-10-01T06:30:00.000Z');
const MIN = 60_000;

function makePoint(overrides: Partial<HealthRoutePoint> = {}): HealthRoutePoint {
  return {
    latitude: 59.3293,
    longitude: 18.0686,
    timestamp: START + 1_000,
    altitude: 12,
    course: CL_UNKNOWN,
    speed: 2.8,
    horizontalAccuracy: 5,
    verticalAccuracy: CL_UNKNOWN,
    ...overrides,
  };
}

function makeInput(overrides: Partial<HealthWorkoutInput> = {}): HealthWorkoutInput {
  return {
    startedAt: START,
    endedAt: END,
    totalDistanceM: 4_200,
    distanceSample: { startedAt: START, endedAt: END, meters: 4_200 },
    route: [makePoint()],
    segments: [],
    pauses: [],
    syncIdentifier: 'run-4200',
    ...overrides,
  };
}

describe('toHealthKitWorkout', () => {
  test('spans the run and keys the workout on the run id at the given version', () => {
    const workout = toHealthKitWorkout(makeInput(), 1_700_000_000_000);
    expect(workout).toMatchObject({
      startMs: START,
      endMs: END,
      syncIdentifier: 'run-4200',
      syncVersion: 1_700_000_000_000,
    });
  });

  test('gives the distance and the route their own sync identifiers', () => {
    const workout = toHealthKitWorkout(makeInput(), 7);
    expect(workout.distances).toEqual([
      { startMs: START, endMs: END, meters: 4_200, syncIdentifier: 'run-4200:distance:0' },
    ]);
    expect(workout.route?.syncIdentifier).toBe('run-4200:route');
  });

  test('without GPS there is neither a distance nor a route', () => {
    const workout = toHealthKitWorkout(makeInput({ distanceSample: null, route: [] }), 7);
    expect(workout.distances).toEqual([]);
    expect(workout.route).toBeNull();
  });

  test('writes one distance part per interval, weighted by the route run in it', () => {
    const north = (m: number) => 59.3293 + m / 111_195;
    // 1 Hz-ish fixes: 200 m over the first 2 min run, 60 m over the next 2 min walk.
    const route = [0, 100, 200, 230, 260].map((m, i) =>
      makePoint({ latitude: north(m), timestamp: START + i * MIN }),
    );
    const workout = toHealthKitWorkout(
      makeInput({
        route,
        distanceSample: { startedAt: START, endedAt: START + 4 * MIN, meters: 260 },
        endedAt: START + 4 * MIN,
        segments: [
          { activity: 'running', startedAt: START, endedAt: START + 2 * MIN },
          { activity: 'walking', startedAt: START + 2 * MIN, endedAt: START + 4 * MIN },
        ],
      }),
      7,
    );
    expect(workout.distances.map((d) => [d.startMs, d.endMs, d.syncIdentifier])).toEqual([
      [START, START + 2 * MIN, 'run-4200:distance:0'],
      [START + 2 * MIN, START + 4 * MIN, 'run-4200:distance:1'],
    ]);
    expect(workout.distances[0].meters).toBeCloseTo(200, 0);
    expect(workout.distances[1].meters).toBeCloseTo(60, 0);
  });

  test('without intervals, splits the distance at each pause instead', () => {
    const north = (m: number) => 59.3293 + m / 111_195;
    const route = [0, 60, 120, 600, 900].map((m, i) =>
      makePoint({ latitude: north(m), timestamp: START + [1, 2, 3, 20, 25][i] * MIN }),
    );
    const workout = toHealthKitWorkout(
      makeInput({
        route,
        distanceSample: { startedAt: START, endedAt: END, meters: 1_000 },
        pauses: [{ startedAt: START + 10 * MIN, endedAt: START + 15 * MIN }],
      }),
      7,
    );
    expect(workout.distances.map((d) => [d.startMs, d.endMs, d.syncIdentifier])).toEqual([
      [START, START + 10 * MIN, 'run-4200:distance:0'],
      [START + 15 * MIN, END, 'run-4200:distance:1'],
    ]);
    // 120 m of route before the pause, 300 m after (the leg across it counts for neither).
    expect(workout.distances[0].meters).toBeCloseTo((1_000 * 120) / 420, 0);
    expect(workout.distances[0].meters + workout.distances[1].meters).toBeCloseTo(1_000, 9);
  });

  test('never writes a negative or empty part when the last stretch has no route', () => {
    const north = (m: number) => 59.3293 + m / 111_195;
    const route = [0, 300, 600, 900].map((m, i) =>
      makePoint({ latitude: north(m), timestamp: START + [1, 4, 12, 15][i] * MIN }),
    );
    const workout = toHealthKitWorkout(
      makeInput({
        route,
        distanceSample: { startedAt: START, endedAt: END, meters: 1_234.567 },
        pauses: [
          { startedAt: START + 5 * MIN, endedAt: START + 10 * MIN },
          { startedAt: START + 20 * MIN, endedAt: START + 25 * MIN },
        ],
      }),
      7,
    );
    expect(workout.distances.map((d) => d.syncIdentifier)).toEqual([
      'run-4200:distance:0',
      'run-4200:distance:1',
    ]);
    for (const part of workout.distances) expect(part.meters).toBeGreaterThan(0);
    const total = workout.distances.reduce((sum, d) => sum + d.meters, 0);
    expect(total).toBeCloseTo(1_234.567, 9);
  });

  test('takes pauses in time order and keeps every part inside the run', () => {
    const workout = toHealthKitWorkout(
      makeInput({
        route: [],
        distanceSample: { startedAt: START, endedAt: END, meters: 900 },
        pauses: [
          { startedAt: START + 20 * MIN, endedAt: START + 25 * MIN },
          { startedAt: START + 10 * MIN, endedAt: START + 15 * MIN },
        ],
      }),
      7,
    );
    expect(workout.distances.map((d) => [d.startMs, d.endMs])).toEqual([
      [START, START + 10 * MIN],
      [START + 15 * MIN, START + 20 * MIN],
      [START + 25 * MIN, END],
    ]);
  });

  test('without a route, weights each part by its time', () => {
    const workout = toHealthKitWorkout(
      makeInput({
        route: [],
        distanceSample: { startedAt: START, endedAt: END, meters: 1_000 },
        pauses: [{ startedAt: START + 10 * MIN, endedAt: START + 20 * MIN }],
      }),
      7,
    );
    expect(workout.distances.map((d) => d.meters)).toEqual([500, 500]);
  });

  test('a pause the run ended in leaves one part, ending where it began', () => {
    const workout = toHealthKitWorkout(
      makeInput({ route: [], pauses: [{ startedAt: START + 20 * MIN, endedAt: END }] }),
      7,
    );
    expect(workout.distances).toEqual([
      {
        startMs: START,
        endMs: START + 20 * MIN,
        meters: 4_200,
        syncIdentifier: 'run-4200:distance:0',
      },
    ]);
  });

  test('drops route points HealthKit would draw badly: accuracy unknown or worse than 50 m', () => {
    const route = [5, 49, 51, CL_UNKNOWN].map((horizontalAccuracy, i) =>
      makePoint({ horizontalAccuracy, timestamp: START + (i + 1) * 1_000 }),
    );
    const points = toHealthKitWorkout(makeInput({ route }), 7).route?.points ?? [];
    expect(points.map((p) => p.horizontalAccuracy)).toEqual([5, 49]);
  });

  test('carries every route point, unknown values as they are', () => {
    expect(toHealthKitWorkout(makeInput(), 7).route?.points).toEqual([
      {
        latitude: 59.3293,
        longitude: 18.0686,
        timestampMs: START + 1_000,
        altitude: 12,
        course: CL_UNKNOWN,
        speed: 2.8,
        horizontalAccuracy: 5,
        verticalAccuracy: CL_UNKNOWN,
      },
    ]);
  });

  test('names each segment run, walk or rest, and passes the pauses through', () => {
    const workout = toHealthKitWorkout(
      makeInput({
        segments: [
          { activity: 'walking', startedAt: START, endedAt: START + 5 * MIN },
          { activity: 'running', startedAt: START + 5 * MIN, endedAt: START + 6 * MIN },
          { activity: 'resting', startedAt: START + 8 * MIN, endedAt: START + 9 * MIN },
        ],
        pauses: [{ startedAt: START + 6 * MIN, endedAt: START + 8 * MIN }],
      }),
      7,
    );
    expect(workout.segments).toEqual([
      { kind: 'walk', startMs: START, endMs: START + 5 * MIN },
      { kind: 'run', startMs: START + 5 * MIN, endMs: START + 6 * MIN },
      { kind: 'rest', startMs: START + 8 * MIN, endMs: START + 9 * MIN },
    ]);
    expect(workout.pauses).toEqual([{ startMs: START + 6 * MIN, endMs: START + 8 * MIN }]);
  });
});
