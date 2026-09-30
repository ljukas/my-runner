import { describe, expect, test } from 'bun:test';

import { activeMsBetween, wallClockAtActive } from './active-time';

const start = { type: 'start', at: 1_000 };

describe('wallClockAtActive', () => {
  test('is the start plus the active time on an unpaused run', () => {
    expect(wallClockAtActive([start], 60)).toBe(61_000);
  });

  test('adds the pauses that fall before the instant', () => {
    // paused 11 s → 21 s of wall clock; 60 s of active time lands 10 s later
    const events = [start, { type: 'pause', at: 11_000 }, { type: 'resume', at: 21_000 }];
    expect(wallClockAtActive(events, 60)).toBe(71_000);
  });

  test('ignores a pause that begins after the instant', () => {
    const events = [start, { type: 'pause', at: 100_000 }, { type: 'resume', at: 200_000 }];
    expect(wallClockAtActive(events, 60)).toBe(61_000);
  });

  test('is null while the run is paused before it reaches that active time', () => {
    expect(wallClockAtActive([start, { type: 'pause', at: 31_000 }], 60)).toBeNull();
  });
});

describe('activeMsBetween', () => {
  test('is the wall clock between the instants, less the paused part of it', () => {
    const events = [start, { type: 'pause', at: 11_000 }, { type: 'resume', at: 21_000 }];
    expect(activeMsBetween(events, 6_000, 31_000)).toBe(15_000);
  });

  test('counts an unfinished pause up to the later instant', () => {
    expect(activeMsBetween([start, { type: 'pause', at: 11_000 }], 1_000, 60_000)).toBe(10_000);
  });
});
