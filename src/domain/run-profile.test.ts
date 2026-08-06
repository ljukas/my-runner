import { describe, expect, test } from 'bun:test';

import { smoothTrack, type LocationFix } from './geo';
import {
  excludedStandstillSeconds,
  isDrawableProfile,
  paceRange,
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

/** W1D1's phases, for fixtures that need to bracket them with a standstill. */
function w1d1Phases(): Phase[] {
  const phases: Phase[] = [{ seconds: 300, mps: WALK_MPS }];
  for (let interval = 0; interval < 8; interval += 1) {
    phases.push({ seconds: 60, mps: RUN_MPS });
    phases.push({ seconds: 90, mps: WALK_MPS });
  }
  phases.push({ seconds: 300, mps: WALK_MPS });
  return phases;
}

/** The W1D1 shape: a walking warm-up, 8 × (60 s run / 90 s walk), a walking cool-down. */
function w1d1(gapAfterFirstRunS = 0): LocationFix[] {
  const phases = w1d1Phases();
  if (gapAfterFirstRunS > 0) phases[1] = { ...phases[1], gapAfterS: gapAfterFirstRunS };
  return phasedRun(phases);
}

/**
 * How much of the auto-fit y-axis the genuine run/walk separation occupies. A single outlier bucket
 * widens the span without moving the bands, so this collapses exactly when the chart becomes
 * unreadable — 0.960 on a clean W1D1, 0.038 when a 240 s pause was charged to one bucket.
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
    // it whole. Measured on this fixture: 3.8% of the axis at 240 s, against 96.0% clean; every
    // gap length below now reads 96.0% (spec §5.2).
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

describe('paceRange', () => {
  const point = (paceSecPerKm: number | null): ProfilePoint => ({ distanceM: 0, paceSecPerKm });

  test('a series with nothing measured describes nothing', () => {
    expect(paceRange([])).toBeNull();
    expect(paceRange([point(null), point(null)])).toBeNull();
  });

  test('reports the extremes, skipping unmeasured buckets', () => {
    expect(paceRange([point(400), point(null), point(300)])).toEqual({
      fastestSecPerKm: 300,
      slowestSecPerKm: 400,
    });
  });

  test('a single measured bucket is its own range', () => {
    expect(paceRange([point(360)])).toEqual({ fastestSecPerKm: 360, slowestSecPerKm: 360 });
  });

  test('a W1D1 range spans both interval bands, and no half-vs-half trend could say so', () => {
    // why this pins the removed trend sentence: an interval plan puts the same run/walk mix in
    // both halves by construction, so a first-half/second-half mean comparison called this run
    // "steady" — a run that alternated eight times between these two bands.
    const profile = toRunProfile(w1d1());
    const range = paceRange(profile)!;
    expect(range.fastestSecPerKm).toBeLessThan(1000 / RUN_MPS + 30);
    expect(range.slowestSecPerKm).toBeGreaterThan(1000 / WALK_MPS - 30);

    const paces = profile
      .map((p) => p.paceSecPerKm)
      .filter((pace): pace is number => pace !== null);
    const half = Math.floor(paces.length / 2);
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean(paces.slice(0, half)) / mean(paces.slice(-half))).toBeCloseTo(1, 1);
  });
});

describe('toRunProfile standstill', () => {
  test('a mid-run stop no longer poles its bucket, whatever its length', () => {
    // why lengths: today a stop's bucket grows without bound with the stop, because a distance
    // bucket divides seconds by metres and the metres stop arriving (spec §2).
    const slowest = [25, 60, 144].map((stopS) => {
      const profile = toRunProfile(
        phasedRun([
          { seconds: 300, mps: 3 },
          { seconds: stopS, mps: 0 },
          { seconds: 300, mps: 3 },
        ]),
        20,
      );
      const paces = profile
        .map((point) => point.paceSecPerKm)
        .filter((pace): pace is number => pace !== null);
      return Math.max(...paces);
    });

    for (const pace of slowest) {
      expect(pace).toBeLessThan(STEADY_PACE_SEC_PER_KM * 1.2);
    }
    // The bound does not move with the stop's length — that is the property, not the value.
    expect(Math.max(...slowest) - Math.min(...slowest)).toBeLessThan(1);
  });

  test('a stationary head or tail no longer flattens the chart', () => {
    const clean = bandContrast(toRunProfile(w1d1()));
    const withHead = bandContrast(
      toRunProfile(phasedRun([{ seconds: 45, mps: 0 }, ...w1d1Phases()])),
    );
    const withTail = bandContrast(
      toRunProfile(phasedRun([...w1d1Phases(), { seconds: 170, mps: 0 }])),
    );

    expect(clean).toBeGreaterThan(0.8);
    expect(withHead).toBeGreaterThan(0.8);
    expect(withTail).toBeGreaterThan(0.8);
  });

  test('a walker slower than the deadband is not reported faster than they ran', () => {
    // why this is the assertion that matters: dropping the deadband's accrual seconds instead of
    // carrying them reports a 0.4 m/s walker at 10:26 /km against a true 41:40 (spec §5 case 3).
    for (const mps of [0.4, 0.5, 0.6, 0.8, 1.1, 1.4]) {
      const profile = toRunProfile(straightRun(600, mps));
      const paces = profile
        .map((point) => point.paceSecPerKm)
        .filter((pace): pace is number => pace !== null);

      expect(paces).toHaveLength(profile.length);
      const median = [...paces].sort((a, b) => a - b)[Math.floor(paces.length / 2)];
      expect(median).toBeCloseTo(1000 / mps, -1);
    }
  });

  test('a leg that committed distance is never excluded', () => {
    // The previous design deleted a leg at 1.90 m/s as standstill (spec §16). This pins that a
    // moving run loses no time at all: its mean pace must equal the untouched steady case.
    const profile = toRunProfile(straightRun(600, 1.4));
    expect(meanPace(profile)).toBeCloseTo(1000 / 1.4, -1);
  });

  test('the buckets still sum to the run distance', () => {
    // why: an excluded leg committed nothing, so there are no metres to lose — conservation is
    // exact, not approximate (spec §6).
    const fixes = phasedRun([
      { seconds: 200, mps: 3 },
      { seconds: 60, mps: 0 },
      { seconds: 200, mps: 3 },
    ]);
    const profile = toRunProfile(fixes, 20);
    const width = smoothTrack(fixes).distanceM / 20;
    expect(profile.at(-1)!.distanceM + width / 2).toBeCloseTo(smoothTrack(fixes).distanceM, 9);
  });

  test('excludedStandstillSeconds reports the stop and nothing else', () => {
    const moving = straightRun(600, 3);
    expect(excludedStandstillSeconds(moving)).toBe(0);

    const stopped = phasedRun([
      { seconds: 200, mps: 3 },
      { seconds: 60, mps: 0 },
      { seconds: 200, mps: 3 },
    ]);
    const excluded = excludedStandstillSeconds(stopped);
    expect(excluded).toBeGreaterThan(50);
    expect(excluded).toBeLessThanOrEqual(60);
  });

  test('a bare gap is unmeasured, not a standstill', () => {
    // why: a gap leg commits nothing either, but it is already skipped by MAX_GAP_S and must not
    // be counted as excluded standstill or terminate-and-carry accrual across itself.
    expect(excludedStandstillSeconds(w1d1(240))).toBe(0);
  });
});
