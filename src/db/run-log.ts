import { asc, eq } from 'drizzle-orm';

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
