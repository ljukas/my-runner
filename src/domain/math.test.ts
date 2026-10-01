import { describe, expect, test } from 'bun:test';

import { quantile } from './math';

describe('quantile', () => {
  test('interpolates linearly between the two order statistics around the rank', () => {
    // rank (4 − 1) × 0.9 = 2.7 → 30 + 0.7 × (40 − 30)
    expect(quantile([10, 20, 30, 40], 0.9)).toBeCloseTo(37, 10);
  });

  test('does not require sorted input', () => {
    expect(quantile([40, 10, 30, 20], 0.1)).toBeCloseTo(13, 10);
  });

  test('returns the sole value for a single-element input', () => {
    expect(quantile([7], 0.9)).toBe(7);
  });

  test('is NaN for an empty input', () => {
    expect(quantile([], 0.5)).toBeNaN();
  });
});
