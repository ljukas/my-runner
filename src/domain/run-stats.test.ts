import { describe, expect, test } from 'bun:test';

import { runStats } from './run-stats';

describe('runStats', () => {
  test('sums running time, counts run intervals, finds the longest', () => {
    expect(
      runStats([
        { kind: 'warmup', actualDurationS: 300 },
        { kind: 'run', actualDurationS: 60 },
        { kind: 'walk', actualDurationS: 90 },
        { kind: 'run', actualDurationS: 60 },
        { kind: 'walk', actualDurationS: 90 },
        { kind: 'run', actualDurationS: 60 },
        { kind: 'cooldown', actualDurationS: 300 },
      ]),
    ).toEqual({ timeRunningS: 180, runIntervals: 3, longestRunS: 60 });
  });

  test('longest reflects varying run lengths', () => {
    expect(
      runStats([
        { kind: 'run', actualDurationS: 300 },
        { kind: 'walk', actualDurationS: 180 },
        { kind: 'run', actualDurationS: 480 },
      ]),
    ).toEqual({ timeRunningS: 780, runIntervals: 2, longestRunS: 480 });
  });

  test('no run segments yields zeroes', () => {
    expect(
      runStats([
        { kind: 'warmup', actualDurationS: 300 },
        { kind: 'cooldown', actualDurationS: 120 },
      ]),
    ).toEqual({ timeRunningS: 0, runIntervals: 0, longestRunS: 0 });
  });
});
