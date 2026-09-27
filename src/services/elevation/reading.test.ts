import { describe, expect, test } from 'bun:test';

import {
  relativeAltitudeFromPressure,
  toAltitudeReading,
  toMotionPermissionStatus,
} from './reading';

describe('toAltitudeReading', () => {
  test('drops a reading whose pressure is not finite', () => {
    expect(toAltitudeReading({ pressure: NaN, timestamp: 1 }, 1000, 1)).toBeNull();
    expect(toAltitudeReading({ pressure: Infinity, timestamp: 1 }, 1000, 1)).toBeNull();
  });

  test('an absent relativeAltitude yields relativeAltitudeM: null while pressureHpa survives', () => {
    const reading = toAltitudeReading({ pressure: 1000, timestamp: 1 }, 1000, 1);
    expect(reading?.relativeAltitudeM).toBeNull();
    expect(reading?.pressureHpa).toBe(1000);
  });

  test('a non-finite relativeAltitude yields relativeAltitudeM: null while pressureHpa survives', () => {
    const reading = toAltitudeReading(
      { pressure: 1001, relativeAltitude: NaN, timestamp: 1 },
      1000,
      1,
    );
    expect(reading?.relativeAltitudeM).toBeNull();
    expect(reading?.pressureHpa).toBe(1001);
  });

  test('a finite relativeAltitude passes through as relativeAltitudeM', () => {
    const reading = toAltitudeReading(
      { pressure: 1002, relativeAltitude: 12.5, timestamp: 1 },
      1000,
      1,
    );
    expect(reading?.relativeAltitudeM).toBe(12.5);
  });

  test("a relativeAltitude of exactly 0 — every session's zero reference — yields relativeAltitudeM: 0, not null", () => {
    const reading = toAltitudeReading(
      { pressure: 1003, relativeAltitude: 0, timestamp: 1 },
      1000,
      1,
    );
    // Object.is, not toBe: relativeAltitudeM is falsy but real — `0 || null` would silently pass
    // this as `null` and `-0 || null` would also silently pass this as `null`; Object.is pins both.
    expect(Object.is(reading?.relativeAltitudeM, 0)).toBe(true);
  });

  test('both clocks land on the right fields: `at` is the receipt time, `sensorTimestampS` is the sensor clock', () => {
    const reading = toAltitudeReading({ pressure: 1000, timestamp: 42.5 }, 999_000, 1);
    expect(reading?.at).toBe(999_000);
    expect(reading?.sensorTimestampS).toBe(42.5);
  });

  test('a non-finite sensor timestamp yields sensorTimestampS: null', () => {
    const reading = toAltitudeReading({ pressure: 1000, timestamp: NaN }, 999_000, 1);
    expect(reading?.sensorTimestampS).toBeNull();
  });

  test('the epoch passed in is stamped through unchanged', () => {
    expect(toAltitudeReading({ pressure: 1000, timestamp: 1 }, 1000, 7)?.epoch).toBe(7);
  });
});

describe('toMotionPermissionStatus', () => {
  test('granted maps to "granted"', () => {
    expect(toMotionPermissionStatus(true, true)).toBe('granted');
  });

  test('not granted with canAskAgain: true maps to "undetermined"', () => {
    expect(toMotionPermissionStatus(false, true)).toBe('undetermined');
  });

  test('not granted with canAskAgain: false maps to "denied"', () => {
    expect(toMotionPermissionStatus(false, false)).toBe('denied');
  });
});

describe('relativeAltitudeFromPressure', () => {
  test("the epoch's first reading is exactly zero", () => {
    expect(Object.is(relativeAltitudeFromPressure(1008.4, 1008.4), 0)).toBe(true);
  });

  test('falling pressure is a climb, rising pressure a descent', () => {
    expect(relativeAltitudeFromPressure(1000, 1010)).toBeGreaterThan(0);
    expect(relativeAltitudeFromPressure(1010, 1000)).toBeLessThan(0);
  });

  test('about 8.3 m per hPa near sea level', () => {
    expect(relativeAltitudeFromPressure(1012.25, 1013.25)).toBeCloseTo(8.33, 1);
  });

  test('the same pressure drop reads the same climb whatever the weather', () => {
    const lowDay = relativeAltitudeFromPressure(989, 990);
    const highDay = relativeAltitudeFromPressure(1029, 1030);
    expect(Math.abs(lowDay - highDay)).toBeLessThan(0.4);
  });
});
