import { describe, expect, test } from 'bun:test';

import { smoothTrack, type LocationFix } from './geo';
import {
  describeProfile,
  isDrawableProfile,
  PROFILE_SAMPLE_COUNT,
  toRunProfile,
  type ProfilePoint,
} from './run-profile';

const DEG_PER_METRE = 1 / 111_320;

/**
 * A straight northward run at a steady pace. 1 Hz, `metresPerFix` apart.
 * why hard-coded degrees: 1e-5 deg latitude is ~1.11 m, close enough that the
 * assertions below are about bucketing, not about haversine precision.
 */
function straightRun(count: number, metresPerFix: number): LocationFix[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: 1_000_000 + i * 1000,
    lat: 59.3 + i * metresPerFix * DEG_PER_METRE,
    lng: 18.06,
    altitude: 100,
    accuracy: 5,
    speed: metresPerFix,
  }));
}

interface Phase {
  seconds: number;
  mps: number;
  /** Seconds of wall clock that pass with no fix recorded at all — a pause, or a GPS dropout. */
  gapAfterS?: number;
}

/** A straight northward run whose speed changes per phase, at 1 Hz. */
function phasedRun(phases: Phase[]): LocationFix[] {
  const fixes: LocationFix[] = [];
  let timestamp = 1_000_000;
  let metres = 0;
  for (const phase of phases) {
    for (let second = 0; second < phase.seconds; second += 1) {
      metres += phase.mps;
      timestamp += 1000;
      fixes.push({
        timestamp,
        lat: 59.3 + metres * DEG_PER_METRE,
        lng: 18.06,
        altitude: 100,
        accuracy: 5,
        speed: phase.mps,
      });
    }
    timestamp += (phase.gapAfterS ?? 0) * 1000;
  }
  return fixes;
}

const RUN_MPS = 2.8;
const WALK_MPS = 1.4;

/** The W1D1 shape: a walking warm-up, 8 × (60 s run / 90 s walk), a walking cool-down. */
function w1d1(gapAfterFirstRunS = 0): LocationFix[] {
  const phases: Phase[] = [{ seconds: 300, mps: WALK_MPS }];
  for (let interval = 0; interval < 8; interval += 1) {
    phases.push({
      seconds: 60,
      mps: RUN_MPS,
      gapAfterS: interval === 0 ? gapAfterFirstRunS : 0,
    });
    phases.push({ seconds: 90, mps: WALK_MPS });
  }
  phases.push({ seconds: 300, mps: WALK_MPS });
  return phasedRun(phases);
}

/**
 * How much of the auto-fit y-axis the genuine run/walk separation occupies. A single outlier bucket
 * widens the span without moving the bands, so this collapses exactly when the chart becomes
 * unreadable — 0.86 on a clean W1D1, 0.043 when a 240 s pause was charged to one bucket.
 */
function bandContrast(profile: ProfilePoint[]): number {
  const paces = profile
    .map((point) => point.paceSecPerKm)
    .filter((pace): pace is number => pace !== null);
  return (1000 / WALK_MPS - 1000 / RUN_MPS) / (Math.max(...paces) - Math.min(...paces));
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
    // The bug this pins (spec §5.2; mechanism at Bucket.entryTimestamp): 267.52 / 300.89 / 323.14
    // s/km for 120 / 60 / 20 buckets against a true 333.33.
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
    // ADR 0021 §3: the chart's x extent must agree with the summary's headline distance.
    const fixes = straightRun(600, 3);
    const profile = toRunProfile(fixes, PROFILE_SAMPLE_COUNT);
    const width = smoothTrack(fixes).distanceM / PROFILE_SAMPLE_COUNT;
    expect(profile.at(-1)!.distanceM + width / 2).toBeCloseTo(smoothTrack(fixes).distanceM, 9);
  });

  test('the grid is contiguous — no bucket is left empty and skipped', () => {
    // why this can fail: a bucket holding no fix never enters the map, so the chart would
    // jump a grid step and draw a gap.
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

  test('the grid stays contiguous when the run changes speed', () => {
    // why beyond the uniform case: bucket width is fix-density-driven, so a slow phase packs fixes
    // into few buckets and a fast one can step a whole bucket — which used to leave it absent.
    const profile = toRunProfile(w1d1());
    expect(profile).toHaveLength(PROFILE_SAMPLE_COUNT);
    const gaps = profile.slice(1).map((point, i) => point.distanceM - profile[i].distanceM);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1e-9);
  });
});

