import { describe, expect, test } from 'bun:test';

import { EARTH_RADIUS_M, MAX_GAP_S, smoothTrack, type LocationFix, type SegmentedFix } from './geo';
import {
  createMotionState,
  createOpenTrackState,
  labelledSpeeds,
  learnThreshold,
  motionStep,
  openTrackStep,
  rollupOpenTrack,
  type LabelledSpeed,
  type MotionSample,
  type MotionTransition,
  type OpenTrackState,
} from './run-motion';

const T = 2.1;

/** 1 Hz samples from t = `startMs`, one per speed; `null` is a step with no velocity. */
function samplesAt(speeds: readonly (number | null)[], startMs = 0): MotionSample[] {
  return speeds.map((speedMps, i) => ({ atMs: startMs + i * 1000, speedMps }));
}

const repeat = (speed: number | null, times: number) => Array<number | null>(times).fill(speed);

/** Folds `samples` from a fresh state; returns every transition with the index of the sample that emitted it. */
function transitionsOf(
  samples: readonly MotionSample[],
): { index: number; transition: MotionTransition }[] {
  let state = createMotionState();
  const out: { index: number; transition: MotionTransition }[] = [];
  samples.forEach((sample, index) => {
    const step = motionStep(state, sample, T);
    state = step.state;
    if (step.transition) out.push({ index, transition: step.transition });
  });
  return out;
}

describe('motionStep', () => {
  test('the first sample with a speed sets the kind at once, ignoring earlier nulls', () => {
    expect(transitionsOf(samplesAt([null, null, 1.5, 1.5]))).toEqual([
      { index: 2, transition: { kind: 'walk', atMs: 2000 } },
    ]);
  });

  test('a steady walk emits no transition after the first', () => {
    expect(transitionsOf(samplesAt(repeat(1.6, 60)))).toHaveLength(1);
  });

  test('confirms a run after 8 s and backdates the boundary to where it began', () => {
    const t = transitionsOf(samplesAt([...repeat(1.6, 20), ...repeat(2.5, 20)]));
    // candidate starts at sample 20 (t = 20 s); 28 s − 20 s reaches the 8 s dwell
    expect(t[1]).toEqual({ index: 28, transition: { kind: 'run', atMs: 20_000 } });
  });

  test('a 3 s surge inside a walk never becomes a run', () => {
    const t = transitionsOf(samplesAt([...repeat(1.6, 10), ...repeat(2.5, 3), ...repeat(1.6, 20)]));
    expect(t.map((x) => x.transition.kind)).toEqual(['walk']);
  });

  test('a change that has already reverted is not confirmed, even after 8 s', () => {
    // runs t = 20…27 s, back to walking at 28 s: the dwell is met on a sample that no longer runs
    const t = transitionsOf(samplesAt([...repeat(1.6, 20), ...repeat(2.5, 8), ...repeat(1.6, 20)]));
    expect(t.map((x) => x.transition.kind)).toEqual(['walk']);
  });

  test('starting to run straight out of a stop is run, never walk', () => {
    const t = transitionsOf(samplesAt([...repeat(0.2, 20), ...repeat(2.6, 20)]));
    expect(t.map((x) => x.transition)).toEqual([
      { kind: 'stopped', atMs: 0 },
      { kind: 'run', atMs: 20_000 },
    ]);
  });

  test('a candidate is confirmed as the kind most of its samples implied, not its last sample', () => {
    // walking from 20 s with one very slow sample at 28 s: walk (8 samples) beats stopped (1)
    const t = transitionsOf(
      samplesAt([...repeat(2.5, 20), ...repeat(1.5, 8), 0.3, ...repeat(1.5, 5)]),
    );
    expect(t[1]?.transition).toEqual({ kind: 'walk', atMs: 20_000 });
  });

  test('one noisy slow sample does not turn a walk after a run into a stop', () => {
    const t = transitionsOf(
      samplesAt([...repeat(2.5, 10), ...repeat(1.2, 8), 0.4, ...repeat(1.2, 20)]),
    );
    expect(t.map((x) => x.transition)).toEqual([
      { kind: 'run', atMs: 0 },
      { kind: 'walk', atMs: 10_000 },
    ]);
  });

  test('a jogger hovering near the threshold is confirmed when most samples agree', () => {
    // 4 of every 5 samples at or above T — revision 1's reset-on-return never confirmed this
    const hover = Array.from({ length: 30 }, (_, i) => (i % 5 === 4 ? 2.0 : 2.2));
    const t = transitionsOf(samplesAt([...repeat(1.6, 10), ...hover]));
    expect(t[1]?.transition).toEqual({ kind: 'run', atMs: 10_000 });
  });

  test('stopping straight out of a run is stopped from the first slow second, never walk', () => {
    const t = transitionsOf(samplesAt([...repeat(2.5, 20), ...repeat(0.2, 20)]));
    expect(t.map((x) => x.transition)).toEqual([
      { kind: 'run', atMs: 0 },
      { kind: 'stopped', atMs: 20_000 },
    ]);
  });

  test('a candidate that slows from walk into a stop keeps its start', () => {
    const t = transitionsOf(samplesAt([...repeat(2.5, 20), ...repeat(1.5, 4), ...repeat(0.2, 10)]));
    expect(t[1]?.transition).toEqual({ kind: 'stopped', atMs: 20_000 });
  });

  test('leaving a stop needs more than 0.8 m/s, not just more than 0.5', () => {
    const t = transitionsOf(
      samplesAt([...repeat(0.2, 10), ...repeat(0.7, 20), ...repeat(0.9, 20)]),
    );
    expect(t.map((x) => x.transition)).toEqual([
      { kind: 'stopped', atMs: 0 },
      { kind: 'walk', atMs: 30_000 },
    ]);
  });

  test('a stretch with no velocity holds the current kind', () => {
    const t = transitionsOf(samplesAt([...repeat(2.5, 10), ...repeat(null, 60)]));
    expect(t).toHaveLength(1);
  });

  test('a sample after a pause discards the candidate that began before it', () => {
    const before = samplesAt([...repeat(2.5, 20), ...repeat(1.5, 5)]);
    const after = samplesAt(repeat(1.5, 10), 60_000).map((s, i) =>
      i === 0 ? { ...s, afterPause: true } : s,
    );
    const t = transitionsOf([...before, ...after]);
    expect(t[1]?.transition).toEqual({ kind: 'walk', atMs: 60_000 });
  });
});

