import { describe, expect, test } from 'bun:test';

import { smoothTrack, type LocationFix } from './geo';
import {
  foldRunProfile,
  isDrawableProfile,
  paceRange,
  PROFILE_SAMPLE_COUNT,
  toRunProfile,
  type ProfilePoint,
} from './run-profile';

const DEG_PER_METRE = 1 / 111_320;

/**
 * A straight northward run at a steady pace, `metresPerFix` apart every `intervalMs`.
 * why hard-coded degrees: 1e-5 deg latitude is ~1.11 m, close enough that the
 * assertions below are about bucketing, not about haversine precision.
 */
function straightRun(count: number, metresPerFix: number, intervalMs = 1000): LocationFix[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: 1_000_000 + i * intervalMs,
    lat: 59.3 + i * metresPerFix * DEG_PER_METRE,
    lng: 18.06,
    altitude: 100,
    accuracy: 5,
    speed: metresPerFix / (intervalMs / 1000),
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

describe('toRunProfile cadence', () => {
  // The test that matters most (spec §14): a duration-based guard (revision 2's ACCRUAL_GUARD_S)
  // read a fix's own cadence into its verdict, so a 0.4 m/s walker went from 41:43 to 10:26 on a
  // single 1 ms cadence shift. The rate-based rule must not repeat that — a steady walker reports
  // its true pace at any fix interval.
  test('a steady walk reports its true pace at every fix cadence, not only exactly 1 Hz', () => {
    const cases: [mps: number, intervalMs: number][] = [
      [0.3, 1000],
      [0.35, 1001],
      [0.4, 900],
      [0.5, 1100],
      [0.8, 500],
      [1.4, 2000],
    ];
    for (const [mps, intervalMs] of cases) {
      const durationS = 600;
      const count = Math.round((durationS * 1000) / intervalMs);
      const metresPerFix = mps * (intervalMs / 1000);
      const profile = toRunProfile(straightRun(count, metresPerFix, intervalMs));
      const paces = profile
        .map((point) => point.paceSecPerKm)
        .filter((pace): pace is number => pace !== null);
      // why median and not meanPace: spec §6's own cadence table is measured on the median, which
      // is robust to the 1-2 buckets the deadband's start/end-of-track warm-up (§6's disclosed
      // floor cliff) can still tug — the same reason the deadband-floor test below uses it.
      const median = [...paces].sort((a, b) => a - b)[Math.floor(paces.length / 2)];
      expect(median).toBeCloseTo(1000 / mps, -1);
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

  test('a standstill with fixes is excluded, and only slows the bucket it happened in', () => {
    // Reverses the pace chart design's §5.2 decision that such a standstill must slow its bucket.
    // Measured there: a 6 s stop cost its bucket 2:49 /km, and the fixes keep arriving at ~1 Hz so
    // MAX_GAP_S never sees it (slice design §2, §3). Bar measured at the DEFAULT bucket count —
    // the hard-coded 20 this pinned before failed at 120 (spec §6, §7.1).
    const stalled = toRunProfile(
      phasedRun([
        { seconds: 300, mps: 3 },
        { seconds: 25, mps: 0 },
        { seconds: 300, mps: 3 },
      ]),
    );
    const paces = stalled
      .map((point) => point.paceSecPerKm)
      .filter((pace): pace is number => pace !== null);

    expect(Math.max(...paces)).toBeCloseTo(671, 0);

    // The stop is at the halfway point, so the first and last buckets must be untouched.
    expect(stalled[0].paceSecPerKm).toBeCloseTo(STEADY_PACE_SEC_PER_KM, -1);
    expect(stalled.at(-1)!.paceSecPerKm).toBeCloseTo(STEADY_PACE_SEC_PER_KM, -1);
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
    // bucket divides seconds by metres and the metres stop arriving (spec §2). 10/25/60/144, not
    // 5/6/7 — spec §6 measures the short-stop band as non-monotonic, so asserting it would pin a
    // number the rule does not deliver. Measured at the DEFAULT bucket count, not a hard-coded one.
    const slowest = [10, 25, 60, 144].map((stopS) => {
      const profile = toRunProfile(
        phasedRun([
          { seconds: 300, mps: 3 },
          { seconds: stopS, mps: 0 },
          { seconds: 300, mps: 3 },
        ]),
      );
      const paces = profile
        .map((point) => point.paceSecPerKm)
        .filter((pace): pace is number => pace !== null);
      return Math.max(...paces);
    });

    for (const pace of slowest) {
      expect(pace).toBeCloseTo(671, 0);
    }
    // The bound does not move with the stop's length — that is the property, not the value.
    expect(Math.max(...slowest) - Math.min(...slowest)).toBeLessThan(1);
  });

  test('a stationary head no longer flattens the chart', () => {
    const clean = bandContrast(toRunProfile(w1d1()));
    const withHead = bandContrast(
      toRunProfile(phasedRun([{ seconds: 45, mps: 0 }, ...w1d1Phases()])),
    );

    expect(clean).toBeGreaterThan(0.8);
    expect(withHead).toBeCloseTo(clean, 2);
  });

  test('a stationary tail costs a fixed deceleration, not a pole', () => {
    // why no bandContrast bar like the head's: a moving→stationary transition decays velocity over
    // ~3 fixes (geo.ts's Kalman lag), so ~1 m of real deceleration lands in the last bucket and
    // costs the tail a fixed ~1:26 against steady walking. That is deceleration, correctly kept —
    // excluding it would mean excluding legs that committed distance, the defect that sank an
    // earlier design. What must hold is that the cost does not grow with the stand.
    const worst = [30, 170, 600].map((standS) => {
      const profile = toRunProfile(phasedRun([...w1d1Phases(), { seconds: standS, mps: 0 }]));
      const paces = profile
        .map((point) => point.paceSecPerKm)
        .filter((pace): pace is number => pace !== null);
      return Math.max(...paces);
    });

    for (const pace of worst) {
      expect(pace).toBeLessThan((1000 / WALK_MPS) * 1.25);
    }
    expect(Math.max(...worst) - Math.min(...worst)).toBeLessThan(1);
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
    // The previous design deleted a leg at 1.90 m/s as standstill (spec §16). A fixture fast
    // enough that no case could fire (revision 2 used 1.4 m/s alone) let a mutant that excluded
    // real movement up to 1 m/s pass, so this sweeps speeds instead of folding one steady run.
    for (const mps of [0.3, 0.4, 0.5, 0.6, 0.8, 1.1, 1.4, 1.9, 2.8]) {
      expect(foldRunProfile(straightRun(600, mps)).excludedStandstillS).toBe(0);
    }
  });

  test('folded seconds equal elapsed minus excluded', () => {
    // why not the old conservation test: `(n−0.5)·T/n + T/2n === T` is an arithmetic identity that
    // passes a mutant which collapses the chart (spec §14). This instead checks every bucket is
    // measured, then sums the fold's own seconds back up against wall-clock elapsed time.
    const fixes = phasedRun([
      { seconds: 300, mps: 3 },
      { seconds: 60, mps: 0 },
      { seconds: 300, mps: 3 },
    ]);
    const fold = foldRunProfile(fixes);
    expect(fold.points.every((point) => point.paceSecPerKm !== null)).toBe(true);

    const width = smoothTrack(fixes).distanceM / fold.points.length;
    const foldedSeconds = fold.points.reduce(
      (sum, point) => sum + (point.paceSecPerKm! / 1000) * width,
      0,
    );
    const elapsedS = (fixes.at(-1)!.timestamp - fixes[0].timestamp) / 1000;
    expect(foldedSeconds).toBeCloseTo(elapsedS - fold.excludedStandstillS, 6);
  });

  test('foldRunProfile reports the stop and nothing else', () => {
    const moving = straightRun(600, 3);
    expect(foldRunProfile(moving).excludedStandstillS).toBe(0);

    const stopped = phasedRun([
      { seconds: 200, mps: 3 },
      { seconds: 60, mps: 0 },
      { seconds: 200, mps: 3 },
    ]);
    const excluded = foldRunProfile(stopped).excludedStandstillS;
    expect(excluded).toBeGreaterThan(50);
    expect(excluded).toBeLessThanOrEqual(60);
  });

  test('a bare gap is unmeasured, not a standstill', () => {
    // why: a gap leg commits nothing either, but it is already skipped by MAX_GAP_S and must not
    // be counted as excluded standstill or terminate-and-carry accrual across itself.
    expect(foldRunProfile(w1d1(240)).excludedStandstillS).toBe(0);
  });

  test('a duplicate timestamp does not discard accrued seconds', () => {
    // why: an untimed leg (seconds <= 0) must be transparent to the hold-run scan — treating it as
    // a terminator made a slow walker's every accrual run look like it never released (spec §5,
    // §16). Duplicating every 4th fix of a 0.4 m/s walk must still report ~41:40, not the 10:26 a
    // terminating untimed leg produced.
    const base = straightRun(600, 0.4);
    const withDuplicates: LocationFix[] = [];
    for (let i = 0; i < base.length; i += 1) {
      withDuplicates.push(base[i]);
      if (i % 4 === 3) withDuplicates.push({ ...base[i] });
    }
    expect(meanPace(toRunProfile(withDuplicates))).toBeCloseTo(1000 / 0.4, -2);
  });

  test('a velocity-gated burst is not standing', () => {
    // why: committedM === 0 has three causes (deadband hold, velocity-gate rejection, gap reset),
    // and conflating them made a multipath burst read as standing (spec §5). A runner at 3 m/s
    // through fixes jumping ±400 m for 20 s excludes nothing.
    const fixes: LocationFix[] = [];
    let timestamp = 1_000_000;
    let metres = 0;
    for (let second = 0; second < 100; second += 1) {
      metres += 3;
      timestamp += 1000;
      fixes.push({
        timestamp,
        lat: 59.3 + metres * DEG_PER_METRE,
        lng: 18.06,
        altitude: 100,
        accuracy: 5,
        speed: 3,
      });
    }
    for (let second = 0; second < 20; second += 1) {
      timestamp += 1000;
      const jump = second % 2 === 0 ? 400 : -400;
      fixes.push({
        timestamp,
        lat: 59.3 + (metres + jump) * DEG_PER_METRE,
        lng: 18.06,
        altitude: 100,
        accuracy: 5,
        speed: 3,
      });
    }
    for (let second = 0; second < 100; second += 1) {
      metres += 3;
      timestamp += 1000;
      fixes.push({
        timestamp,
        lat: 59.3 + metres * DEG_PER_METRE,
        lng: 18.06,
        altitude: 100,
        accuracy: 5,
        speed: 3,
      });
    }
    expect(foldRunProfile(fixes).excludedStandstillS).toBe(0);
  });
});
