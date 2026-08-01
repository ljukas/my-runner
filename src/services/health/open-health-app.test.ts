import { describe, expect, mock, test } from 'bun:test';

/**
 * Finding 2: `openHealthApp`'s `Linking.openSettings()` fallback used to be unguarded — a rejection
 * there (on top of the primary `x-apple-health://` link already failing) became an unhandled
 * rejection instead of a logged warning, the same failure class as the seam in `index.test.ts`.
 */
describe('openHealthApp', () => {
  test('logs and resolves when both the deep link and the settings fallback reject', async () => {
    void mock.module('expo-linking', () => ({
      openURL: () => Promise.reject(new Error('scheme rejected')),
      openSettings: () => Promise.reject(new Error('settings unavailable')),
    }));

    const { openHealthApp } = await import('./open-health-app');

    const original = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      await expect(openHealthApp()).resolves.toBeUndefined();
    } finally {
      console.warn = original;
    }

    expect(warnings.length).toBe(1);
  });

  test('falls back to settings, without logging, when only the deep link fails', async () => {
    let openedSettings = false;
    void mock.module('expo-linking', () => ({
      openURL: () => Promise.reject(new Error('scheme rejected')),
      openSettings: () => {
        openedSettings = true;
        return Promise.resolve();
      },
    }));

    const { openHealthApp } = await import('./open-health-app');

    const original = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      await expect(openHealthApp()).resolves.toBeUndefined();
    } finally {
      console.warn = original;
    }

    expect(openedSettings).toBe(true);
    expect(warnings.length).toBe(0);
  });
});
