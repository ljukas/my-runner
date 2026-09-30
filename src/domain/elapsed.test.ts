import { describe, expect, test } from 'bun:test';

import { elapsedParts, elapsedSecondsAt, formatElapsed, msUntilNextSecond } from './elapsed';

describe('elapsedSecondsAt', () => {
  test('counts whole seconds from the anchor, never below zero', () => {
    expect(elapsedSecondsAt(1_000, 1_000)).toBe(0);
    expect(elapsedSecondsAt(1_000, 1_999)).toBe(0);
    expect(elapsedSecondsAt(1_000, 2_000)).toBe(1);
    expect(elapsedSecondsAt(1_000, 62_500)).toBe(61);
    expect(elapsedSecondsAt(5_000, 1_000)).toBe(0);
  });
});

describe('msUntilNextSecond', () => {
  test('lands the next tick on the anchor’s own second boundary', () => {
    expect(msUntilNextSecond(1_000, 1_000)).toBe(1000);
    expect(msUntilNextSecond(1_000, 1_250)).toBe(750);
    expect(msUntilNextSecond(1_000, 1_999)).toBe(1);
    expect(msUntilNextSecond(1_000, 500)).toBe(500);
  });
});

describe('elapsedParts and formatElapsed', () => {
  test('minutes and seconds under an hour', () => {
    expect(elapsedParts(0)).toEqual({ minutes: 0, seconds: 0 });
    expect(elapsedParts(59)).toEqual({ minutes: 0, seconds: 59 });
    expect(elapsedParts(3599)).toEqual({ minutes: 59, seconds: 59 });
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(754)).toBe('12:34');
    expect(formatElapsed(3599)).toBe('59:59');
  });

  test('hours from an hour on, to the 4-hour cap', () => {
    expect(elapsedParts(3600)).toEqual({ hours: 1, minutes: 0, seconds: 0 });
    expect(formatElapsed(3600)).toBe('1:00:00');
    expect(formatElapsed(4504)).toBe('1:15:04');
    expect(formatElapsed(14_400)).toBe('4:00:00');
  });

  test('a fractional second reads as the whole seconds already run', () => {
    expect(formatElapsed(59.9)).toBe('0:59');
  });
});
