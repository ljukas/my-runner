import { describe, expect, mock, test } from 'bun:test';

import type { HealthWorkoutInput } from '@/domain/health';
import type { HealthAuthorization } from './port';

// why mock.module, not a Metro build: `./adapter` reaches the native module through `expo`, whose
// `react-native` entry bun cannot parse, and `@/db/client` opens a real expo-sqlite database at
// import time — neither loads under `bun test`.
function mockAdapter(getAuthorization: () => HealthAuthorization) {
  void mock.module('@/db/client', () => ({ db: {} }));
  void mock.module('@/db/run-points', () => ({ loadRunFixes: () => [] }));
  void mock.module('@/db/run-segments', () => ({ loadRunSegments: () => [] }));
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

describe('syncRunToHealth with a run to save', () => {
  test('a segment read that fails costs the segments, not the save', async () => {
    const run = {
      id: 'run-1',
      sessionKey: 'w1d1',
      status: 'completed',
      healthkitSaved: false,
      startedAt: '2026-09-30T06:00:00.000Z',
      endedAt: '2026-09-30T06:30:00.000Z',
      distanceM: null,
      eventLogJson: null,
    };
    const saved: HealthWorkoutInput[] = [];
    void mock.module('@/db/client', () => ({
      db: {
        select: () => ({ from: () => ({ where: () => ({ get: () => run }) }) }),
        update: () => ({ set: () => ({ where: () => ({ run: () => {} }) }) }),
      },
    }));
    void mock.module('@/db/run-points', () => ({ loadRunFixes: () => [] }));
    void mock.module('@/db/run-segments', () => ({
      loadRunSegments: () => {
        throw new Error('database is locked');
      },
    }));
    void mock.module('./adapter', () => ({
      healthAdapter: {
        getAuthorization: () => 'authorized',
        saveRun: async (input: HealthWorkoutInput) => void saved.push(input),
      },
    }));

    const { syncRunToHealth } = await import('./sync');
    await expect(syncRunToHealth('run-1')).resolves.toBe('saved');
    expect(saved[0].segments).toEqual([]);
  });
});

describe('syncRunToHealth on a run already saved', () => {
  function mockSavedRun(saved: HealthWorkoutInput[]) {
    const run = {
      id: 'run-2',
      sessionKey: 'w1d1',
      status: 'completed',
      healthkitSaved: true,
      startedAt: '2026-09-30T06:00:00.000Z',
      endedAt: '2026-09-30T06:30:00.000Z',
      distanceM: null,
      eventLogJson: null,
    };
    void mock.module('@/db/client', () => ({
      db: {
        select: () => ({ from: () => ({ where: () => ({ get: () => run }) }) }),
        update: () => ({ set: () => ({ where: () => ({ run: () => {} }) }) }),
      },
    }));
    void mock.module('@/db/run-points', () => ({ loadRunFixes: () => [] }));
    void mock.module('@/db/run-segments', () => ({ loadRunSegments: () => [] }));
    void mock.module('./adapter', () => ({
      healthAdapter: {
        getAuthorization: () => 'authorized',
        saveRun: async (input: HealthWorkoutInput) => void saved.push(input),
      },
    }));
  }

  test('skips it, so a workout is never written twice', async () => {
    const saved: HealthWorkoutInput[] = [];
    mockSavedRun(saved);
    const { syncRunToHealth } = await import('./sync');
    await expect(syncRunToHealth('run-2')).resolves.toBe('skipped');
    expect(saved).toHaveLength(0);
  });

  test('writes it again when asked to re-save, to test HealthKit replacing it', async () => {
    const saved: HealthWorkoutInput[] = [];
    mockSavedRun(saved);
    const { syncRunToHealth } = await import('./sync');
    await expect(syncRunToHealth('run-2', { resave: true })).resolves.toBe('saved');
    expect(saved).toHaveLength(1);
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
