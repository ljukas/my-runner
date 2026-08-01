import { describe, expect, test } from 'bun:test';

import type { CompletedRunRecord, RunLifecyclePersistence } from '@/services/run-engine/types';
import { withHealthSync } from './with-health-sync';

const record: CompletedRunRecord = {
  sessionKey: 'w1d1',
  status: 'completed',
  startedAt: '2026-08-01T06:00:00.000Z',
  endedAt: '2026-08-01T06:30:00.000Z',
  activeDurationS: 1_800,
  segments: [],
};

function fakeBase(overrides: Partial<RunLifecyclePersistence> = {}): RunLifecyclePersistence {
  return {
    saveRun: async () => 'saved-id',
    startRun: async () => 'active-id',
    finalizeRun: async () => {},
    ...overrides,
  };
}

/** Captures console.warn for tests that exercise a warned sync failure, per engine.test.ts's pattern. */
async function withCapturedWarnings(body: () => Promise<void>): Promise<unknown[][]> {
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

describe('withHealthSync', () => {
  test('syncs the id saveRun returned, and still returns it', async () => {
    const synced: string[] = [];
    const id = await withHealthSync(fakeBase(), (runId) => {
      synced.push(runId);
    }).saveRun(record);
    expect(id).toBe('saved-id');
    expect(synced).toEqual(['saved-id']);
  });

  test('syncs the finalized run', async () => {
    const synced: string[] = [];
    await withHealthSync(fakeBase(), (runId) => {
      synced.push(runId);
    }).finalizeRun('run-7', record);
    expect(synced).toEqual(['run-7']);
  });

  test('syncs only after the local write has committed (ADR 0011 §4)', async () => {
    const order: string[] = [];
    const base = fakeBase({
      finalizeRun: async () => {
        await Promise.resolve();
        order.push('local');
      },
    });
    await withHealthSync(base, () => {
      order.push('health');
    }).finalizeRun('run-7', record);
    expect(order).toEqual(['local', 'health']);
  });

  test('does not sync when the local write fails', async () => {
    const synced: string[] = [];
    const base = fakeBase({
      finalizeRun: async () => {
        throw new Error('disk full');
      },
    });
    const wrapped = withHealthSync(base, (runId) => {
      synced.push(runId);
    });
    await expect(wrapped.finalizeRun('run-7', record)).rejects.toThrow('disk full');
    expect(synced).toEqual([]);
  });

  test('does not sync an in-flight run opened by startRun', async () => {
    const synced: string[] = [];
    await withHealthSync(fakeBase(), (runId) => {
      synced.push(runId);
    }).startRun('w1d1', record.startedAt);
    expect(synced).toEqual([]);
  });

  test('passes through members of base beyond the persistence interface', () => {
    const base = { ...fakeBase(), extra: 'kept' };
    const wrapped = withHealthSync(base, () => {});
    expect((wrapped as typeof base).extra).toBe('kept');
  });

  test('saveRun still resolves, and logs, when sync throws synchronously', async () => {
    const wrapped = withHealthSync(fakeBase(), () => {
      throw new Error('sync boom');
    });
    const warnings = await withCapturedWarnings(async () => {
      await expect(wrapped.saveRun(record)).resolves.toBe('saved-id');
    });
    expect(warnings.length).toBe(1);
  });

  test('finalizeRun still resolves, and logs, when sync throws synchronously', async () => {
    const wrapped = withHealthSync(fakeBase(), () => {
      throw new Error('sync boom');
    });
    const warnings = await withCapturedWarnings(async () => {
      await expect(wrapped.finalizeRun('run-7', record)).resolves.toBeUndefined();
    });
    expect(warnings.length).toBe(1);
  });

  test('finalizeRun still resolves, logs, and never surfaces an unhandled rejection, when sync rejects', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    const wrapped = withHealthSync(fakeBase(), () => Promise.reject(new Error('health down')));
    const warnings = await withCapturedWarnings(async () => {
      await expect(wrapped.finalizeRun('run-7', record)).resolves.toBeUndefined();
      // let the rejected sync promise's own microtask/catch settle before asserting nothing escaped.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    process.off('unhandledRejection', onUnhandledRejection);
    expect(warnings.length).toBe(1);
    expect(unhandled).toEqual([]);
  });
});
