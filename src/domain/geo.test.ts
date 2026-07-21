import { describe, expect, test } from 'bun:test';

import {
  accuracyFilter,
  boundingBox,
  encodePolyline,
  haversineMeters,
  type LocationFix,
} from './geo';

/** A fully-formed fix; override only the field under test. */
function makeFix(overrides: Partial<LocationFix> = {}): LocationFix {
  return { timestamp: 0, lat: 0, lng: 0, altitude: null, accuracy: 10, speed: null, ...overrides };
}

describe('accuracyFilter', () => {
  test('accepts a fix exactly at the 50 m limit', () => {
    expect(accuracyFilter(makeFix({ accuracy: 50 }))).toBe(true);
  });

  test('rejects a fix just beyond the limit', () => {
    expect(accuracyFilter(makeFix({ accuracy: 50.01 }))).toBe(false);
  });

  test('rejects a fix with unknown accuracy', () => {
    expect(accuracyFilter(makeFix({ accuracy: null }))).toBe(false);
  });

  test('rejects a fix reported invalid by a negative accuracy', () => {
    // iOS surfaces CLLocation.horizontalAccuracy < 0 to mean "lat/lng invalid".
    expect(accuracyFilter(makeFix({ accuracy: -1 }))).toBe(false);
  });

  test('rejects an implausible zero-radius fix', () => {
    expect(accuracyFilter(makeFix({ accuracy: 0 }))).toBe(false);
  });

  test('rejects a NaN accuracy', () => {
    expect(accuracyFilter(makeFix({ accuracy: NaN }))).toBe(false);
  });

  test('accepts a pristine fix', () => {
    expect(accuracyFilter(makeFix({ accuracy: 5 }))).toBe(true);
  });
});

describe('haversineMeters', () => {
  test('one degree of latitude is ~111.19 km (pins the earth radius)', () => {
    // R * π/180 = 6_371_000 * 0.0174533 = 111194.93 m
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111194.93, 0);
  });

  test('London → Paris is ~343.6 km (real-world sanity vector)', () => {
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    const d = haversineMeters(london, paris);
    expect(d).toBeGreaterThan(343_000);
    expect(d).toBeLessThan(344_500);
  });

  test('identical points are exactly 0', () => {
    const p = { lat: 59.3293, lng: 18.0686 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  test('is symmetric', () => {
    const a = { lat: 10, lng: 20 };
    const b = { lat: -5, lng: 42 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  test('takes the short way across the antimeridian', () => {
    const wrap = haversineMeters({ lat: 0, lng: 179.999 }, { lat: 0, lng: -179.999 });
    const equivalent = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0.002 });
    // 0.002° apart the short way — ~222 m — NOT ~40 000 km the long way round.
    expect(wrap).toBeCloseTo(equivalent, 6);
    expect(wrap).toBeCloseTo(222.39, 0);
  });
});

describe('boundingBox', () => {
  test('spans the min/max lat/lng of the fixture', () => {
    expect(
      boundingBox([
        { lat: 40.7, lng: -120.95 },
        { lat: 38.5, lng: -120.2 },
        { lat: 43.252, lng: -126.453 },
      ]),
    ).toEqual({ minLat: 38.5, maxLat: 43.252, minLng: -126.453, maxLng: -120.2 });
  });

  test('a single point yields a degenerate zero-area box', () => {
    expect(boundingBox([{ lat: 1, lng: 2 }])).toEqual({
      minLat: 1,
      maxLat: 1,
      minLng: 2,
      maxLng: 2,
    });
  });

  test('is null for an empty set (no box to fit)', () => {
    expect(boundingBox([])).toBeNull();
  });

  test('is antimeridian-naive across the date line (documented limitation)', () => {
    // Straddling ±180° gives the long-way box; acceptable for the C25K footprint.
    expect(
      boundingBox([
        { lat: 0, lng: 179.9 },
        { lat: 0, lng: -179.9 },
      ]),
    ).toEqual({ minLat: 0, maxLat: 0, minLng: -179.9, maxLng: 179.9 });
  });
});

describe('encodePolyline', () => {
  test('matches the Google reference vector', () => {
    // Reference example + expected output from Google's polyline algorithm page:
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const points = [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ];
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  test('a single point encodes its absolute lat then lng', () => {
    expect(encodePolyline([{ lat: 38.5, lng: -120.2 }])).toBe('_p~iF~ps|U');
  });

  test('respects a non-default precision', () => {
    // 0.00001° scales to a delta of 1 at precision 5 ('A?') and 10 at precision 6 ('S?').
    expect(encodePolyline([{ lat: 0.00001, lng: 0 }], 5)).toBe('A?');
    expect(encodePolyline([{ lat: 0.00001, lng: 0 }], 6)).toBe('S?');
  });

  test('empty input yields an empty string', () => {
    expect(encodePolyline([])).toBe('');
  });
});
