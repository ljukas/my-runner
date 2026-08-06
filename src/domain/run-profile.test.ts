import { describe, expect, test } from 'bun:test';

import { smoothTrack, type LocationFix } from './geo';
import {
  isDrawableProfile,
  paceChartDomain,
  paceRange,
  PROFILE_SAMPLE_COUNT,
  toRunProfile,
  type ProfilePoint,
} from './run-profile';

const DEG_PER_METRE = 1 / 111_320;

function makeSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * A straight northward run at a steady pace. `noiseM` is 0 by default, so every other call site
 * stays exact; non-zero noise adds both position and interval jitter, drawn from a seeded PRNG,
 * never `Math.random()`.
 * why hard-coded degrees: 1e-5 deg latitude is ~1.11 m, close enough that the
 * assertions below are about bucketing, not about haversine precision.
 */
function straightRun(
  count: number,
  metresPerFix: number,
  intervalMs = 1000,
  noiseM = 0,
  seed = 1,
): LocationFix[] {
  const random = makeSeededRandom(seed);
  let timestamp = 1_000_000;
  const fixes: LocationFix[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i > 0) {
      const jitterMs = noiseM > 0 ? Math.round((random() - 0.5) * 6) : 0; // ±3 ms
      timestamp += intervalMs + jitterMs;
    }
    const positionNoiseM =
      noiseM > 0 ? (random() + random() + random() + random() - 2) * noiseM : 0;
    fixes.push({
      timestamp,
      lat: 59.3 + (i * metresPerFix + positionNoiseM) * DEG_PER_METRE,
      lng: 18.06,
      altitude: 100,
      accuracy: 5,
      speed: metresPerFix / (intervalMs / 1000),
    });
  }
  return fixes;
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

