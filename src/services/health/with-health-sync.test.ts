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

describe('withHealthSync', () => {
  test('syncs the id saveRun returned, and still returns it', async () => {
    const synced: string[] = [];
    const id = await withHealthSync(fakeBase(), (runId) => synced.push(runId)).saveRun(record);
    expect(id).toBe('saved-id');
    expect(synced).toEqual(['saved-id']);
  });

  test('syncs the finalized run', async () => {
    const synced: string[] = [];
    await withHealthSync(fakeBase(), (runId) => synced.push(runId)).finalizeRun('run-7', record);
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
    await withHealthSync(base, () => order.push('health')).finalizeRun('run-7', record);
    expect(order).toEqual(['local', 'health']);
  });

  test('does not sync when the local write fails', async () => {
    const synced: string[] = [];
    const base = fakeBase({
      finalizeRun: async () => {
        throw new Error('disk full');
      },
    });
    const wrapped = withHealthSync(base, (runId) => synced.push(runId));
    await expect(wrapped.finalizeRun('run-7', record)).rejects.toThrow('disk full');
    expect(synced).toEqual([]);
  });

  test('does not sync an in-flight run opened by startRun', async () => {
    const synced: string[] = [];
    await withHealthSync(fakeBase(), (runId) => synced.push(runId)).startRun(
      'w1d1',
      record.startedAt,
    );
    expect(synced).toEqual([]);
  });
});
