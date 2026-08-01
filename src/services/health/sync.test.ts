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
  test('resolves false rather than rejecting when getAuthorization throws (finding 2)', async () => {
    mockAdapter(() => {
      throw new Error('native bridge unavailable');
    });

    const { syncRunToHealth } = await import('./sync');
    await expect(syncRunToHealth('run-1')).resolves.toBe(false);
  });
});
