import * as Crypto from 'expo-crypto';

import type { CompletedRunRecord, RunPersistence } from '@/services/run-engine/types';
import { db } from './client';
import { runSegments, runs } from './schema';

export const dbRunPersistence: RunPersistence = {
  async saveRun(record: CompletedRunRecord): Promise<string> {
    const runId = Crypto.randomUUID();
    const nowIso = new Date().toISOString();

    await db.insert(runs).values({
      id: runId,
      sessionKey: record.sessionKey,
      status: record.status,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      activeDurationS: record.activeDurationS,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    if (record.segments.length > 0) {
      await db.insert(runSegments).values(
        record.segments.map((segment) => ({
          id: Crypto.randomUUID(),
          runId,
          seq: segment.seq,
          kind: segment.kind,
          plannedDurationS: segment.plannedDurationS,
          actualDurationS: segment.actualDurationS,
          wasSkipped: segment.wasSkipped,
          createdAt: nowIso,
          updatedAt: nowIso,
        })),
      );
    }
    return runId;
  },
};
