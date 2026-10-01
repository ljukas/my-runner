import { describe, expect, mock, test } from 'bun:test';

import type { HealthAuthorization } from './port';

// why this many modules: `index.ts` is the composition seam under test, and its barrel pulls in
// every file in this directory — `./sync` opens a real db at import time and `./adapter` reaches
// the native module through `expo` — so each has to be swapped for an inert double before
// `./index` can load under `bun test`.
function mockDeps(
  requestWriteAccess: () => Promise<HealthAuthorization>,
  openSettings: () => Promise<void> = async () => {},
) {
  void mock.module('@/db/client', () => ({ db: {} }));
  void mock.module('@/db/run-points', () => ({ loadRunFixes: () => [] }));
  void mock.module('@/db/run-segments', () => ({ loadRunSegments: () => [] }));
  void mock.module('react-native', () => ({
    AppState: { addEventListener: () => ({ remove: () => {} }) },
  }));
  void mock.module('./adapter', () => ({
    healthAdapter: {
      getAuthorization: () => 'notDetermined',
      requestWriteAccess,
      saveRun: async () => {},
      openSettings,
      openStore: openSettings,
      subscribeRationale: () => () => {},
    },
  }));
}

async function warningsDuring(body: () => Promise<unknown>): Promise<unknown[][]> {
  const original = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => void warnings.push(args);
  try {
    await body();
  } finally {
    console.warn = original;
  }
  return warnings;
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

// The Settings rows and the run summary call these from onPress without a catch of their own.
describe('openHealthApp and openHealthStore', () => {
  test('log and resolve when the native call rejects', async () => {
    mockDeps(
      async () => 'denied',
      () => Promise.reject(new Error('no activity')),
    );
    const { openHealthApp, openHealthStore } = await import('./index');

    const warnings = await warningsDuring(async () => {
      await expect(openHealthApp()).resolves.toBeUndefined();
      await expect(openHealthStore()).resolves.toBeUndefined();
    });
    expect(warnings.length).toBe(2);
  });
});
