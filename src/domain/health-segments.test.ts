import { describe, expect, test } from 'bun:test';

import { pauseWindows, segmentWindows, type SegmentRow } from './health-segments';
import type { LoggedRunEvent } from './run-altitude';

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const start: LoggedRunEvent = { type: 'start', at: T0 };
const pause = (s: number): LoggedRunEvent => ({ type: 'pause', at: at(s) });
const resume = (s: number): LoggedRunEvent => ({ type: 'resume', at: at(s) });
const workout = (endS: number) => ({ startedAt: T0, endedAt: at(endS) });

function row(seq: number, kind: SegmentRow['kind'], actualDurationS: number): SegmentRow {
  return { seq, kind, actualDurationS };
}

describe('segmentWindows', () => {
  test('lays a plan run end to end and maps its kinds to activities', () => {
    const rows = [
      row(0, 'warmup', 300),
      row(1, 'run', 60),
      row(2, 'walk', 90),
      row(3, 'cooldown', 300),
    ];
    expect(segmentWindows(rows, [start], workout(750))).toEqual([
      { activity: 'walking', startedAt: at(0), endedAt: at(300) },
      { activity: 'running', startedAt: at(300), endedAt: at(360) },
      { activity: 'walking', startedAt: at(360), endedAt: at(450) },
      { activity: 'walking', startedAt: at(450), endedAt: at(750) },
    ]);
  });

  test("maps a free run's stopped bucket to resting", () => {
    const rows = [row(0, 'run', 60), row(1, 'stopped', 20), row(2, 'walk', 40)];
    expect(segmentWindows(rows, [start], workout(120)).map((w) => w.activity)).toEqual([
      'running',
      'resting',
      'walking',
    ]);
  });

  test('splits a segment at a pause and writes nothing for the paused span', () => {
    const events = [start, pause(30), resume(90)];
    expect(segmentWindows([row(0, 'run', 60)], events, workout(120))).toEqual([
      { activity: 'running', startedAt: at(0), endedAt: at(30) },
      { activity: 'running', startedAt: at(90), endedAt: at(120) },
    ]);
  });

  test('a pause exactly on a boundary leaves no zero-length piece', () => {
    const events = [start, pause(60), resume(100)];
    expect(segmentWindows([row(0, 'run', 60), row(1, 'walk', 30)], events, workout(130))).toEqual([
      { activity: 'running', startedAt: at(0), endedAt: at(60) },
      { activity: 'walking', startedAt: at(100), endedAt: at(130) },
    ]);
  });

  test('ignores a skip, which does not stop active time', () => {
    const events = [start, { type: 'skip', at: at(20) }];
    expect(segmentWindows([row(0, 'run', 20), row(1, 'walk', 40)], events, workout(60))).toEqual([
      { activity: 'running', startedAt: at(0), endedAt: at(20) },
      { activity: 'walking', startedAt: at(20), endedAt: at(60) },
    ]);
  });

  test('drops a zero-length row, such as a segment skipped at its first second', () => {
    const rows = [row(0, 'run', 60), row(1, 'walk', 0), row(2, 'run', 30)];
    expect(segmentWindows(rows, [start], workout(90))).toEqual([
      { activity: 'running', startedAt: at(0), endedAt: at(60) },
      { activity: 'running', startedAt: at(60), endedAt: at(90) },
    ]);
  });

  test('sorts rows by seq', () => {
    const rows = [row(1, 'walk', 30), row(0, 'run', 60)];
    expect(segmentWindows(rows, [start], workout(90)).map((w) => w.activity)).toEqual([
      'running',
      'walking',
    ]);
  });

  test('clamps durations that overshoot the workout and drops what lies past its end', () => {
    const rows = [row(0, 'run', 60), row(1, 'walk', 61), row(2, 'run', 5)];
    expect(segmentWindows(rows, [start], workout(120))).toEqual([
      { activity: 'running', startedAt: at(0), endedAt: at(60) },
      { activity: 'walking', startedAt: at(60), endedAt: at(120) },
    ]);
  });

  test('leaves the tail uncovered rather than stretching a run ended early', () => {
    expect(segmentWindows([row(0, 'run', 45)], [start], workout(60))).toEqual([
      { activity: 'running', startedAt: at(0), endedAt: at(45) },
    ]);
  });

  test('stops at the active time a log that ends paused never reached', () => {
    const events = [start, pause(60)];
    expect(segmentWindows([row(0, 'run', 60), row(1, 'walk', 30)], events, workout(90))).toEqual([
      { activity: 'running', startedAt: at(0), endedAt: at(60) },
    ]);
  });

  test('without an event log, lays the rows from the start with no pauses', () => {
    expect(segmentWindows([row(0, 'run', 60), row(1, 'walk', 30)], [], workout(90))).toEqual([
      { activity: 'running', startedAt: at(0), endedAt: at(60) },
      { activity: 'walking', startedAt: at(60), endedAt: at(90) },
    ]);
  });

  test('no rows, no segments', () => {
    expect(segmentWindows([], [start], workout(60))).toEqual([]);
  });

  test('stays inside the workout when the log starts before the stored start', () => {
    const early = [{ type: 'start', at: T0 - 400 }];
    const windows = segmentWindows([row(0, 'run', 30), row(1, 'walk', 30)], early, workout(60));
    expect(windows[0].startedAt).toBe(T0);
    expect(windows[1].startedAt).toBe(windows[0].endedAt);
  });

  test('never overlaps, never reaches into a pause, and every window has a length', () => {
    const events = [start, pause(50), resume(70), pause(125), resume(126), pause(200), resume(260)];
    const rows = [row(0, 'warmup', 45), row(1, 'run', 60), row(2, 'walk', 90), row(3, 'run', 40)];
    const bounds = workout(300);
    const windows = segmentWindows(rows, events, bounds);
    const pauses = pauseWindows(events, bounds);
    let lastEnd = bounds.startedAt;
    for (const w of windows) {
      expect(w.endedAt).toBeGreaterThan(w.startedAt);
      expect(w.startedAt).toBeGreaterThanOrEqual(lastEnd);
      expect(w.endedAt).toBeLessThanOrEqual(bounds.endedAt);
      for (const p of pauses)
        expect(w.endedAt <= p.startedAt || w.startedAt >= p.endedAt).toBe(true);
      lastEnd = w.endedAt;
    }
  });
});

describe('pauseWindows', () => {
  test("is each runner's pause as a wall-clock window", () => {
    const events = [start, pause(30), resume(90), pause(100), resume(110)];
    expect(pauseWindows(events, workout(200))).toEqual([
      { startedAt: at(30), endedAt: at(90) },
      { startedAt: at(100), endedAt: at(110) },
    ]);
  });

  test('runs a pause the log ended in up to the workout end', () => {
    expect(pauseWindows([start, pause(60)], workout(90))).toEqual([
      { startedAt: at(60), endedAt: at(90) },
    ]);
  });

  test('clamps to the workout and drops what falls outside it', () => {
    const events = [start, pause(50), resume(70), pause(90), resume(95)];
    expect(pauseWindows(events, workout(60))).toEqual([{ startedAt: at(50), endedAt: at(60) }]);
  });

  test('none without an event log', () => {
    expect(pauseWindows([], workout(60))).toEqual([]);
  });
});
