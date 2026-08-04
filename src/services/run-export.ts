import { and, asc, eq } from 'drizzle-orm';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { updateId } from 'expo-updates';
import { Platform } from 'react-native';

import { db } from '@/db/client';
import { loadAltitudeSamples, loadRunLog } from '@/db/run-log';
import { loadBufferedRunPoints } from '@/db/run-points';
import { runIsResult } from '@/db/queries';
import { runs, runSegments } from '@/db/schema';
import { toRunExport, type ExportEvent, type ExportPoint } from '@/domain/run-export';

function fileName(runId: string, startedAt: string): string {
  const stamp = startedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  return `runbro-${stamp}-${runId.slice(0, 8)}.txt`;
}

/**
 * Writes one run's full data to the cache and opens the system share sheet. Never throws —
 * the caller shows the outcome. Not reachable while a run is live — enforced here via
 * `runIsResult`, not just the navigation graph — because the reads are synchronous and would
 * stall the heartbeat (spec §7.2).
 */
export async function exportRun(runId: string): Promise<'shared' | 'unavailable' | 'failed'> {
  try {
    const run = db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), runIsResult))
      .all()[0];
    if (!run) return 'unavailable';

    const segments = db
      .select()
      .from(runSegments)
      .where(eq(runSegments.runId, runId))
      .orderBy(asc(runSegments.seq))
      .all();

    const points: ExportPoint[] = loadBufferedRunPoints(runId).map((fix) => ({
      seq: fix.seq,
      at: new Date(fix.timestamp).toISOString(),
      lat: fix.lat,
      lng: fix.lng,
      altitudeM: fix.altitude,
      accuracyM: fix.accuracy,
      altitudeAccuracyM: fix.altitudeAccuracy ?? null,
      speedMps: fix.speed,
      segmentSeq: fix.segmentSeq,
    }));

    const samples = loadAltitudeSamples(runId);

    let events: ExportEvent[] = [];
    if (run.eventLogJson) {
      try {
        events = JSON.parse(run.eventLogJson) as ExportEvent[];
      } catch {
        events = [];
      }
    }

    const text = toRunExport({
      exportedAt: new Date().toISOString(),
      device: {
        // expo-device is deliberately not installed for one header field (Task 5 brief).
        deviceName: Constants.deviceName ?? 'unknown',
        osVersion: String(Platform.Version),
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        updateId,
        anySamplesRecorded: samples.length > 0,
        motionPermission: run.motionPermission,
        timezoneOffsetMin: new Date().getTimezoneOffset(),
      },
      run: {
        id: run.id,
        sessionKey: run.sessionKey,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        activeDurationS: run.activeDurationS,
        distanceM: run.distanceM,
      },
      segments: segments.map((s) => ({
        seq: s.seq,
        kind: s.kind,
        plannedDurationS: s.plannedDurationS,
        actualDurationS: s.actualDurationS,
        distanceM: s.distanceM,
        wasSkipped: s.wasSkipped,
      })),
      points,
      samples,
      log: loadRunLog(runId),
      events,
    });

    const file = new File(Paths.cache, fileName(runId, run.startedAt));
    // why overwrite: the name is deterministic per run, and re-exporting a run is a supported
    // action — `create()` throws when the file already exists.
    file.create({ overwrite: true });
    file.write(text);

    if (!(await Sharing.isAvailableAsync())) return 'unavailable';
    // why: on iOS, expo-sharing's completion handler resolves the same way on Cancel as on a
    // completed AirDrop (SharingModule.swift ignores UIActivityViewController's `completed` flag)
    // — 'shared' below means only that the share sheet was presented, never that the file actually
    // left the device. Do not build a success indicator on this resolution.
    await Sharing.shareAsync(file.uri, { UTI: 'public.plain-text', mimeType: 'text/plain' });
    return 'shared';
  } catch (error) {
    console.warn('[run-export] export failed', error);
    return 'failed';
  }
}