describe('toRunProfile pace fidelity', () => {
  // Noise-free, fixed-cadence fixtures (stationary-time design §10) hid three successive
  // standstill-classification regressions, because a slow walker only reads wrong once jitter
  // and position noise are both present.
  test('a slow walker reports true pace at any cadence, jitter, or position noise', () => {
    const cases: [mps: number, intervalMs: number][] = [
      [0.3, 1000],
      [0.4, 1001],
      [0.5, 900],
      [0.6, 1100],
      [0.8, 500],
      [1.4, 2000],
    ];
    for (const noiseM of [0.5, 1]) {
      for (const [mps, intervalMs] of cases) {
        const durationS = 600;
        const count = Math.round((durationS * 1000) / intervalMs);
        const metresPerFix = mps * (intervalMs / 1000);
        const profile = toRunProfile(straightRun(count, metresPerFix, intervalMs, noiseM));
        const mean = meanPace(profile);
        const truth = 1000 / mps;
        // why a relative bound: at 0.3 m/s, 1 m of noise is over 3x the per-fix signal, so an
        // absolute bound is unreachable here; 1% has real margin over the worst measured case
        // (0.38%) while still catching the 28-40% errors the earlier revisions had.
        expect(Math.abs(mean - truth) / truth).toBeLessThan(0.01);
      }
    }
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

describe('toRunProfile carry-forward', () => {
  test('a duplicate timestamp does not discard accrued seconds', () => {
    // why: a duplicate/backwards-timestamp leg carries no time of its own and must not clear the
    // carry — clearing it there reports a slow walker four times too fast (design §5).
    const base = straightRun(600, 0.4);
    const withDuplicates: LocationFix[] = [];
    for (let i = 0; i < base.length; i += 1) {
      withDuplicates.push(base[i]);
      if (i % 4 === 3) withDuplicates.push({ ...base[i] });
    }
    expect(meanPace(toRunProfile(withDuplicates))).toBeCloseTo(1000 / 0.4, -1);
  });

  test('total folded time is preserved except for a genuine gap', () => {
    // Every bucket is asserted non-null first so this can't pass vacuously on a chart the carry
    // silently emptied. The remaining seconds must equal wall-clock elapsed minus only the gap's
    // own duration — a standstill's seconds must still be in there somewhere.
    const gapAfterS = 40; // + the next leg's own 1 s = a 41 s leg, over MAX_GAP_S (30 s)
    const fixes = phasedRun([
      { seconds: 300, mps: 3 },
      { seconds: 40, mps: 0 },
      { seconds: 300, mps: 3, gapAfterS },
      { seconds: 300, mps: 3 },
    ]);
    const profile = toRunProfile(fixes);
    expect(profile.every((point) => point.paceSecPerKm !== null)).toBe(true);

    const width = smoothTrack(fixes).distanceM / profile.length;
    const foldedSeconds = profile.reduce(
      (sum, point) => sum + (point.paceSecPerKm! / 1000) * width,
      0,
    );
    const elapsedS = (fixes.at(-1)!.timestamp - fixes[0].timestamp) / 1000;
    expect(foldedSeconds).toBeCloseTo(elapsedS - (gapAfterS + 1), 6);
  });

  test("the bucket grid spans the run's smoothed total", () => {
    const fixes = phasedRun([
      { seconds: 300, mps: 3 },
      { seconds: 40, mps: 0 },
      { seconds: 300, mps: 3 },
    ]);
    const total = smoothTrack(fixes).distanceM;
    const profile = toRunProfile(fixes);
    expect(profile.every((point) => point.paceSecPerKm !== null)).toBe(true);

    // why: per-bucket metre conservation isn't observable through `ProfilePoint` (only
    // `distanceM`/`paceSecPerKm` are exposed) — that's pinned indirectly by the seconds test.
    const width = total / profile.length;
    expect(profile.at(-1)!.distanceM + width / 2).toBeCloseTo(total, 9);
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

  test('reports the domain, not the series, skipping unmeasured buckets', () => {
    // Only two measured values, so the 95th percentile lands on the slower of the two — the same
    // number the series' own max would give here, but sourced from `paceChartDomain`.
    expect(paceRange([point(400), point(null), point(300)])).toEqual({
      fastestSecPerKm: 300,
      slowestSecPerKm: 400,
      clippedCount: 0,
      clippedSlowestSecPerKm: null,
    });
  });

  test('a single measured bucket gets the domain floor, not its own value, as the slow bound', () => {
    // p95 of one value is that value, so the minimum-span floor is what actually sets
    // `slowestSecPerKm` here (360 * 1.1 = 396).
    expect(paceRange([point(360)])).toEqual({
      fastestSecPerKm: 360,
      slowestSecPerKm: 396,
      clippedCount: 0,
      clippedSlowestSecPerKm: null,
    });
  });

  test('a pole is reported as clipped, never as the range', () => {
    // The defect this pins (design §8.1): on a real capture the series' own max was 125:36 (7536
    // s/km) while the visible axis topped out at 10:25 — a number no sighted user could see.
    const profile = [
      ...Array.from({ length: 116 }, () => point(300)),
      point(400),
      point(500),
      point(600),
      point(7536),
    ];
    const range = paceRange(profile)!;
    expect(range.slowestSecPerKm).toBe(330); // the domain bound (p95 floor), never the pole
    expect(range.clippedCount).toBe(4);
    expect(range.clippedSlowestSecPerKm).toBe(7536);
  });

  test('a series with no outliers clips nothing', () => {
    // why uniform, not a real profile: a full 120-bucket run always has a slowest 5% by
    // construction (design §9) — "no outliers" only holds where nothing is slower than the
    // domain's own floor-widened bound, as here.
    const range = paceRange(Array.from({ length: 100 }, () => point(300)))!;
    expect(range.clippedCount).toBe(0);
    expect(range.clippedSlowestSecPerKm).toBeNull();
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

describe('paceChartDomain', () => {
  const point = (paceSecPerKm: number | null): ProfilePoint => ({ distanceM: 0, paceSecPerKm });

  test('a series with nothing measured has no domain', () => {
    expect(paceChartDomain([])).toBeUndefined();
    expect(paceChartDomain([point(null), point(null)])).toBeUndefined();
  });

  test('the fast bound is the minimum and the slow bound is the 95th percentile', () => {
    const profile = Array.from({ length: 100 }, (_, i) => point(i + 1)); // 1..100
    // p95 here is 96, so the top 4 (97-100) are what the chart clips.
    expect(paceChartDomain(profile)).toEqual([96, 1]);
  });

  test('a perfectly uniform series still gets a non-zero-width domain', () => {
    // why this matters: p95 equals the minimum on a uniform series, so without a floor the domain
    // would collapse to zero width (design §6).
    const profile = Array.from({ length: 20 }, () => point(300));
    expect(paceChartDomain(profile)).toEqual([330, 300]);
  });

  test('a single measured point still gets a non-zero-width domain', () => {
    expect(paceChartDomain([point(360)])).toEqual([396, 360]);
  });
});
