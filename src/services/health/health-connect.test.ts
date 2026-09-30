import { describe, expect, test } from 'bun:test';

import type { ExerciseSessionRecord } from 'react-native-health-connect';

import { CL_UNKNOWN, type HealthRoutePoint, type HealthWorkoutInput } from '@/domain/health';
import {
  insertExerciseSession,
  isHealthRationaleAction,
  resolveAuthorization,
  toDistanceRecord,
  toExerciseRouteLocations,
  toExerciseSegments,
  toExerciseSessionRecord,
  WRITE_PERMISSIONS,
} from './health-connect';

const START = Date.parse('2026-09-22T06:00:00.000Z');
const END = Date.parse('2026-09-22T06:30:00.000Z');

function makePoint(overrides: Partial<HealthRoutePoint> = {}): HealthRoutePoint {
  return {
    latitude: 59.3293,
    longitude: 18.0686,
    timestamp: START + 1_000,
    altitude: 12,
    course: CL_UNKNOWN,
    speed: 2.8,
    horizontalAccuracy: 5,
    verticalAccuracy: 0.5,
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

describe('toExerciseRouteLocations', () => {
  test('carries coordinates, an ISO time and all three lengths in metres', () => {
    expect(toExerciseRouteLocations(makeInput())).toEqual([
      {
        time: '2026-09-22T06:00:01.000Z',
        latitude: 59.3293,
        longitude: 18.0686,
        horizontalAccuracy: { value: 5, unit: 'meters' },
        verticalAccuracy: { value: 0.5, unit: 'meters' },
        altitude: { value: 12, unit: 'meters' },
      },
    ]);
  });

  test('writes an unmeasured accuracy as 0 m, never as the negative sentinel', () => {
    const [location] = toExerciseRouteLocations(
      makeInput({
        route: [makePoint({ horizontalAccuracy: CL_UNKNOWN, verticalAccuracy: CL_UNKNOWN })],
      }),
    );
    expect(location.horizontalAccuracy).toEqual({ value: 0, unit: 'meters' });
    expect(location.verticalAccuracy).toEqual({ value: 0, unit: 'meters' });
  });

  test('keeps a negative altitude (below sea level is a real reading)', () => {
    const [location] = toExerciseRouteLocations(
      makeInput({ route: [makePoint({ altitude: -3 })] }),
    );
    expect(location.altitude).toEqual({ value: -3, unit: 'meters' });
  });

  test('drops points outside the session window, including one exactly at the end', () => {
    const locations = toExerciseRouteLocations(
      makeInput({
        route: [
          makePoint({ timestamp: START - 1 }),
          makePoint({ timestamp: START }),
          makePoint({ timestamp: START + 5_000 }),
          makePoint({ timestamp: END }),
          makePoint({ timestamp: END + 1 }),
        ],
      }),
    );
    expect(locations.map((l) => l.time)).toEqual([
      '2026-09-22T06:00:00.000Z',
      '2026-09-22T06:00:05.000Z',
    ]);
  });

  test('keeps only the first of two points sharing a timestamp', () => {
    const locations = toExerciseRouteLocations(
      makeInput({
        route: [
          makePoint({ timestamp: START + 1_000, latitude: 1 }),
          makePoint({ timestamp: START + 1_000, latitude: 2 }),
          makePoint({ timestamp: START + 2_000, latitude: 3 }),
        ],
      }),
    );
    expect(locations.map((l) => l.latitude)).toEqual([1, 3]);
  });

  test('an empty route stays empty', () => {
    expect(toExerciseRouteLocations(makeInput({ route: [] }))).toEqual([]);
  });
});

describe('toExerciseSessionRecord', () => {
  test('is a running session over the run window carrying the route', () => {
    const record = toExerciseSessionRecord(makeInput(), 7);
    expect(record.recordType).toBe('ExerciseSession');
    expect(record.startTime).toBe('2026-09-22T06:00:00.000Z');
    expect(record.endTime).toBe('2026-09-22T06:30:00.000Z');
    expect(record.exerciseType).toBe(56);
    expect(record.exerciseRoute?.route).toHaveLength(1);
  });

  test('omits the route rather than attaching an empty one', () => {
    expect(toExerciseSessionRecord(makeInput({ route: [] }), 7).exerciseRoute).toBeUndefined();
  });

  test('keys the record on the run id with the given version, actively recorded on a phone', () => {
    expect(toExerciseSessionRecord(makeInput(), 1_700_000_000_000).metadata).toEqual({
      clientRecordId: 'run-4200',
      clientRecordVersion: 1_700_000_000_000,
      recordingMethod: 1,
      device: { type: 2 },
    });
  });
});

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const segmented = makeInput({
  segments: [
    { activity: 'walking', startedAt: START, endedAt: START + 5 * MIN },
    { activity: 'running', startedAt: START + 5 * MIN, endedAt: START + 6 * MIN },
    { activity: 'resting', startedAt: START + 8 * MIN, endedAt: START + 9 * MIN },
  ],
  pauses: [{ startedAt: START + 6 * MIN, endedAt: START + 8 * MIN }],
});

describe('toExerciseSegments', () => {
  test('writes walking, running and rest segments, and each pause as a pause, in time order', () => {
    expect(toExerciseSegments(segmented)).toEqual([
      { startTime: iso(START), endTime: iso(START + 5 * MIN), segmentType: 64, repetitions: 0 },
      {
        startTime: iso(START + 5 * MIN),
        endTime: iso(START + 6 * MIN),
        segmentType: 46,
        repetitions: 0,
      },
      {
        startTime: iso(START + 6 * MIN),
        endTime: iso(START + 8 * MIN),
        segmentType: 39,
        repetitions: 0,
      },
      {
        startTime: iso(START + 8 * MIN),
        endTime: iso(START + 9 * MIN),
        segmentType: 44,
        repetitions: 0,
      },
    ]);
  });

  test('the session carries them, and omits the key when there are none', () => {
    expect(toExerciseSessionRecord(segmented, 7).segments).toHaveLength(4);
    expect('segments' in toExerciseSessionRecord(makeInput(), 7)).toBe(false);
  });
});

describe('insertExerciseSession', () => {
  // The library rejects with the code it maps each native exception to (ExceptionsUtils.kt).
  function recorder(failures: number, code = 'ARGUMENT_VALIDATION_ERROR') {
    const calls: ExerciseSessionRecord[][] = [];
    const insert = async (records: ExerciseSessionRecord[]) => {
      calls.push(records);
      if (calls.length <= failures) throw Object.assign(new Error('rejected'), { code });
    };
    return { calls, insert };
  }

  test('inserts the session once when Health Connect accepts it', async () => {
    const { calls, insert } = recorder(0);
    await insertExerciseSession(insert, toExerciseSessionRecord(segmented, 7));
    expect(calls).toHaveLength(1);
    expect(calls[0][0].segments).toHaveLength(4);
  });

  test('saves the same record again without segments when they are rejected', async () => {
    const { calls, insert } = recorder(1);
    const record = toExerciseSessionRecord(segmented, 7);
    await insertExerciseSession(insert, record);
    expect(calls).toHaveLength(2);
    const { segments: _rejected, ...bare } = record;
    expect(calls[1]).toEqual([bare]);
  });

  test('rethrows at once when Health Connect failed for another reason', async () => {
    const { calls, insert } = recorder(1, 'SERVICE_UNAVAILABLE');
    const record = toExerciseSessionRecord(segmented, 7);
    await expect(insertExerciseSession(insert, record)).rejects.toThrow('rejected');
    expect(calls).toHaveLength(1);
  });

  test('rethrows at once when there were no segments to blame', async () => {
    const { calls, insert } = recorder(1);
    const record = toExerciseSessionRecord(makeInput(), 7);
    await expect(insertExerciseSession(insert, record)).rejects.toThrow('rejected');
    expect(calls).toHaveLength(1);
  });

  test('rethrows when the record without segments is rejected too', async () => {
    const { calls, insert } = recorder(2);
    const record = toExerciseSessionRecord(segmented, 7);
    await expect(insertExerciseSession(insert, record)).rejects.toThrow('rejected');
    expect(calls).toHaveLength(2);
  });
});

describe('toDistanceRecord', () => {
  test('spans the sample window with the total in metres, keyed beside the session', () => {
    expect(toDistanceRecord(makeInput(), 7)).toEqual({
      recordType: 'Distance',
      startTime: '2026-09-22T06:00:00.000Z',
      endTime: '2026-09-22T06:30:00.000Z',
      distance: { value: 4_200, unit: 'meters' },
      metadata: {
        clientRecordId: 'run-4200:distance',
        clientRecordVersion: 7,
        recordingMethod: 1,
        device: { type: 2 },
      },
    });
  });

  test('is absent for a run without a measurable distance', () => {
    expect(toDistanceRecord(makeInput({ distanceSample: null }), 7)).toBeNull();
  });
});

describe('resolveAuthorization', () => {
  const all = [...WRITE_PERMISSIONS];

  test('unavailable when the SDK is not, whatever was granted', () => {
    expect(resolveAuthorization({ sdkAvailable: false, granted: all, requested: true })).toBe(
      'unavailable',
    );
  });

  test('authorized only once every write permission is granted, in any order', () => {
    expect(
      resolveAuthorization({ sdkAvailable: true, granted: [...all].reverse(), requested: true }),
    ).toBe('authorized');
    expect(
      resolveAuthorization({
        sdkAvailable: true,
        granted: [...all, { accessType: 'read', recordType: 'Steps' }],
        requested: false,
      }),
    ).toBe('authorized');
  });

  test('a partial grant is not authorized', () => {
    expect(
      resolveAuthorization({ sdkAvailable: true, granted: all.slice(0, 2), requested: true }),
    ).toBe('denied');
  });

  test('nothing granted reads as not determined until the app has asked once', () => {
    expect(resolveAuthorization({ sdkAvailable: true, granted: [], requested: false })).toBe(
      'notDetermined',
    );
    expect(resolveAuthorization({ sdkAvailable: true, granted: [], requested: true })).toBe(
      'denied',
    );
  });
});

describe('isHealthRationaleAction', () => {
  test('recognises both rationale intents and nothing else', () => {
    expect(isHealthRationaleAction('androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE')).toBe(true);
    expect(isHealthRationaleAction('android.intent.action.VIEW_PERMISSION_USAGE')).toBe(true);
    expect(isHealthRationaleAction('android.intent.action.MAIN')).toBe(false);
    expect(isHealthRationaleAction(null)).toBe(false);
  });
});
