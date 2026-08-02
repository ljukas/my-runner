import { describe, expect, test } from 'bun:test';

import type { CompletedRunRecord, RunLifecyclePersistence } from '@/services/run-engine/types';
import type { HealthSyncResult } from './sync';
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

/** Lets fireSync's deferred setTimeout(0) fire before asserting on its effects (finding 4). */
function flushMacrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('withHealthSync', () => {
  test('syncs the id saveRun returned, and still returns it', async () => {
    const synced: string[] = [];
    const id = await withHealthSync(fakeBase(), (runId) => {
      synced.push(runId);
    }).saveRun(record);
    expect(id).toBe('saved-id');
    await flushMacrotasks();
    expect(synced).toEqual(['saved-id']);
  });

  test('syncs the finalized run', async () => {
    const synced: string[] = [];
    await withHealthSync(fakeBase(), (runId) => {
      synced.push(runId);
    }).finalizeRun('run-7', record);
    await flushMacrotasks();
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
    await flushMacrotasks();
    expect(order).toEqual(['local', 'health']);
  });

  // Regression for finding 4: fireSync used to run sync's synchronous prefix inline, so it — and
  // whatever real work `sync` does before its own first await (DB reads across the whole run) —
  // blocked the caller's own next steps (the engine's markSaved()/emit() and the summary
  // navigation) in the same tick. It must not have fired by the time finalizeRun/saveRun resolve.
  test('defers the sync call past the current turn, so it never blocks the caller', async () => {
    const synced: string[] = [];
    await withHealthSync(fakeBase(), (runId) => {
      synced.push(runId);
    }).finalizeRun('run-7', record);
    expect(synced).toEqual([]);
    await flushMacrotasks();
    expect(synced).toEqual(['run-7']);
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
      // the throw now happens inside fireSync's deferred setTimeout, so it hasn't run yet.
      await flushMacrotasks();
    });
    expect(warnings.length).toBe(1);
  });

  test('finalizeRun still resolves, and logs, when sync throws synchronously', async () => {
    const wrapped = withHealthSync(fakeBase(), () => {
      throw new Error('sync boom');
    });
    const warnings = await withCapturedWarnings(async () => {
      await expect(wrapped.finalizeRun('run-7', record)).resolves.toBeUndefined();
      await flushMacrotasks();
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
      // let fireSync's deferred call run, then its rejected promise's own catch settle.
      await flushMacrotasks();
    });

    process.off('unhandledRejection', onUnhandledRejection);
    expect(warnings.length).toBe(1);
    expect(unhandled).toEqual([]);
  });

  // Regression for finding 2: the composition root used to wrap the real sync call in `(runId) =>
  // void syncRunToHealth(runId)`, which discarded the Promise<HealthSyncResult> before it reached
  // fireSync — any rejection became an unhandled rejection instead of a logged warning. Passing a
  // `(runId: string) => Promise<HealthSyncResult>` straight through, exactly as `syncRunToHealth`'s
  // own signature is, must both type-check and behave like the `Promise<void>` cases above.
  test('accepts and correctly observes a sync callback shaped like syncRunToHealth (Promise<HealthSyncResult>)', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    const rejectingSync = (_runId: string): Promise<HealthSyncResult> =>
      Promise.reject(new Error('health down'));
    const wrapped = withHealthSync(fakeBase(), rejectingSync);

    const warnings = await withCapturedWarnings(async () => {
      await expect(wrapped.finalizeRun('run-7', record)).resolves.toBeUndefined();
      await flushMacrotasks();
    });

    process.off('unhandledRejection', onUnhandledRejection);
    expect(warnings.length).toBe(1);
    expect(unhandled).toEqual([]);
  });
});
