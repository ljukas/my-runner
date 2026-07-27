import { describe, expect, test } from 'bun:test';

import { shouldHoldDisplayAwake } from './run-display';

describe('shouldHoldDisplayAwake', () => {
  test('the lock holds the display awake', () => {
    expect(shouldHoldDisplayAwake(true, 'granted')).toBe(true);
  });

  test('unlocked with location granted lets the display sleep', () => {
    expect(shouldHoldDisplayAwake(false, 'granted')).toBe(false);
  });

  test('location not granted holds the display awake, locked or not', () => {
    expect(shouldHoldDisplayAwake(false, 'denied')).toBe(true);
    expect(shouldHoldDisplayAwake(false, 'undetermined')).toBe(true);
    expect(shouldHoldDisplayAwake(true, 'denied')).toBe(true);
  });

  test('an unresolved permission holds the display awake', () => {
    expect(shouldHoldDisplayAwake(false, null)).toBe(true);
  });
});
