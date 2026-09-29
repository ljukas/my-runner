import { describe, expect, test } from 'bun:test';

import { largestRemainder, quantile } from './math';

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

describe('largestRemainder', () => {
  test('gives the leftover units to the largest fractional parts', () => {
    // floors 1 + 1 + 1 = 3; one unit left, to the larger of the .4 remainders
    expect(largestRemainder([1.4, 1.4, 1.2], 4)).toEqual([2, 1, 1]);
  });

  test('breaks a tie in remainders by order', () => {
    expect(largestRemainder([0.5, 0.5, 0.5, 0.5], 2)).toEqual([1, 1, 0, 0]);
  });

  test('where plain rounding would lose a unit, the parts still sum to the total', () => {
    // Math.round gives 2 + 2 + 2 = 6 for a total of 7
    expect(largestRemainder([2.4, 2.3, 2.3], 7)).toEqual([3, 2, 2]);
  });

  test('is empty for no parts', () => {
    expect(largestRemainder([], 0)).toEqual([]);
  });
});
