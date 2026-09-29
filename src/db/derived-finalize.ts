import { and, asc, eq, gt, lte, type SQL } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { encodePolyline, type LocationFix } from '@/domain/geo';
import { deriveOpenRun } from '@/domain/open-run';
import { parseEventLog } from '@/domain/run-altitude';
import { MOTION } from '@/domain/run-motion';
import type { CompletedRunRecord, FinalizeOutcome } from '@/services/run-engine/types';
import { runAltitudeSamples, runLog, runPoints, runSegments, runs } from './schema';

type Tx = BaseSQLiteDatabase<'sync', unknown>;

const iso = (ms: number) => new Date(ms).toISOString();

/** Children first: the foreign keys do not cascade. */
export function deleteRunTree(tx: Tx, runId: string): void {
  tx.delete(runLog).where(eq(runLog.runId, runId)).run();
  tx.delete(runAltitudeSamples).where(eq(runAltitudeSamples.runId, runId)).run();
  tx.delete(runPoints).where(eq(runPoints.runId, runId)).run();
  tx.delete(runSegments).where(eq(runSegments.runId, runId)).run();
  tx.delete(runs).where(eq(runs.id, runId)).run();
}

function loadFixes(tx: Tx, runId: string): LocationFix[] {
  return tx
    .select()
    .from(runPoints)
    .where(eq(runPoints.runId, runId))
    .orderBy(asc(runPoints.seq))
    .all()
    .map((row) => ({
      timestamp: Date.parse(row.timestamp),
      lat: row.lat,
      lng: row.lng,
      altitude: row.altitude,
      accuracy: row.accuracy,
      altitudeAccuracy: row.altitudeAccuracy,
      speed: row.speed,
    }));
}

/**
 * A free run's finalize, inside the caller's transaction (ADR 0026 §3–§4): `deriveOpenRun` settles
 * its end, then the run is either deleted (under a minute) or saved with one segment row per bucket.
 * Every point and barometer sample is re-tagged with its bucket — the deliberate exception to their
 * append-only rows (ADR 0021 §4) — using the fold's own `(start, end]` rule, so the route, splits and
 * export join on the saved buckets. Kept free of the DB client so `bun:sqlite` can run it.
 */
export function writeDerivedFinalize(
  tx: Tx,
  runId: string,
  record: CompletedRunRecord,
  { nowIso, newId }: { nowIso: string; newId: () => string },
): FinalizeOutcome {
  const logged = parseEventLog(record.eventLogJson ?? null);
  const endedAt = Date.parse(record.endedAt);
  const last = logged.at(-1);
  const events =
    last === undefined
      ? [
          { type: 'start', at: Date.parse(record.startedAt) },
          { type: 'end', at: endedAt },
        ]
      : last.type === 'end'
        ? logged
        : [...logged, { type: 'end', at: Math.max(endedAt, last.at) }];
  const fixes = loadFixes(tx, runId);
  const derived = deriveOpenRun({
    events,
    fixes,
    thresholdMps: record.derived?.thresholdMps ?? MOTION.fallbackThresholdMps,
  });
  if (derived.outcome === 'discard') {
    deleteRunTree(tx, runId);
    return 'discarded';
  }

  const endIso = iso(derived.endMs);
  tx.delete(runPoints)
    .where(and(eq(runPoints.runId, runId), gt(runPoints.timestamp, endIso)))
    .run();
  tx.delete(runAltitudeSamples)
    .where(and(eq(runAltitudeSamples.runId, runId), gt(runAltitudeSamples.at, endIso)))
    .run();

  derived.buckets.forEach((bucket, index) => {
    const first = index === 0;
    const last = index === derived.buckets.length - 1;
    const within = (column: typeof runPoints.timestamp | typeof runAltitudeSamples.at): SQL[] => [
      ...(first ? [] : [gt(column, iso(bucket.startMs))]),
      ...(last ? [] : [lte(column, iso(bucket.endMs))]),
    ];
    tx.update(runPoints)
      .set({ segmentSeq: bucket.seq })
      .where(and(eq(runPoints.runId, runId), ...within(runPoints.timestamp)))
      .run();
    tx.update(runAltitudeSamples)
      .set({ segmentSeq: bucket.seq })
      .where(and(eq(runAltitudeSamples.runId, runId), ...within(runAltitudeSamples.at)))
      .run();
  });

  const hasPoints = fixes.length > 0;
  tx.delete(runSegments).where(eq(runSegments.runId, runId)).run();
  if (derived.buckets.length > 0) {
    tx.insert(runSegments)
      .values(
        derived.buckets.map((bucket) => ({
          id: newId(),
          runId,
          seq: bucket.seq,
          kind: bucket.kind,
          plannedDurationS: 0,
          actualDurationS: bucket.durationS,
          distanceM: hasPoints ? bucket.distanceM : null,
          wasSkipped: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        })),
      )
      .run();
  }
  tx.update(runs)
    .set({
      status: 'completed',
      endedAt: endIso,
      activeDurationS: derived.activeDurationS,
      // why the record's: a run whose row never opened has no points, only its live distance
      distanceM: hasPoints ? derived.distanceM : (record.distanceM ?? null),
      summaryPolyline: hasPoints ? encodePolyline(derived.points) : null,
      eventLogJson: JSON.stringify(derived.events),
      motionPermission: record.motionPermission ?? null,
      updatedAt: nowIso,
    })
    .where(eq(runs.id, runId))
    .run();
  return 'saved';
}

/** A free run whose `startRun` never landed: its row is written here, then derived as any other. */
export function saveDerivedRun(
  tx: Tx,
  runId: string,
  record: CompletedRunRecord,
  context: { nowIso: string; newId: () => string },
): FinalizeOutcome {
  tx.insert(runs)
    .values({
      id: runId,
      sessionKey: record.sessionKey,
      status: 'active',
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      activeDurationS: 0,
      createdAt: context.nowIso,
      updatedAt: context.nowIso,
    })
    .run();
  return writeDerivedFinalize(tx, runId, record, context);
}
