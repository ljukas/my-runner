import { describe, expect, test } from 'bun:test';

import type { LocationFix } from './geo';
import { PROFILE_SAMPLE_COUNT, toRunProfile } from './run-profile';

/**
 * A straight northward run at a steady pace. 1 Hz, `metresPerFix` apart.
 * why hard-coded degrees: 1e-5 deg latitude is ~1.11 m, close enough that the
 * assertions below are about bucketing, not about haversine precision.
 */
function straightRun(count: number, metresPerFix: number, altitudes?: number[]): LocationFix[] {
  const degPerMetre = 1 / 111_320;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: 1_000_000 + i * 1000,
    lat: 59.3 + i * metresPerFix * degPerMetre,
    lng: 18.06,
    altitude: altitudes ? altitudes[i] : 100,
    accuracy: 5,
    speed: metresPerFix,
  }));
}

describe('toRunProfile', () => {
  test('a run with no fixes yields no points', () => {
    expect(toRunProfile([])).toEqual([]);
  });

  test('a stationary run yields no points', () => {
    const fixes = straightRun(60, 0);
    expect(toRunProfile(fixes)).toEqual([]);
  });

  test('distance is monotonically increasing across the profile', () => {
    const profile = toRunProfile(straightRun(600, 3));
    expect(profile.length).toBeGreaterThan(1);
    for (let i = 1; i < profile.length; i += 1) {
      expect(profile[i].distanceM).toBeGreaterThan(profile[i - 1].distanceM);
    }
  });

  test('the profile never exceeds the requested bucket count', () => {
    const profile = toRunProfile(straightRun(600, 3));
    expect(profile.length).toBeLessThanOrEqual(PROFILE_SAMPLE_COUNT);
  });

  test('a short run yields fewer buckets than the cap, not empty ones', () => {
    const profile = toRunProfile(straightRun(20, 3));
    expect(profile.length).toBeGreaterThan(0);
    expect(profile.length).toBeLessThanOrEqual(PROFILE_SAMPLE_COUNT);
    expect(profile.every((p) => Number.isFinite(p.distanceM))).toBe(true);
  });

  test('a steady 3 m/s run reports a pace near 333 s/km throughout', () => {
    const profile = toRunProfile(straightRun(600, 3));
    const paces = profile.map((p) => p.paceSecPerKm).filter((p): p is number => p !== null);
    expect(paces.length).toBeGreaterThan(0);
    for (const pace of paces) {
      expect(pace).toBeGreaterThan(250);
      expect(pace).toBeLessThan(450);
    }
  });

  test('elevation is rebased so the first point reads about zero', () => {
    const altitudes = Array.from({ length: 600 }, () => 850);
    const profile = toRunProfile(straightRun(600, 3, altitudes));
    expect(profile[0].elevationM).toBeCloseTo(0, 5);
  });

  test('a run whose fixes carry no altitude yields null elevation but real pace', () => {
    const fixes = straightRun(600, 3).map((fix) => ({ ...fix, altitude: null }));
    const profile = toRunProfile(fixes);
    expect(profile.every((p) => p.elevationM === null)).toBe(true);
    expect(profile.some((p) => p.paceSecPerKm !== null)).toBe(true);
  });

  test('the profile ends near the smoothed track distance', () => {
    const fixes = straightRun(600, 3);
    const profile = toRunProfile(fixes);
    const last = profile.at(-1)!;
    // why a band: the ADR 0021 smoother legitimately shortens a raw track, and the
    // final bucket's centre sits half a bucket short of the true end.
    expect(last.distanceM).toBeGreaterThan(1000);
    expect(last.distanceM).toBeLessThan(2000);
  });
});
