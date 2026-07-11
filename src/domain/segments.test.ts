import { describe, expect, test } from 'bun:test';

import type { PlannedSegment } from './plan';
import { buildTimeline, positionAt, totalSeconds } from './segments';

const SEGMENTS: PlannedSegment[] = [
  { kind: 'warmup', seconds: 10 },
  { kind: 'run', seconds: 20 },
  { kind: 'walk', seconds: 15 },
  { kind: 'run', seconds: 20 },
  { kind: 'cooldown', seconds: 10 },
]; // total 75

describe('buildTimeline', () => {
  test('no skips: prefix sums and planned durations', () => {
    const t = buildTimeline(SEGMENTS, []);
    expect(t.map((s) => s.startsAt)).toEqual([0, 10, 30, 45, 65]);
    expect(t.map((s) => s.effectiveSeconds)).toEqual([10, 20, 15, 20, 10]);
    expect(totalSeconds(t)).toBe(75);
  });

  test('skip mid-segment truncates it and shifts the rest earlier', () => {
    // skip at 15s: 5s into the first run → run truncated to 5s
    const t = buildTimeline(SEGMENTS, [15]);
    expect(t[1]).toMatchObject({ effectiveSeconds: 5, wasSkipped: true });
    expect(t.map((s) => s.startsAt)).toEqual([0, 10, 15, 30, 50]);
    expect(totalSeconds(t)).toBe(60);
  });

  test('skip at a segment start truncates it to zero', () => {
    const t = buildTimeline(SEGMENTS, [10]);
    expect(t[1]).toMatchObject({ effectiveSeconds: 0, wasSkipped: true });
    expect(totalSeconds(t)).toBe(55);
  });

  test('two skips apply in order against the already-adjusted timeline', () => {
    // first skip at 15 (run→5s, walk now starts at 15); second at 20 (5s into walk → walk→5s)
    const t = buildTimeline(SEGMENTS, [15, 20]);
    expect(t[1].effectiveSeconds).toBe(5);
    expect(t[2]).toMatchObject({ effectiveSeconds: 5, wasSkipped: true });
    expect(totalSeconds(t)).toBe(50);
  });

  test('skip past the end is ignored', () => {
    const t = buildTimeline(SEGMENTS, [999]);
    expect(totalSeconds(t)).toBe(75);
    expect(t.every((s) => !s.wasSkipped)).toBe(true);
  });
});

describe('positionAt', () => {
  const t = buildTimeline(SEGMENTS, []);

  test('start of session', () => {
    expect(positionAt(t, 0)).toEqual({ done: false, index: 0, secondsInto: 0, secondsRemaining: 10 });
  });

  test('mid-segment', () => {
    expect(positionAt(t, 12)).toEqual({ done: false, index: 1, secondsInto: 2, secondsRemaining: 18 });
  });

  test('an exact boundary belongs to the next segment', () => {
    expect(positionAt(t, 30)).toEqual({ done: false, index: 2, secondsInto: 0, secondsRemaining: 15 });
  });

  test('exhaustion', () => {
    expect(positionAt(t, 75)).toEqual({ done: true });
    expect(positionAt(t, 100)).toEqual({ done: true });
  });
});
