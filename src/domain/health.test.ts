import { describe, expect, test } from 'bun:test';

import { CL_UNKNOWN, toHealthDistanceSample, toHealthRoute, toHealthWorkout } from './health';
import type { SegmentedFix } from './geo';

function makeFix(overrides: Partial<SegmentedFix> = {}): SegmentedFix {
  return {
    timestamp: 1_000,
    lat: 59.3293,
    lng: 18.0686,
    altitude: 12,
    accuracy: 5,
    speed: 2.8,
    segmentSeq: 0,
    ...overrides,
  };
}

describe('toHealthRoute', () => {
  test('passes coordinates, timestamp and measured values through', () => {
    const [point] = toHealthRoute([makeFix()]);
    expect(point).toEqual({
      latitude: 59.3293,
      longitude: 18.0686,
      timestamp: 1_000,
      altitude: 12,
      horizontalAccuracy: 5,
      speed: 2.8,
      course: CL_UNKNOWN,
      verticalAccuracy: CL_UNKNOWN,
    });
  });

  test('marks unmeasured accuracy and speed as unknown rather than zero', () => {
    const [point] = toHealthRoute([makeFix({ accuracy: null, speed: null })]);
    expect(point.horizontalAccuracy).toBe(CL_UNKNOWN);
    expect(point.speed).toBe(CL_UNKNOWN);
  });

  test('falls back to sea level when altitude was not recorded', () => {
    const [point] = toHealthRoute([makeFix({ altitude: null })]);
    expect(point.altitude).toBe(0);
  });

  test('preserves order and handles an empty track', () => {
    const points = toHealthRoute([makeFix({ timestamp: 1 }), makeFix({ timestamp: 2 })]);
    expect(points.map((p) => p.timestamp)).toEqual([1, 2]);
    expect(toHealthRoute([])).toEqual([]);
  });

  test('sorts chronologically by timestamp, not by arrival (seq) order', () => {
    const points = toHealthRoute([
      makeFix({ timestamp: 9_000 }),
      makeFix({ timestamp: 1_000 }),
      makeFix({ timestamp: 6_000 }),
    ]);
    expect(points.map((p) => p.timestamp)).toEqual([1_000, 6_000, 9_000]);
  });

  test('drops a fix with a NaN timestamp rather than derailing the route', () => {
    const points = toHealthRoute([
      makeFix({ timestamp: 1_000 }),
      makeFix({ timestamp: Number.NaN }),
      makeFix({ timestamp: 2_000 }),
    ]);
    expect(points.map((p) => p.timestamp)).toEqual([1_000, 2_000]);
  });
});

describe('toHealthDistanceSample', () => {
  const run = {
    id: 'run-4200',
    startedAt: '2026-08-01T06:00:00.000Z',
    endedAt: '2026-08-01T06:30:00.000Z',
    distanceM: 4_200,
  };

  test('spans the whole run and carries its total distance, not a per-interval one', () => {
    expect(toHealthDistanceSample(run)).toEqual({
      startedAt: Date.parse('2026-08-01T06:00:00.000Z'),
      endedAt: Date.parse('2026-08-01T06:30:00.000Z'),
      meters: 4_200,
    });
  });

  test('produces nothing for a run recorded without GPS', () => {
    expect(toHealthDistanceSample({ ...run, distanceM: null })).toBeNull();
  });

  test.each([0, -5, Number.POSITIVE_INFINITY, Number.NaN])(
    'produces nothing for a non-measurable distance (%p)',
    (distanceM) => {
      expect(toHealthDistanceSample({ ...run, distanceM })).toBeNull();
    },
  );
});

describe('toHealthWorkout', () => {
  const run = {
    id: 'run-4200',
    startedAt: '2026-08-01T06:00:00.000Z',
    endedAt: '2026-08-01T06:30:00.000Z',
    distanceM: 4_200,
  };

  test('reports the run total and a single sample spanning the whole run', () => {
    const workout = toHealthWorkout(run, [
      makeFix({ segmentSeq: 0, timestamp: 1_000 }),
      makeFix({ segmentSeq: 1, timestamp: 2_000 }),
    ]);
    expect(workout.totalDistanceM).toBe(4_200);
    expect(workout.distanceSample).toEqual({
      startedAt: Date.parse('2026-08-01T06:00:00.000Z'),
      endedAt: Date.parse('2026-08-01T06:30:00.000Z'),
      meters: 4_200,
    });
  });

  test('converts the stored ISO timestamps to epoch ms', () => {
    const workout = toHealthWorkout(run, []);
    expect(workout.startedAt).toBe(Date.parse('2026-08-01T06:00:00.000Z'));
    expect(workout.endedAt).toBe(Date.parse('2026-08-01T06:30:00.000Z'));
  });

  test('a GPS-less run still yields a workout, with no route and no distance sample', () => {
    const workout = toHealthWorkout({ ...run, distanceM: null }, []);
    expect(workout.totalDistanceM).toBeNull();
    expect(workout.route).toEqual([]);
    expect(workout.distanceSample).toBeNull();
  });

  test('carries the run id through as the sync identifier (finding 1: idempotent retries)', () => {
    const workout = toHealthWorkout(run, []);
    expect(workout.syncIdentifier).toBe('run-4200');
  });
});
