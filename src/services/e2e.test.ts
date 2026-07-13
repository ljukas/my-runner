import { afterEach, describe, expect, test } from 'bun:test';

import { compressedPlanReachable, isE2EBuild } from './e2e';

const ORIGINAL_E2E = process.env.EXPO_PUBLIC_E2E;

afterEach(() => {
  if (ORIGINAL_E2E === undefined) delete process.env.EXPO_PUBLIC_E2E;
  else process.env.EXPO_PUBLIC_E2E = ORIGINAL_E2E;
  // Bare `__DEV__` reads resolve to this global; clear it between tests.
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});

describe('isE2EBuild', () => {
  test('false when EXPO_PUBLIC_E2E is unset', () => {
    delete process.env.EXPO_PUBLIC_E2E;
    expect(isE2EBuild()).toBe(false);
  });

  test('true only when EXPO_PUBLIC_E2E is exactly "1"', () => {
    process.env.EXPO_PUBLIC_E2E = '1';
    expect(isE2EBuild()).toBe(true);
    process.env.EXPO_PUBLIC_E2E = 'true';
    expect(isE2EBuild()).toBe(false);
  });
});

describe('compressedPlanReachable', () => {
  test('true in a dev build regardless of the E2E flag', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    delete process.env.EXPO_PUBLIC_E2E;
    expect(compressedPlanReachable()).toBe(true);
  });

  test('true in a non-dev E2E build', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    process.env.EXPO_PUBLIC_E2E = '1';
    expect(compressedPlanReachable()).toBe(true);
  });

  test('false in a non-dev, non-E2E build', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    delete process.env.EXPO_PUBLIC_E2E;
    expect(compressedPlanReachable()).toBe(false);
  });
});
