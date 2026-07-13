import { describe, expect, test } from 'bun:test';

import { formatClock, formatMinutes, sessionTitle } from './format';

describe('formatClock', () => {
  test('zero and simple values', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(1950)).toBe('32:30');
  });

  test('ceils fractional seconds so a fresh segment shows its full length', () => {
    expect(formatClock(299.2)).toBe('5:00');
    expect(formatClock(0.4)).toBe('0:01');
  });

  test('never goes negative', () => {
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('formatMinutes', () => {
  test('rounds to whole minutes', () => {
    expect(formatMinutes(1950)).toBe('33 min');
    expect(formatMinutes(1200)).toBe('20 min');
  });
});

describe('sessionTitle', () => {
  test('formats plan keys and falls back to the raw key', () => {
    expect(sessionTitle('w1d2')).toBe('Week 1 · Day 2');
    expect(sessionTitle('unknown')).toBe('unknown');
  });
});