const DEG_PER_M = 180 / (Math.PI * EARTH_RADIUS_M);

interface Leg {
  seconds: number;
  mps: number;
  /** Seconds with no fix after this leg, during which the runner still covers `mps` × the gap. */
  gapAfterS?: number;
}

/** A 1 Hz northward track from t = 1 s; a gap advances the position but records no fix. */
function track(legs: readonly Leg[]): LocationFix[] {
  const fixes: LocationFix[] = [];
  let t = 0;
  let northM = 0;
  for (const leg of legs) {
    for (let s = 0; s < leg.seconds; s += 1) {
      t += 1000;
      northM += leg.mps;
      fixes.push({
        timestamp: t,
        lat: 59 + northM * DEG_PER_M,
        lng: 18,
        altitude: null,
        accuracy: 5,
        speed: null,
      });
    }
    t += (leg.gapAfterS ?? 0) * 1000;
    northM += leg.mps * (leg.gapAfterS ?? 0);
  }
  return fixes;
}

const endOf = (fixes: readonly LocationFix[]) => fixes[fixes.length - 1].timestamp;

describe('rollupOpenTrack', () => {
  test('a run with no fixes has no buckets', () => {
    const rollup = rollupOpenTrack([], { thresholdMps: T, paused: [], startMs: 0, endMs: 60_000 });
    expect(rollup).toMatchObject({ distanceM: 0, buckets: [] });
  });

  test('distance is exactly the plain smoother fold, and the buckets add up to it', () => {
    const fixes = track([
      { seconds: 60, mps: 1.5 },
      { seconds: 60, mps: 2.6 },
    ]);
    const rollup = rollupOpenTrack(fixes, {
      thresholdMps: T,
      paused: [],
      startMs: 0,
      endMs: endOf(fixes),
    });
    expect(rollup.distanceM).toBe(smoothTrack(fixes).distanceM);
    expect(rollup.buckets.reduce((sum, b) => sum + b.distanceM, 0)).toBeCloseTo(
      rollup.distanceM,
      9,
    );
  });

  test('buckets tile the run from its start to its end without gaps', () => {
    const fixes = track([
      { seconds: 60, mps: 1.5 },
      { seconds: 60, mps: 2.6 },
    ]);
    const { buckets } = rollupOpenTrack(fixes, {
      thresholdMps: T,
      paused: [],
      startMs: 0,
      endMs: 125_000,
    });
    expect(buckets[0].startMs).toBe(0);
    expect(buckets[buckets.length - 1].endMs).toBe(125_000);
    expect(buckets.slice(1).map((b) => b.startMs)).toEqual(
      buckets.slice(0, -1).map((b) => b.endMs),
    );
  });

  test('a walk then a run are two buckets, split within a few seconds of the change', () => {
    const fixes = track([
      { seconds: 60, mps: 1.5 },
      { seconds: 60, mps: 2.6 },
    ]);
    const { buckets } = rollupOpenTrack(fixes, {
      thresholdMps: T,
      paused: [],
      startMs: 0,
      endMs: endOf(fixes),
    });
    expect(buckets.map((b) => [b.seq, b.kind])).toEqual([
      [0, 'walk'],
      [1, 'run'],
    ]);
    // the first run fix is at t = 61 s; the Kalman speed crosses T a few seconds later
    expect(buckets[1].startMs).toBeGreaterThanOrEqual(61_000);
    expect(buckets[1].startMs).toBeLessThanOrEqual(66_000);
  });

  test('paused time is not active time', () => {
    const fixes = track([
      { seconds: 30, mps: 1.5, gapAfterS: 20 },
      { seconds: 30, mps: 1.5 },
    ]);
    const paused = [{ fromMs: 30_500, toMs: 50_500 }];
    const { buckets } = rollupOpenTrack(fixes, {
      thresholdMps: T,
      paused,
      startMs: 0,
      endMs: endOf(fixes),
    });
    expect(buckets.reduce((sum, b) => sum + b.activeS, 0)).toBeCloseTo(endOf(fixes) / 1000 - 20, 9);
  });

  test('ground covered while paused is not counted, though the plain fold would count it', () => {
    // 20 s at 1.5 m/s during the pause = 30 m; under MAX_GAP_S, so smoothTrack bridges it
    const fixes = track([
      { seconds: 30, mps: 1.5, gapAfterS: 20 },
      { seconds: 30, mps: 1.5 },
    ]);
    const paused = [{ fromMs: 30_500, toMs: 50_500 }];
    const rollup = rollupOpenTrack(fixes, {
      thresholdMps: T,
      paused,
      startMs: 0,
      endMs: endOf(fixes),
    });
    expect(smoothTrack(fixes).distanceM - rollup.distanceM).toBeGreaterThan(25);
  });

  test('a GPS gap longer than MAX_GAP_S mid-run becomes a stopped bucket with no distance', () => {
    const gapS = MAX_GAP_S + 30;
    const fixes = track([
      { seconds: 60, mps: 2.6, gapAfterS: gapS },
      { seconds: 60, mps: 2.6 },
    ]);
    const { buckets } = rollupOpenTrack(fixes, {
      thresholdMps: T,
      paused: [],
      startMs: 0,
      endMs: endOf(fixes),
    });
    expect(buckets.map((b) => b.kind)).toEqual(['run', 'stopped', 'run']);
    expect(buckets[1]).toMatchObject({
      startMs: 60_000,
      endMs: 60_000 + (gapS + 1) * 1000,
      distanceM: 0,
    });
  });
});

