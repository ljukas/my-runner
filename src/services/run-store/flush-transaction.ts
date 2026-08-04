import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { activeRunSnapshot, runAltitudeSamples, runLog, runPoints } from '@/db/schema';
import type { PendingEntry, PendingSample } from '@/services/run-engine/run-log';
import type { RunPoint } from './port';

export const SNAPSHOT_ID = 1;

/**
 * The flush transaction's writes, kept in their own module (no `@/db/client` import) so the
 * atomicity property `dbRunStore.flush` depends on can be driven against a real synchronous
 * SQLite driver (`bun:sqlite`) in tests — `dbRunStore` itself sits behind an `expo-sqlite`
 * import that opens a database at module load, which `bun test` cannot run.
 */
export function writeFlush(
  tx: BaseSQLiteDatabase<'sync', unknown>,
  runId: string,
  points: RunPoint[],
  samples: PendingSample[],
  entries: PendingEntry[],
  stateJson: string,
  updatedAt: string,
): void {
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
          altitudeAccuracy: p.altitudeAccuracy ?? null,
          speed: p.speed,
          segmentSeq: p.segmentSeq,
        })),
      )
      .run();
  }
  // why the same transaction: a second writer would double the write rate at ~1 Hz and
  // reopen the divergence the atomic flush closes (ADR 0007 §5, run-store/port.ts).
  if (samples.length > 0) {
    tx.insert(runAltitudeSamples)
      .values(
        samples.map((s) => ({
          runId,
          seq: s.seq,
          at: new Date(s.at).toISOString(),
          sensorTimestampS: s.sensorTimestampS,
          pressureHpa: s.pressureHpa,
          relativeAltitudeM: s.relativeAltitudeM,
          epoch: s.epoch,
          segmentSeq: s.segmentSeq,
        })),
      )
      .run();
  }
  if (entries.length > 0) {
    tx.insert(runLog)
      .values(
        entries.map((e) => ({
          runId,
          seq: e.seq,
          at: new Date(e.at).toISOString(),
          kind: e.kind,
          detailJson: e.detailJson,
        })),
      )
      .run();
  }
  tx.insert(activeRunSnapshot)
    .values({ id: SNAPSHOT_ID, stateJson, updatedAt })
    .onConflictDoUpdate({ target: activeRunSnapshot.id, set: { stateJson, updatedAt } })
    .run();
}
