import { describe, expect, test } from 'bun:test';

import { CL_UNKNOWN, toHealthRoute } from './health';
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
});
