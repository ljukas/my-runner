import { describe, expect, test } from 'bun:test';

import {
  durationWords,
  formatClock,
  formatCountdown,
  formatMinutes,
  formatRunDate,
  sessionSummary,
  sessionTitle,
} from './format';
import { NHS_PLAN, getSession } from './plan';

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

describe('formatCountdown', () => {
  test('renders m:ss.cc', () => {
    expect(formatCountdown(65)).toBe('1:05.00');
    expect(formatCountdown(9.99)).toBe('0:09.99');
    expect(formatCountdown(125.5)).toBe('2:05.50');
  });

  test('ceils to hundredths so 0:00.00 shows only at exactly zero', () => {
    expect(formatCountdown(0)).toBe('0:00.00');
    expect(formatCountdown(0.004)).toBe('0:00.01');
    expect(formatCountdown(59.999)).toBe('1:00.00');
  });

  test('never goes negative', () => {
    expect(formatCountdown(-3)).toBe('0:00.00');
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

describe('durationWords', () => {
  test('whole minutes read as minutes', () => {
    expect(durationWords(120)).toBe('2-minute');
    expect(durationWords(300)).toBe('5-minute');
    expect(durationWords(60)).toBe('1-minute');
  });
  test('sub-minute reads as seconds', () => {
    expect(durationWords(90)).toBe('90-second');
  });
});

describe('sessionSummary', () => {
  const summary = (key: string) => sessionSummary(getSession(NHS_PLAN, key)!);
  test('uniform alternating (W2)', () => {
    expect(summary('w2d1')).toBe('Alternates 90-second runs with 2-minute walks, 6 times.');
  });
  test('uniform alternating (W1)', () => {
    expect(summary('w1d1')).toBe('Alternates 1-minute runs with 90-second walks, 8 times.');
  });
  test('single continuous run (W5D3)', () => {
    expect(summary('w5d3')).toBe('One continuous 20-minute run.');
  });
  test('irregular fallback (W3)', () => {
    expect(summary('w3d1')).toBe('4 run intervals with walk recovery · 9 min running.');
  });
  test('irregular fallback (W6D1)', () => {
    expect(summary('w6d1')).toBe('3 run intervals with walk recovery · 18 min running.');
  });
  test('irregular fallback (W4) — non-uniform runs, 16 min total', () => {
    expect(summary('w4d1')).toBe('4 run intervals with walk recovery · 16 min running.');
  });
});

describe('formatRunDate', () => {
  test('formats an ISO timestamp as weekday, month day', () => {
    expect(formatRunDate('2026-01-01T12:00:00.000Z', 'en-US')).toBe('Thu, Jan 1');
  });
});