const labelled = (
  kind: LabelledSpeed['kind'],
  speedMps: number,
  times: number,
  msIntoSegment = 20_000,
) => Array.from({ length: times }, (): LabelledSpeed => ({ kind, speedMps, msIntoSegment }));

/** The live engine's view: one `openTrackStep` per fix, from `state`. */
function liveFold(
  fixes: readonly LocationFix[],
  paused = [] as { fromMs: number; toMs: number }[],
  state = createOpenTrackState(),
) {
  let s: OpenTrackState = state;
  let distanceM = 0;
  for (const fix of fixes) {
    const step = openTrackStep(s, fix, { thresholdMps: T, paused });
    s = step.state;
    distanceM += step.acceptedDeltaMeters;
  }
  return { state: s, distanceM };
}

describe('openTrackStep — the live half of the fold', () => {
  const fixes = track([
    { seconds: 60, mps: 1.5 },
    { seconds: 60, mps: 2.6, gapAfterS: 20 },
    { seconds: 60, mps: 1.5 },
  ]);
  const paused = [{ fromMs: 120_500, toMs: 140_500 }];

  test('stepping fix by fix reaches the batch fold’s distance and its final kind', () => {
    const live = liveFold(fixes, paused);
    const batch = rollupOpenTrack(fixes, {
      thresholdMps: T,
      paused,
      startMs: 0,
      endMs: endOf(fixes),
    });
    expect(live.distanceM).toBe(batch.distanceM);
    expect(live.state.motion.kind).toBe(batch.buckets[batch.buckets.length - 1].kind);
  });

  test('a fold resumed from its mid-stream state ends where the uninterrupted one does', () => {
    const whole = liveFold(fixes, paused);
    const first = liveFold(fixes.slice(0, 90), paused);
    const resumed = liveFold(fixes.slice(90), paused, first.state);
    // why close, not equal: two partial sums re-associate the floating-point additions
    expect(first.distanceM + resumed.distanceM).toBeCloseTo(whole.distanceM, 9);
    expect(resumed.state).toEqual(whole.state);
  });

  test('never mutates the state it was given', () => {
    const before = liveFold(fixes.slice(0, 30)).state;
    const snapshot = structuredClone(before);
    openTrackStep(before, fixes[30], { thresholdMps: T, paused: [] });
    expect(before).toEqual(snapshot);
  });
});

