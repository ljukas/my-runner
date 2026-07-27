import { and, asc, desc, eq } from 'drizzle-orm';

import type { BufferedRunPoint } from '@/services/run-engine/types';
import { db } from './client';
import { runNotDeleted } from './queries';
import { runPoints, runs } from './schema';

/** The most recently started run left in flight by a crash; null when there is none. */
export function findActiveRun(): { id: string; sessionKey: string; startedAt: string } | null {
  return (
    db
      .select({ id: runs.id, sessionKey: runs.sessionKey, startedAt: runs.startedAt })
      .from(runs)
      .where(and(eq(runs.status, 'active'), runNotDeleted))
      .orderBy(desc(runs.startedAt))
      .limit(1)
      .get() ?? null
  );
}

/** A run's points in insertion (`seq`) order — the exact stream the resume fold replays (ADR 0021 §3). */
export function loadRunPoints(runId: string): BufferedRunPoint[] {
  return db
    .select()
    .from(runPoints)
    .where(eq(runPoints.runId, runId))
    .orderBy(asc(runPoints.seq))
    .all()
    .map((row) => ({
      seq: row.seq,
      segmentSeq: row.segmentSeq,
      timestamp: new Date(row.timestamp).getTime(),
      lat: row.lat,
      lng: row.lng,
      altitude: row.altitude,
      accuracy: row.accuracy,
      speed: row.speed,
    }));
}
