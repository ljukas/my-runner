import { asc, eq, max } from 'drizzle-orm';

import type { ExportAltitudeSample, ExportLogEntry } from '@/domain/run-export';
import { db } from './client';
import { runAltitudeSamples, runLog, runPoints } from './schema';

/** Imperative by design: ADR 0004 §3 forbids `useLiveQuery` over the per-run streams. */
export function loadAltitudeSamples(runId: string): ExportAltitudeSample[] {
  return db
    .select()
    .from(runAltitudeSamples)
    .where(eq(runAltitudeSamples.runId, runId))
    .orderBy(asc(runAltitudeSamples.seq))
    .all();
}

export function loadRunLog(runId: string): ExportLogEntry[] {
  return db.select().from(runLog).where(eq(runLog.runId, runId)).orderBy(asc(runLog.seq)).all();
}

export function loadRunCounts(runId: string): { points: number; samples: number } {
  return {
    points: db.select().from(runPoints).where(eq(runPoints.runId, runId)).all().length,
    samples: loadAltitudeSamples(runId).length,
  };
}

/**
 * Where a resumed run's instrumentation continues instead of restarting (spec §5.1): the run's
 * `logSeq` snapshot watermark covers the two `seq` counters when present, but `epochBase` has no
 * snapshot field to carry it — `RunSnapshotState` has none — so it is always sourced here. A
 * max-`seq`/`epoch` query rather than a row load, since neither table has a primary key to scan by.
 */
export function loadLogResumeWatermarks(runId: string): {
  nextSampleSeq: number;
  nextEntrySeq: number;
  epochBase: number;
} {
  const sampleMax = db
    .select({ seq: max(runAltitudeSamples.seq), epoch: max(runAltitudeSamples.epoch) })
    .from(runAltitudeSamples)
    .where(eq(runAltitudeSamples.runId, runId))
    .get();
  const entryMax = db
    .select({ seq: max(runLog.seq) })
    .from(runLog)
    .where(eq(runLog.runId, runId))
    .get();
  return {
    nextSampleSeq: (sampleMax?.seq ?? -1) + 1,
    nextEntrySeq: (entryMax?.seq ?? -1) + 1,
    epochBase: sampleMax?.epoch ?? 0,
  };
}
