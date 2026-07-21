import { asc, eq } from 'drizzle-orm';
import * as Crypto from 'expo-crypto';

import { encodePolyline, smoothTrackBySegment, type SegmentedFix } from '@/domain/geo';
import type { CompletedRunRecord, RunLifecyclePersistence } from '@/services/run-engine/types';
import { db } from './client';
import { runPoints, runSegments, runs } from './schema';

// why: re-fold the accuracy-filtered points in insertion (`seq`) order — the order the live engine
// used — so the re-derived distance equals the live value (ADR 0021 §3); no re-gate.
function rollupFromPoints(runId: string) {
  const rows = db
    .select()
    .from(runPoints)
    .where(eq(runPoints.runId, runId))
    .orderBy(asc(runPoints.seq))
    .all();
  const fixes: SegmentedFix[] = rows.map((r) => ({
    timestamp: new Date(r.timestamp).getTime(),
    lat: r.lat,
    lng: r.lng,
    altitude: r.altitude,
    accuracy: r.accuracy,
    speed: r.speed,
    segmentSeq: r.segmentSeq,
  }));
  return { hasPoints: rows.length > 0, ...smoothTrackBySegment(fixes) };
}

export const dbRunPersistence: RunLifecyclePersistence = {
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

  async startRun(sessionKey: string, startedAtIso: string): Promise<string> {
    const runId = Crypto.randomUUID();
    const nowIso = new Date().toISOString();
    // ended_at / active_duration_s are NOT-NULL placeholders until finalizeRun (Wave A ratified migration).
    await db.insert(runs).values({
      id: runId,
      sessionKey,
      status: 'active',
      startedAt: startedAtIso,
      endedAt: startedAtIso,
      activeDurationS: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return runId;
  },

  async finalizeRun(runId: string, record: CompletedRunRecord): Promise<void> {
    const { hasPoints, distanceM, points, distanceBySegmentSeq } = rollupFromPoints(runId);
    const nowIso = new Date().toISOString();

    const segmentRows = record.segments.map((segment) => ({
      id: Crypto.randomUUID(),
      runId,
      seq: segment.seq,
      kind: segment.kind,
      plannedDurationS: segment.plannedDurationS,
      actualDurationS: segment.actualDurationS,
      distanceM: hasPoints ? (distanceBySegmentSeq.get(segment.seq) ?? 0) : null,
      wasSkipped: segment.wasSkipped,
      createdAt: nowIso,
      updatedAt: nowIso,
    }));

    if (__DEV__ && hasPoints) {
      // why: a bucket keyed under a segmentSeq with no matching record.segments[].seq is dropped from the
      // segment rows while still in the run total — the ADR 0021 §4 alignment Wave C fix-tagging must hold.
      const attributed = segmentRows.reduce((sum, row) => sum + (row.distanceM ?? 0), 0);
      if (Math.abs(attributed - distanceM) > 1e-6) {
        console.warn(
          `finalizeRun ${runId}: Σ per-segment (${attributed}) ≠ run distance (${distanceM}); run_points.segmentSeq keys not covered by record.segments[].seq (ADR 0021 §4).`,
        );
      }
    }

    // why: one commit flips active→terminal, replaces any prior segment rows (idempotent on the
    // crash-recovery re-finalize path), and writes the derived rollup. The expo-sqlite driver COMMITs
    // when this sync callback returns (see services/run-store/index.ts).
    db.transaction((tx) => {
      tx.update(runs)
        .set({
          status: record.status,
          endedAt: record.endedAt,
          activeDurationS: record.activeDurationS,
          distanceM: hasPoints ? distanceM : null,
          summaryPolyline: hasPoints ? encodePolyline(points) : null,
          updatedAt: nowIso,
        })
        .where(eq(runs.id, runId))
        .run();
      tx.delete(runSegments).where(eq(runSegments.runId, runId)).run();
      if (segmentRows.length > 0) {
        tx.insert(runSegments).values(segmentRows).run();
      }
    });
  },
};
