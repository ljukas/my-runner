import { describe, expect, test } from 'bun:test';

import { stepsBetween } from './reading';

describe('stepsBetween', () => {
  test('counts the spread between the first and latest counter values', () => {
    expect(stepsBetween(10_000, 13_512)).toBe(3512);
  });

  test('an unchanged counter is zero steps, not unavailable', () => {
    expect(Object.is(stepsBetween(500, 500), 0)).toBe(true);
  });

  test('a counter that went backwards is unavailable', () => {
    expect(stepsBetween(10_000, 40)).toBeNull();
  });

  test('a non-finite value is unavailable', () => {
    expect(stepsBetween(NaN, 10)).toBeNull();
    expect(stepsBetween(0, Infinity)).toBeNull();
  });
});
