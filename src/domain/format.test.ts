import { describe, expect, test } from 'bun:test';

import {
  clockParts,
  durationWords,
  formatClock,
  formatCountdown,
  formatDistanceKm,
  formatMinutes,
  formatPace,
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

describe('clockParts', () => {
  test('under a minute reads in seconds', () => {
    expect(clockParts(16)).toEqual({ value: '16', unit: 'seconds' });
    expect(clockParts(0)).toEqual({ value: '0', unit: 'seconds' });
  });
  test('a minute or more reads as a m:ss clock', () => {
    expect(clockParts(60)).toEqual({ value: '1:00', unit: 'min' });
    expect(clockParts(480)).toEqual({ value: '8:00', unit: 'min' });
    expect(clockParts(1710)).toEqual({ value: '28:30', unit: 'min' });
  });
  test('ceils like formatClock, so 59.2s already reads as a clock', () => {
    expect(clockParts(59.2)).toEqual({ value: '1:00', unit: 'min' });
  });
});

describe('formatDistanceKm', () => {
  test('metric, always two decimals', () => {
    expect(formatDistanceKm(2310)).toBe('2.31 km');
    expect(formatDistanceKm(0)).toBe('0.00 km');
    expect(formatDistanceKm(1000)).toBe('1.00 km');
    expect(formatDistanceKm(5000)).toBe('5.00 km');
  });

  test('rounds to two decimals (10 m) via toFixed', () => {
    expect(formatDistanceKm(2314)).toBe('2.31 km');
    expect(formatDistanceKm(2316)).toBe('2.32 km');
    expect(formatDistanceKm(994)).toBe('0.99 km');
    expect(formatDistanceKm(996)).toBe('1.00 km');
    expect(formatDistanceKm(999)).toBe('1.00 km');
  });

  test('clamps negative input to zero, mirroring formatClock', () => {
    expect(formatDistanceKm(-5)).toBe('0.00 km');
  });

  test('renders non-finite input as 0.00 km rather than garbage', () => {
    expect(formatDistanceKm(NaN)).toBe('0.00 km');
    expect(formatDistanceKm(Infinity)).toBe('0.00 km');
    expect(formatDistanceKm(-Infinity)).toBe('0.00 km');
  });
});

describe('formatPace', () => {
  test('renders m:ss /km', () => {
    expect(formatPace(389)).toBe('6:29 /km');
    expect(formatPace(360)).toBe('6:00 /km');
    expect(formatPace(605)).toBe('10:05 /km');
    expect(formatPace(720)).toBe('12:00 /km');
  });

  test('rounds to the nearest second, carrying into the next minute', () => {
    expect(formatPace(389.4)).toBe('6:29 /km');
    expect(formatPace(389.6)).toBe('6:30 /km');
    expect(formatPace(359.6)).toBe('6:00 /km');
  });

  test('degenerate paces render the placeholder, not a bogus clock', () => {
    expect(formatPace(0)).toBe('--:-- /km');
    expect(formatPace(0.4)).toBe('--:-- /km');
    expect(formatPace(-5)).toBe('--:-- /km');
    expect(formatPace(Infinity)).toBe('--:-- /km');
    expect(formatPace(-Infinity)).toBe('--:-- /km');
    expect(formatPace(NaN)).toBe('--:-- /km');
    expect(formatPace(null)).toBe('--:-- /km');
  });
});