describe('toRunProfile gaps', () => {
  test('a pause does not become an outlier that flattens the rest of the chart', () => {
    // The bug this pins: bucket time was raw last − entry, so the bucket spanning a stop swallowed
    // it whole. Measured on this fixture: 4.3% of the axis at 240 s, against 86% clean.
    const clean = bandContrast(toRunProfile(w1d1()));
    expect(clean).toBeGreaterThan(0.8);

    for (const pauseS of [35, 240, 600]) {
      expect(bandContrast(toRunProfile(w1d1(pauseS)))).toBeGreaterThan(0.8);
    }
  });

  test('no bucket reads slower than walking because of a gap', () => {
    const profile = toRunProfile(w1d1(240));
    const slowest = Math.max(
      ...profile.map((point) => point.paceSecPerKm).filter((pace): pace is number => pace !== null),
    );
    expect(slowest).toBeLessThan((1000 / WALK_MPS) * 1.5);
  });

  test('a standstill with fixes still counts as time — only gaps are excluded', () => {
    // why: a traffic light the runner never paused for is real elapsed time and must slow its
    // bucket. Only a bare timestamp gap (pause / dropout) is unmeasured.
    const stalled = toRunProfile(
      phasedRun([
        { seconds: 300, mps: 3 },
        { seconds: 25, mps: 0 },
        { seconds: 300, mps: 3 },
      ]),
      20,
    );
    const paces = stalled
      .map((point) => point.paceSecPerKm)
      .filter((pace): pace is number => pace !== null);
    expect(Math.max(...paces)).toBeGreaterThan(STEADY_PACE_SEC_PER_KM * 1.2);
    expect(Math.min(...paces)).toBeCloseTo(STEADY_PACE_SEC_PER_KM, -1);
  });
});

describe('isDrawableProfile', () => {
  const point = (paceSecPerKm: number | null): ProfilePoint => ({ distanceM: 0, paceSecPerKm });

  test('needs two ADJACENT measured buckets, which is the least a stroke needs', () => {
    expect(isDrawableProfile([])).toBe(false);
    expect(isDrawableProfile([point(300)])).toBe(false);
    expect(isDrawableProfile([point(300), point(null)])).toBe(false);
    // Two measured buckets, but the null between them splits the line into two unstrokable groups.
    expect(isDrawableProfile([point(300), point(null), point(320)])).toBe(false);
    expect(isDrawableProfile([point(300), point(320)])).toBe(true);
    expect(isDrawableProfile([point(null), point(300), point(320)])).toBe(true);
  });

  test('a real W1D1 is drawable', () => {
    expect(isDrawableProfile(toRunProfile(w1d1()))).toBe(true);
    expect(isDrawableProfile(toRunProfile(w1d1(240)))).toBe(true);
  });
});

describe('describeProfile', () => {
  const point = (paceSecPerKm: number | null): ProfilePoint => ({ distanceM: 0, paceSecPerKm });

  test('a series with nothing measured describes nothing', () => {
    expect(describeProfile([])).toBeNull();
    expect(describeProfile([point(null), point(null)])).toBeNull();
  });

  test('reports the extremes and the direction of travel', () => {
    expect(describeProfile([point(400), point(null), point(300)])).toEqual({
      fastestSecPerKm: 300,
      slowestSecPerKm: 400,
      trend: 'faster',
    });
    expect(describeProfile([point(300), point(400)])?.trend).toBe('slower');
    expect(describeProfile([point(300), point(305)])?.trend).toBe('steady');
  });

  test('a single measured bucket has extremes but no direction', () => {
    expect(describeProfile([point(360)])).toEqual({
      fastestSecPerKm: 360,
      slowestSecPerKm: 360,
      trend: 'steady',
    });
  });
});
