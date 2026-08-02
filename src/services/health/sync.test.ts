import { describe, expect, mock, test } from 'bun:test';

import type { HealthAuthorization } from './port';

// why mock.module, not a Metro build: `./adapter` only exists as `adapter.ios.ts` (platform-suffix
// resolution Metro understands and bun test does not) and `@/db/client` opens a real expo-sqlite
// database at import time — neither is reachable from `bun test`'s plain Node-style resolution.
function mockAdapter(getAuthorization: () => HealthAuthorization) {
  void mock.module('@/db/client', () => ({ db: {} }));
  void mock.module('@/db/run-points', () => ({ loadRunFixes: () => [] }));
  void mock.module('./adapter', () => ({
    healthAdapter: { getAuthorization, saveRun: async () => {} },
  }));
}

describe('syncRunToHealth', () => {
  test('resolves "failed" rather than rejecting when getAuthorization throws (finding 2)', async () => {
    mockAdapter(() => {
      throw new Error('native bridge unavailable');
    });

    const { syncRunToHealth } = await import('./sync');
    await expect(syncRunToHealth('run-1')).resolves.toBe('failed');
  });
});

describe('isHealthSyncFailure', () => {
  // Regression for the row painting "Couldn't save" while a collapsed in-flight save is still
  // succeeding (finding 1): only 'failed' should ever surface as a failure to the user.
  test('is true only for "failed", not for "busy", "skipped", or "saved"', async () => {
    mockAdapter(() => 'authorized');
    const { isHealthSyncFailure } = await import('./sync');

    expect(isHealthSyncFailure('failed')).toBe(true);
    expect(isHealthSyncFailure('busy')).toBe(false);
    expect(isHealthSyncFailure('skipped')).toBe(false);
    expect(isHealthSyncFailure('saved')).toBe(false);
  });
});
