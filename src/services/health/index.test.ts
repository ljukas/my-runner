import { describe, expect, mock, test } from 'bun:test';

import type { HealthAuthorization } from './port';

// why this many modules: `index.ts` is the composition seam under test, and its barrel pulls in
// every file in this directory — `./sync` opens a real db at import time and `./open-health-app`
// pulls `expo-linking`, which in turn needs more of `react-native` than a bare `AppState` stub
// offers, so each has to be swapped for an inert double before `./index` can load under `bun test`.
function mockDeps(requestWriteAccess: () => Promise<HealthAuthorization>) {
  void mock.module('@/db/client', () => ({ db: {} }));
  void mock.module('@/db/run-points', () => ({ loadRunFixes: () => [] }));
  void mock.module('expo-linking', () => ({
    openURL: async () => {},
    openSettings: async () => {},
  }));
  void mock.module('react-native', () => ({
    AppState: { addEventListener: () => ({ remove: () => {} }) },
  }));
  void mock.module('./adapter', () => ({
    healthAdapter: {
      getAuthorization: () => 'notDetermined',
      requestWriteAccess,
      saveRun: async () => {},
    },
  }));
}

describe('requestWriteAccess (composition seam, finding 2)', () => {
  test('notifies subscribers only after the adapter call resolves', async () => {
    let resolveAdapterCall!: (status: HealthAuthorization) => void;
    mockDeps(() => new Promise((resolve) => (resolveAdapterCall = resolve)));

    const { requestWriteAccess } = await import('./index');
    const { subscribeAuthorizationChange } = await import('./use-health-authorization');

    let notified = false;
    subscribeAuthorizationChange(() => (notified = true));

    const pending = requestWriteAccess();
    expect(notified).toBe(false);

    resolveAdapterCall('authorized');
    expect(await pending).toBe('authorized');
    expect(notified).toBe(true);
  });

  test('stops notifying an unsubscribed listener', async () => {
    mockDeps(async () => 'denied');

    const { requestWriteAccess } = await import('./index');
    const { subscribeAuthorizationChange } = await import('./use-health-authorization');

    let calls = 0;
    const unsubscribe = subscribeAuthorizationChange(() => calls++);
    unsubscribe();

    await requestWriteAccess();
    expect(calls).toBe(0);
  });

  // Finding 2: this seam is the one place every caller goes through (settings' two onPress
  // handlers, the onboarding primer) — none of them catch, so a native rejection has to be
  // swallowed and logged here, not left to become an unhandled rejection at each call site.
  test('catches and logs a rejection instead of throwing, and does not notify', async () => {
    mockDeps(() => Promise.reject(new Error('native bridge unavailable')));

    const { requestWriteAccess } = await import('./index');
    const { subscribeAuthorizationChange } = await import('./use-health-authorization');

    let notified = false;
    subscribeAuthorizationChange(() => (notified = true));

    const original = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => void warnings.push(args);
    let status: HealthAuthorization;
    try {
      status = await requestWriteAccess();
    } finally {
      console.warn = original;
    }

    expect(status).toBe('notDetermined');
    expect(warnings.length).toBe(1);
    expect(notified).toBe(false);
  });
});
