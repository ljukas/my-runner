import { asc, eq } from 'drizzle-orm';

import type { SegmentedFix } from '@/domain/geo';
import type { BufferedRunPoint } from '@/services/run-engine/types';
import { db } from './client';
import { runPoints } from './schema';

function rows(runId: string) {
  return db
    .select()
    .from(runPoints)
    .where(eq(runPoints.runId, runId))
    .orderBy(asc(runPoints.seq))
    .all();
}

/** A run's accepted fixes in insertion (`seq`) order — the order the live engine folded (ADR 0021 §3). */
export function loadRunFixes(runId: string): SegmentedFix[] {
  return loadBufferedRunPoints(runId);
}

/** The same stream in the engine's buffered shape, which carries `seq` for resumed batch writes. */
export function loadBufferedRunPoints(runId: string): BufferedRunPoint[] {
  return rows(runId).map((row) => ({
    seq: row.seq,
    segmentSeq: row.segmentSeq,
    timestamp: new Date(row.timestamp).getTime(),
    lat: row.lat,
    lng: row.lng,
    altitude: row.altitude,
    accuracy: row.accuracy,
    altitudeAccuracy: row.altitudeAccuracy,
    speed: row.speed,
  }));
}
