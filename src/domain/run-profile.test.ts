import { describe, expect, test } from 'bun:test';

import { smoothTrack, type LocationFix } from './geo';
import { PROFILE_SAMPLE_COUNT, toRunProfile } from './run-profile';

/**
 * A straight northward run at a steady pace. 1 Hz, `metresPerFix` apart.
 * why hard-coded degrees: 1e-5 deg latitude is ~1.11 m, close enough that the
 * assertions below are about bucketing, not about haversine precision.
 */
function straightRun(count: number, metresPerFix: number): LocationFix[] {
  const degPerMetre = 1 / 111_320;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: 1_000_000 + i * 1000,
    lat: 59.3 + i * metresPerFix * degPerMetre,
    lng: 18.06,
    altitude: 100,
    accuracy: 5,
    speed: metresPerFix,
  }));
}

const STEADY_PACE_SEC_PER_KM = 1000 / 3;

function meanPace(profile: { paceSecPerKm: number | null }[]): number {
  const paces = profile.map((p) => p.paceSecPerKm).filter((p): p is number => p !== null);
  expect(paces).not.toHaveLength(0);
  return paces.reduce((sum, p) => sum + p, 0) / paces.length;
}

describe('toRunProfile', () => {
  test('a run with no fixes yields no points', () => {
    expect(toRunProfile([])).toEqual([]);
  });

  test('a stationary run yields no points', () => {
    expect(toRunProfile(straightRun(60, 0))).toEqual([]);
  });

  test('a degenerate bucket count yields no points rather than nonsense distances', () => {
    // why: 0 produced a -Infinity first distance and negatives placed points beyond the run.
    for (const bucketCount of [0, -5, 2.5, NaN]) {
      expect(toRunProfile(straightRun(600, 3), bucketCount)).toEqual([]);
    }
  });
});

describe('toRunProfile pace', () => {
  test('a steady 3 m/s run reports ~333 s/km in every bucket', () => {
    const profile = toRunProfile(straightRun(600, 3), PROFILE_SAMPLE_COUNT);
    for (const point of profile) {
      expect(point.paceSecPerKm).toBeCloseTo(STEADY_PACE_SEC_PER_KM, -1);
    }
  });

  test('pace does not depend on how many buckets the run is cut into', () => {
    // The bug this pins (spec §5.2): a bucket's metres include the leg entering it, so timing
    // only from its first fix spanned one leg fewer than the distance and read fast by 1/N —
    // measured at 267.52 / 300.89 / 323.14 s/km for 120 / 60 / 20 buckets against a true 333.33.
    const fixes = straightRun(600, 3);
    const means = [120, 60, 20].map((count) => meanPace(toRunProfile(fixes, count)));
    for (const mean of means) {
      expect(mean).toBeCloseTo(STEADY_PACE_SEC_PER_KM, -1);
    }
    expect(Math.max(...means) - Math.min(...means)).toBeLessThan(0.001);
  });

  test('a short run is not biased where the bias was worst', () => {
    // why 5 minutes specifically: the 1/N bias worsens as runs shorten and hit -41.3% here,
    // and C25K runs live at exactly this length.
    expect(meanPace(toRunProfile(straightRun(300, 3)))).toBeCloseTo(STEADY_PACE_SEC_PER_KM, -1);
  });
});

describe('toRunProfile resampling', () => {
  test('the x extent equals the smoothed track distance the summary reports', () => {
    // The ADR 0021 §3 agreement guarantee: the last bucket's centre sits exactly half a
    // bucket short of the end, so adding that back must land on `smoothTrack` to the metre.
    const fixes = straightRun(600, 3);
    const profile = toRunProfile(fixes, PROFILE_SAMPLE_COUNT);
    const width = smoothTrack(fixes).distanceM / PROFILE_SAMPLE_COUNT;
    expect(profile.at(-1)!.distanceM + width / 2).toBeCloseTo(smoothTrack(fixes).distanceM, 9);
  });

  test('the grid is contiguous — no bucket is left empty and skipped', () => {
    // why this can fail: a bucket holding no fix never enters the map, so the chart would
    // jump a grid step and draw a gap. It is what the fixes-per-bucket floor exists to prevent.
    const profile = toRunProfile(straightRun(80, 3));
    const gaps = profile.slice(1).map((point, i) => point.distanceM - profile[i].distanceM);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1e-9);
    expect(profile[0].distanceM).toBeCloseTo(gaps[0] / 2, 9);
  });

  test('bucket count follows the fix count up to the cap, and every bucket measures a pace', () => {
    // 240 m aborted / early-W1 runs previously produced 120 buckets, 86 of them null.
    const sizes: [number, number][] = [
      [80, 16],
      [200, 40],
      [1667, PROFILE_SAMPLE_COUNT],
    ];
    for (const [fixCount, expectedPoints] of sizes) {
      const profile = toRunProfile(straightRun(fixCount, 3));
      expect(profile).toHaveLength(expectedPoints);
      expect(profile.every((p) => p.paceSecPerKm !== null)).toBe(true);
    }
  });

  test('a run too short to fill one bucket still yields a single point', () => {
    const profile = toRunProfile(straightRun(4, 3));
    expect(profile).toHaveLength(1);
    expect(profile[0].paceSecPerKm).toBeCloseTo(STEADY_PACE_SEC_PER_KM, -1);
  });
});
