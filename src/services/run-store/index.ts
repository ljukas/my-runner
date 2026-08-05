import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { activeRunSnapshot } from '@/db/schema';
import { SNAPSHOT_ID, writeFlush } from './flush-transaction';
import type { RunSnapshotState, RunStore } from './port';

export const dbRunStore: RunStore = {
  async flush(runId, points, samples, entries, state) {
    const stateJson = JSON.stringify(state);
    const updatedAt = new Date().toISOString();

    // why: the expo-sqlite driver COMMITs the instant this callback returns — an async
    // callback would commit before its awaited writes ran, so both writes use sync `.run()`.
    db.transaction((tx) => writeFlush(tx, runId, points, samples, entries, stateJson, updatedAt));
  },

  async loadSnapshot() {
    const row = db
      .select()
      .from(activeRunSnapshot)
      .where(eq(activeRunSnapshot.id, SNAPSHOT_ID))
      .get();
    if (!row) return null;
    return { state: JSON.parse(row.stateJson) as RunSnapshotState, updatedAt: row.updatedAt };
  },

  async clearSnapshot() {
    db.delete(activeRunSnapshot).where(eq(activeRunSnapshot.id, SNAPSHOT_ID)).run();
  },
};
