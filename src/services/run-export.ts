import { and, asc, eq } from 'drizzle-orm';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { db } from '@/db/client';
import { loadAltitudeSamples, loadRunLog } from '@/db/run-log';
import { loadRunFixes } from '@/db/run-points';
import { runNotDeleted } from '@/db/queries';
import { runs, runSegments } from '@/db/schema';
import { toRunExport, type ExportEvent, type ExportPoint } from '@/domain/run-export';

function fileName(runId: string, startedAt: string): string {
  const stamp = startedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  return `runbro-${stamp}-${runId.slice(0, 8)}.txt`;
}

/**
 * Writes one run's full data to the cache and opens the system share sheet. Never throws —
 * the caller shows the outcome. Not reachable while a run is live: the reads are synchronous
 * and would stall the heartbeat (spec §7.2).
 */
export async function exportRun(runId: string): Promise<'shared' | 'unavailable' | 'failed'> {
  try {
    const run = db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), runNotDeleted))
      .all()[0];
    if (!run) return 'unavailable';

    const segments = db
      .select()
      .from(runSegments)
      .where(eq(runSegments.runId, runId))
      .orderBy(asc(runSegments.seq))
      .all();

    const points: ExportPoint[] = loadRunFixes(runId).map((fix, index) => ({
      seq: index,
      at: new Date(fix.timestamp).toISOString(),
      lat: fix.lat,
      lng: fix.lng,
      altitudeM: fix.altitude,
      accuracyM: fix.accuracy,
      altitudeAccuracyM: fix.altitudeAccuracy ?? null,
      speedMps: fix.speed,
      segmentSeq: fix.segmentSeq,
    }));

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
        model: Constants.deviceName ?? 'unknown',
        osVersion: String(Platform.Version),
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        updateId: Constants.expoConfig?.extra?.updateId ?? null,
        barometerAvailable: loadAltitudeSamples(runId).length > 0,
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
      samples: loadAltitudeSamples(runId),
      log: loadRunLog(runId),
      events,
    });

    const file = new File(Paths.cache, fileName(runId, run.startedAt));
    // why overwrite: the name is deterministic per run, and re-exporting a run is a supported
    // action — `create()` throws when the file already exists.
    file.create({ overwrite: true });
    file.write(text);

    if (!(await Sharing.isAvailableAsync())) return 'unavailable';
    await Sharing.shareAsync(file.uri, { UTI: 'public.plain-text', mimeType: 'text/plain' });
    return 'shared';
  } catch (error) {
    console.warn('[run-export] export failed', error);
    return 'failed';
  }
}
