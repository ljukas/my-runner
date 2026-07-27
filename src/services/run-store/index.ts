import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { activeRunSnapshot, runPoints } from '@/db/schema';
import type { RunSnapshotState, RunStore } from './port';

const SNAPSHOT_ID = 1;

export const dbRunStore: RunStore = {
  async flush(runId, points, state) {
    const stateJson = JSON.stringify(state);
    const updatedAt = new Date().toISOString();

    // why: the expo-sqlite driver COMMITs the instant this callback returns — an async
    // callback would commit before its awaited writes ran, so both writes use sync `.run()`.
    db.transaction((tx) => {
      // drizzle throws on `.values([])`; an empty batch still re-stamps the snapshot.
      if (points.length > 0) {
        tx.insert(runPoints)
          .values(
            points.map((p) => ({
              runId,
              seq: p.seq,
              timestamp: p.timestamp,
              lat: p.lat,
              lng: p.lng,
              altitude: p.altitude,
              accuracy: p.accuracy,
              speed: p.speed,
              segmentSeq: p.segmentSeq,
            })),
          )
          .run();
      }
      tx.insert(activeRunSnapshot)
        .values({ id: SNAPSHOT_ID, stateJson, updatedAt })
        .onConflictDoUpdate({ target: activeRunSnapshot.id, set: { stateJson, updatedAt } })
        .run();
    });
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