describe('rollupOpenTrack — durations and bounds', () => {
  test('integer bucket durations sum to the rounded active time', () => {
    const fixes = track([
      { seconds: 45, mps: 1.5 },
      { seconds: 50, mps: 2.6 },
      { seconds: 40, mps: 1.5 },
    ]);
    const paused = [{ fromMs: 20_300, toMs: 21_000 }];
    const { buckets } = rollupOpenTrack(fixes, {
      thresholdMps: T,
      paused,
      startMs: 0,
      endMs: 135_400,
    });
    const active = buckets.reduce((sum, b) => sum + b.activeS, 0);
    expect(buckets.reduce((sum, b) => sum + b.durationS, 0)).toBe(Math.round(active));
    buckets.forEach((b) => expect(Math.abs(b.durationS - b.activeS)).toBeLessThan(1));
  });

  test('fixes after the run ended add no distance', () => {
    const fixes = track([{ seconds: 120, mps: 2.6 }]);
    const options = { thresholdMps: T, paused: [], startMs: 0 };
    const cut = rollupOpenTrack(fixes, { ...options, endMs: 60_000 });
    const upToCut = rollupOpenTrack(
      fixes.filter((f) => f.timestamp <= 60_000),
      { ...options, endMs: 60_000 },
    );
    expect(cut.distanceM).toBe(upToCut.distanceM);
  });
});

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** `track`, with ±~1 m of seeded position noise on every fix — what a phone actually reports. */
function noisyTrack(legs: readonly Leg[], seed = 7): LocationFix[] {
  const random = seededRandom(seed);
  return track(legs).map((fix) => {
    const noiseM = random() + random() + random() + random() - 2;
    return { ...fix, lat: fix.lat + noiseM * DEG_PER_M };
  });
}

const secondsOf = (buckets: readonly { kind: string; activeS: number }[], kind: string) =>
  buckets.filter((b) => b.kind === kind).reduce((sum, b) => sum + b.activeS, 0);

