import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { activeRunSnapshot, runAltitudeSamples, runLog, runPoints } from '@/db/schema';
import type { PendingEntry, PendingSample } from '@/services/run-engine/run-log';
import type { RunPoint } from './port';

export const SNAPSHOT_ID = 1;

// why 500: SQLite caps one statement at 32,766 bind params (SQLITE_MAX_VARIABLE_NUMBER); the
// widest row here binds 8, so 500 rows/insert stays at 4,000 — comfortably under the ceiling even
// if a caller ever handed writeFlush the full MAX_LOG_BUFFER (4,000 rows => 32,000 params alone).
const CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

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
    for (const batch of chunk(points, CHUNK_SIZE)) {
      tx.insert(runPoints)
        .values(
          batch.map((p) => ({
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
  }
  // why the same transaction: a second writer would double the write rate at ~1 Hz and
  // reopen the divergence the atomic flush closes (ADR 0007 §5, run-store/port.ts).
  //
  // why skip a non-finite `at`, not fall back to `updatedAt`: a substituted time would be
  // indistinguishable from a real one once written, but the row's own `seq` gap already marks a
  // drop durably (run-log.ts's seq-gap contract) — on a build with no console this is the only
  // evidence that survives.
  const safeSamples = samples.filter((s) => Number.isFinite(s.at));
  if (safeSamples.length < samples.length) {
    console.warn(
      `[run-store] dropped ${samples.length - safeSamples.length} altitude sample(s) with a non-finite \`at\``,
    );
  }
  if (safeSamples.length > 0) {
    for (const batch of chunk(safeSamples, CHUNK_SIZE)) {
      tx.insert(runAltitudeSamples)
        .values(
          batch.map((s) => ({
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
  }
  const safeEntries = entries.filter((e) => Number.isFinite(e.at));
  if (safeEntries.length < entries.length) {
    console.warn(
      `[run-store] dropped ${entries.length - safeEntries.length} log entry(ies) with a non-finite \`at\``,
    );
  }
  if (safeEntries.length > 0) {
    for (const batch of chunk(safeEntries, CHUNK_SIZE)) {
      tx.insert(runLog)
        .values(
          batch.map((e) => ({
            runId,
            seq: e.seq,
            at: new Date(e.at).toISOString(),
            kind: e.kind,
            detailJson: e.detailJson,
          })),
        )
        .run();
    }
  }
  tx.insert(activeRunSnapshot)
    .values({ id: SNAPSHOT_ID, stateJson, updatedAt })
    .onConflictDoUpdate({ target: activeRunSnapshot.id, set: { stateJson, updatedAt } })
    .run();
}
