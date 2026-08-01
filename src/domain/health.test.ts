import { describe, expect, test } from 'bun:test';

import { CL_UNKNOWN, toHealthRoute, toHealthSegmentSamples, toHealthWorkout } from './health';
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

describe('toHealthSegmentSamples', () => {
  const fixes = [
    makeFix({ segmentSeq: 0, timestamp: 1_000 }),
    makeFix({ segmentSeq: 0, timestamp: 4_000 }),
    makeFix({ segmentSeq: 1, timestamp: 9_000 }),
    makeFix({ segmentSeq: 1, timestamp: 6_000 }), // out of order on purpose
  ];

  test('windows a segment by the first and last timestamp of its own points', () => {
    const samples = toHealthSegmentSamples(
      [
        { seq: 0, distanceM: 120 },
        { seq: 1, distanceM: 300 },
      ],
      fixes,
    );
    expect(samples).toEqual([
      { startedAt: 1_000, endedAt: 4_000, meters: 120 },
      { startedAt: 6_000, endedAt: 9_000, meters: 300 },
    ]);
  });

  test('skips segments with no points, no distance, or zero distance', () => {
    const samples = toHealthSegmentSamples(
      [
        { seq: 0, distanceM: 120 },
        { seq: 1, distanceM: null },
        { seq: 2, distanceM: 50 }, // no fixes carry seq 2
        { seq: 3, distanceM: 0 },
      ],
      fixes,
    );
    expect(samples).toEqual([{ startedAt: 1_000, endedAt: 4_000, meters: 120 }]);
  });

  test('produces nothing for a run recorded without GPS', () => {
    expect(toHealthSegmentSamples([{ seq: 0, distanceM: null }], [])).toEqual([]);
  });

  test('a NaN timestamp among good fixes does not poison the rest of the segment window', () => {
    const samples = toHealthSegmentSamples(
      [{ seq: 0, distanceM: 120 }],
      [
        makeFix({ segmentSeq: 0, timestamp: 1_000 }),
        makeFix({ segmentSeq: 0, timestamp: Number.NaN }),
        makeFix({ segmentSeq: 0, timestamp: 4_000 }),
      ],
    );
    expect(samples).toEqual([{ startedAt: 1_000, endedAt: 4_000, meters: 120 }]);
  });

  test('skips a segment whose distance is negative or infinite', () => {
    const samples = toHealthSegmentSamples(
      [
        { seq: 0, distanceM: -5 },
        { seq: 1, distanceM: Number.POSITIVE_INFINITY },
      ],
      [makeFix({ segmentSeq: 0, timestamp: 1_000 }), makeFix({ segmentSeq: 1, timestamp: 2_000 })],
    );
    expect(samples).toEqual([]);
  });
});

describe('toHealthWorkout', () => {
  const run = {
    startedAt: '2026-08-01T06:00:00.000Z',
    endedAt: '2026-08-01T06:30:00.000Z',
    distanceM: 4_200,
  };

  test('reports the run total, never the last segment (spec §5.3)', () => {
    const workout = toHealthWorkout(
      run,
      [
        { seq: 0, distanceM: 400 },
        { seq: 1, distanceM: 3_800 },
      ],
      [makeFix({ segmentSeq: 0, timestamp: 1_000 }), makeFix({ segmentSeq: 1, timestamp: 2_000 })],
    );
    expect(workout.totalDistanceM).toBe(4_200);
    expect(workout.segmentSamples).toHaveLength(2);
  });

  test('converts the stored ISO timestamps to epoch ms', () => {
    const workout = toHealthWorkout(run, [], []);
    expect(workout.startedAt).toBe(Date.parse('2026-08-01T06:00:00.000Z'));
    expect(workout.endedAt).toBe(Date.parse('2026-08-01T06:30:00.000Z'));
  });

  test('a GPS-less run still yields a workout, with no route and no distance', () => {
    const workout = toHealthWorkout({ ...run, distanceM: null }, [{ seq: 0, distanceM: null }], []);
    expect(workout.totalDistanceM).toBeNull();
    expect(workout.route).toEqual([]);
    expect(workout.segmentSamples).toEqual([]);
  });
});
