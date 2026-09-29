import { describe, expect, test } from 'bun:test';

import { EARTH_RADIUS_M, type LocationFix } from './geo';
import { deriveOpenRun } from './open-run';

const DEG_PER_M = 180 / (Math.PI * EARTH_RADIUS_M);
const T = 2.1;

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** 1 Hz northward fixes from t = 1 s, one leg per `[seconds, m/s]`, with ±~1 m of seeded noise. */
function track(legs: readonly [number, number][]): LocationFix[] {
  const random = seededRandom(11);
  const fixes: LocationFix[] = [];
  let t = 0;
  let northM = 0;
  for (const [seconds, mps] of legs) {
    for (let s = 0; s < seconds; s += 1) {
      t += 1000;
      northM += mps;
      const noise = random() + random() + random() + random() - 2;
      fixes.push({
        timestamp: t,
        lat: 59 + (northM + noise) * DEG_PER_M,
        lng: 18,
        altitude: null,
        accuracy: 5,
        speed: null,
      });
    }
  }
  return fixes;
}

const run = (endMs: number, extra: { type: string; at: number }[] = []) => [
  { type: 'start', at: 0 },
  ...extra,
  { type: 'end', at: endMs },
];

describe('deriveOpenRun', () => {
  test('keeps a run that ends while moving as it was', () => {
    const fixes = track([[600, 2.6]]);
    const derived = deriveOpenRun({ events: run(600_000), fixes, thresholdMps: T });
    expect(derived).toMatchObject({ outcome: 'save', endMs: 600_000, activeDurationS: 600 });
  });

  test('trims a trailing stop of 30 minutes or more back to where the moving ended', () => {
    const fixes = track([
      [600, 2.6],
      [2000, 0],
    ]);
    const derived = deriveOpenRun({ events: run(2_600_000), fixes, thresholdMps: T });
    expect(derived.outcome).toBe('save');
    // the stopped bucket begins within a few seconds of the last moving fix at 600 s
    expect(derived.endMs).toBeGreaterThanOrEqual(598_000);
    expect(derived.endMs).toBeLessThanOrEqual(612_000);
    expect(derived.buckets.at(-1)?.kind).toBe('run');
    expect(derived.activeDurationS).toBe(Math.round(derived.endMs / 1000));
  });

  test('trims a trailing GPS silence of 30 minutes or more, as the live engine ends on it', () => {
    // 300 s running, then no fix at all for 31 min before the end
    const fixes = track([[300, 2.6]]);
    const derived = deriveOpenRun({ events: run(300_000 + 31 * 60_000), fixes, thresholdMps: T });
    expect(derived.outcome).toBe('save');
    expect(derived.endMs).toBe(300_000);
    expect(derived.buckets.map((b) => b.kind)).toEqual(['run']);
  });

  test('keeps a trailing GPS silence shorter than 30 minutes, as stopped time', () => {
    const fixes = track([[300, 2.6]]);
    const derived = deriveOpenRun({ events: run(300_000 + 10 * 60_000), fixes, thresholdMps: T });
    expect(derived.endMs).toBe(900_000);
    expect(derived.buckets.at(-1)).toMatchObject({ kind: 'stopped', startMs: 300_000 });
  });

  test('a log without an end event ends at its last event', () => {
    const fixes = track([[300, 2.6]]);
    const derived = deriveOpenRun({ events: [{ type: 'start', at: 0 }], fixes, thresholdMps: T });
    expect(derived.events.at(-1)?.type).toBe('end');
  });

  test('keeps a trailing stop shorter than 30 minutes', () => {
    const fixes = track([
      [600, 2.6],
      [600, 0],
    ]);
    const derived = deriveOpenRun({ events: run(1_200_000), fixes, thresholdMps: T });
    expect(derived.endMs).toBe(1_200_000);
    expect(derived.buckets.at(-1)?.kind).toBe('stopped');
  });

  test('truncates the event log with the trim, a pause inside the stop included', () => {
    const fixes = track([
      [600, 2.6],
      [2000, 0],
    ]);
    const events = run(2_600_000, [
      { type: 'pause', at: 1_500_000 },
      { type: 'resume', at: 1_510_000 },
    ]);
    const derived = deriveOpenRun({ events, fixes, thresholdMps: T });
    expect(derived.events.map((e) => e.type)).toEqual(['start', 'end']);
    expect(derived.events.at(-1)?.at).toBe(derived.endMs);
  });

  test('ends at 4 hours of active time, even for a run abandoned long after', () => {
    const fixes = track([[5 * 3600, 2.6]]);
    const derived = deriveOpenRun({ events: run(5 * 3_600_000), fixes, thresholdMps: T });
    expect(derived).toMatchObject({ endMs: 4 * 3_600_000, activeDurationS: 4 * 3600 });
  });

  test('discards a run under a minute of active time', () => {
    const fixes = track([[50, 2.6]]);
    expect(deriveOpenRun({ events: run(50_000), fixes, thresholdMps: T }).outcome).toBe('discard');
  });

  test('discards a run the trim leaves under a minute', () => {
    const fixes = track([
      [40, 2.6],
      [2000, 0],
    ]);
    const derived = deriveOpenRun({ events: run(2_040_000), fixes, thresholdMps: T });
    expect(derived.outcome).toBe('discard');
  });

  test('a timer-only run keeps its active time and has no buckets', () => {
    const derived = deriveOpenRun({ events: run(900_000), fixes: [], thresholdMps: T });
    expect(derived).toMatchObject({
      outcome: 'save',
      activeDurationS: 900,
      buckets: [],
      distanceM: 0,
    });
  });
});