describe('rollupOpenTrack — hostile fix streams (stage-1 review)', () => {
  const options = (
    fixes: readonly LocationFix[],
    paused: { fromMs: number; toMs: number }[] = [],
  ) => ({
    thresholdMps: T,
    paused,
    startMs: 0,
    endMs: endOf(fixes),
  });

  test('a late fix stamped in the past is ignored, not read as a gap', () => {
    const fixes = track([{ seconds: 120, mps: 3 }]);
    const late = { ...fixes[9] }; // t = 10 s, delivered after t = 100 s
    const shuffled = [...fixes.slice(0, 100), late, ...fixes.slice(100)];
    const rollup = rollupOpenTrack(shuffled, options(fixes));
    expect(rollup.buckets.map((b) => b.kind)).toEqual(['run']);
    expect(rollup.distanceM).toBe(rollupOpenTrack(fixes, options(fixes)).distanceM);
  });

  test('a fix the velocity gate rejected does not move the time later fixes are measured from', () => {
    const fixes = track([{ seconds: 60, mps: 2.5 }]);
    const spike = { ...fixes[30], timestamp: 31_500, lat: fixes[30].lat + 0.01 }; // ~1 km off
    const between = { ...fixes[30], timestamp: 31_200 }; // after the last accepted fix, before the spike
    const stream = [...fixes.slice(0, 31), spike, between, ...fixes.slice(31)];
    expect(rollupOpenTrack(stream, options(fixes)).distanceM).toBe(smoothTrack(stream).distanceM);
  });

  test('fixes stamped inside a pause are not counted', () => {
    const fixes = track([{ seconds: 180, mps: 1.5 }]); // the runner keeps walking while paused
    const paused = [{ fromMs: 60_500, toMs: 120_500 }];
    const outside = fixes.filter((f) => f.timestamp < 60_500 || f.timestamp >= 120_500);
    expect(rollupOpenTrack(fixes, options(fixes, paused)).distanceM).toBe(
      rollupOpenTrack(outside, options(fixes, paused)).distanceM,
    );
  });

  test('fixes after a pause that never ended are not counted', () => {
    const fixes = track([{ seconds: 100, mps: 3 }]);
    const paused = [{ fromMs: 50_500, toMs: Infinity }];
    const before = fixes.filter((f) => f.timestamp < 50_500);
    expect(rollupOpenTrack(fixes, options(fixes, paused)).distanceM).toBe(
      rollupOpenTrack(before, options(fixes, paused)).distanceM,
    );
  });

  test('fixes stamped just before the start still count, as the live engine ingests them', () => {
    const fixes = track([{ seconds: 120, mps: 2.6 }]);
    const rollup = rollupOpenTrack(fixes, {
      thresholdMps: T,
      paused: [],
      startMs: 10_000,
      endMs: endOf(fixes),
    });
    expect(rollup.distanceM).toBe(smoothTrack(fixes).distanceM);
    expect(rollup.buckets[0].startMs).toBe(10_000);
  });
});

describe('rollupOpenTrack — noisy tracks (spec §8)', () => {
  for (const stopS of [10, 20, 45]) {
    test(`a ${stopS} s stop at a crossing mid-run is stopped, not walked`, () => {
      const fixes = noisyTrack([
        { seconds: 90, mps: 2.6 },
        { seconds: stopS, mps: 0 },
        { seconds: 90, mps: 2.6 },
      ]);
      const { buckets } = rollupOpenTrack(fixes, {
        thresholdMps: T,
        paused: [],
        startMs: 0,
        endMs: endOf(fixes),
      });
      expect(buckets.map((b) => b.kind)).toEqual(['run', 'stopped', 'run']);
      expect(Math.abs(secondsOf(buckets, 'stopped') - stopS)).toBeLessThanOrEqual(4);
    });
  }

  test('a 1.0 m/s walker coming out of a stop is walking, not trapped in it', () => {
    const fixes = noisyTrack([
      { seconds: 20, mps: 0 },
      { seconds: 180, mps: 1.0 },
    ]);
    const { buckets } = rollupOpenTrack(fixes, {
      thresholdMps: T,
      paused: [],
      startMs: 0,
      endMs: endOf(fixes),
    });
    expect(secondsOf(buckets, 'walk')).toBeGreaterThanOrEqual(0.9 * 180);
  });

  test('a jog 0.2 m/s above the threshold is running for most of its time', () => {
    const fixes = noisyTrack([
      { seconds: 60, mps: 1.5 },
      { seconds: 240, mps: T + 0.2 },
    ]);
    const { buckets } = rollupOpenTrack(fixes, {
      thresholdMps: T,
      paused: [],
      startMs: 0,
      endMs: endOf(fixes),
    });
    expect(secondsOf(buckets, 'run')).toBeGreaterThanOrEqual(0.9 * 240);
  });
});

describe('learnThreshold', () => {
  // walk p90 = 1.5 + 0.1 × (1.9 − 1.5) = 1.54; run p10 = 2.2 + 0.9 × (2.8 − 2.2) = 2.74 → 2.14.
  // (The midpoint of the medians, 1.5 and 2.8, would be 2.15.)
  const plan = [
    ...labelled('walk', 1.5, 90),
    ...labelled('walk', 1.9, 10),
    ...labelled('run', 2.2, 10),
    ...labelled('run', 2.8, 90),
  ];

  test('is the midpoint of the walk p90 and the run p10', () => {
    expect(learnThreshold(plan)).toBeCloseTo(2.14, 9);
  });

  test('ignores the first 10 s of each interval, when runners are still reacting to the cue', () => {
    expect(learnThreshold([...plan, ...labelled('walk', 3.0, 40, 9_999)])).toBeCloseTo(2.14, 9);
  });

  test('ignores warm-ups and cool-downs, which are walked more gently than walk intervals', () => {
    const gentle = [...labelled('warmup', 0.9, 200), ...labelled('cooldown', 0.9, 200)];
    expect(learnThreshold([...plan, ...gentle])).toBeCloseTo(2.14, 9);
  });

  test('falls back to 2.1 m/s without 60 samples of both walking and running', () => {
    const fewRuns = [...labelled('walk', 1.5, 100), ...labelled('run', 2.8, 59)];
    expect(learnThreshold(fewRuns)).toBe(2.1);
  });

  test('falls back as well when it is the walking that is short', () => {
    const fewWalks = [...labelled('walk', 1.5, 59), ...labelled('run', 2.8, 100)];
    expect(learnThreshold(fewWalks)).toBe(2.1);
  });

  test('ignores standing inside a scripted run, which would drag the run p10 down', () => {
    expect(learnThreshold([...plan, ...labelled('run', 0.2, 30)])).toBeCloseTo(2.14, 9);
  });

  test('never learns a threshold below 1.5 m/s, where ordinary walking would read as running', () => {
    const slow = [...labelled('walk', 1.1, 100), ...labelled('run', 1.4, 100)];
    expect(learnThreshold(slow)).toBe(1.5);
  });

  test('never learns a threshold above 3.0 m/s', () => {
    const fast = [...labelled('walk', 3.2, 100), ...labelled('run', 4.5, 100)];
    expect(learnThreshold(fast)).toBe(3.0);
  });
});

describe('labelledSpeeds', () => {
  const segmented = (legs: readonly Leg[]): SegmentedFix[] =>
    legs.flatMap((leg, seq) =>
      track(legs.slice(0, seq + 1))
        .slice(legs.slice(0, seq).reduce((n, l) => n + l.seconds, 0))
        .map((fix) => ({ ...fix, segmentSeq: seq })),
    );
  const fixes = segmented([
    { seconds: 30, mps: 1.5 },
    { seconds: 30, mps: 2.6 },
  ]);
  const kinds = new Map([
    [0, 'walk' as const],
    [1, 'run' as const],
  ]);

  test('labels each velocity-bearing step with its segment kind, skipping the seed fix', () => {
    const speeds = labelledSpeeds(fixes, kinds);
    expect(speeds).toHaveLength(59);
    expect(speeds.filter((s) => s.kind === 'run')).toHaveLength(30);
  });

  test('measures time into a segment from that segment’s first fix', () => {
    const firstRun = labelledSpeeds(fixes, kinds).find((s) => s.kind === 'run');
    expect(firstRun?.msIntoSegment).toBe(0);
  });
});
