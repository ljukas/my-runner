import * as Battery from 'expo-battery';
import { Pedometer } from 'expo-sensors';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { findActiveRun } from '@/db/active-run';
import { loadLogResumeWatermarks } from '@/db/run-log';
import { loadBufferedRunPoints } from '@/db/run-points';
import { dbRunPersistence } from '@/db/save-run';
import { getSession, type PlanSession } from '@/domain/plan';
import { activePlan } from '@/services/active-plan';
import { cueService } from '@/services/cue-service';
import { elevationSource, type ElevationSource } from '@/services/elevation';
import { syncRunToHealth, withHealthSync } from '@/services/health';
import { locationTracker } from '@/services/location-tracker';
import { dbRunStore } from '@/services/run-store';
import type { RunSnapshotState } from '@/services/run-store/port';
import { isTimelineExhausted, RunEngine } from './engine';
import { PROCESS_TOKEN } from './run-log';
import { isSnapshotFresh, parseSnapshotState, snapshotAliveUntil } from './resumable';
import type { StepCounter } from './types';

export { endCountsAsCompleted } from './engine';

// why wrap start() rather than note from the engine: this is the only seam that fires exactly once
// per run start/restore (engine.ts's queueElevation) without engine.ts importing anything to log it
// (spec §6.1). retryMotion() below calls the same wrapped start(), so a mid-run grant gets a row too.
const elevationWithSensorLog: ElevationSource = {
  ...elevationSource,
  async start() {
    try {
      const [available, permission] = await Promise.all([
        elevationSource.isAvailable(),
        elevationSource.getPermissionStatus(),
      ]);
      runEngine.note('sensor', { available, permission, processToken: PROCESS_TOKEN });
    } catch (error) {
      console.warn('[run-engine] sensor note failed', error);
    }
    return elevationSource.start();
  },
};

// why wrapped rather than passed raw: getStepCountAsync performs no permission check of its own —
// it rejects when Motion & Fitness isn't authorized — and a finalize that throws is a run that
// never gets saved (spec §6.3).
const stepCounter: StepCounter = async (start, end) => {
  try {
    const { steps } = await Pedometer.getStepCountAsync(start, end);
    return steps;
  } catch (error) {
    console.warn('[run-engine] step count read failed', error);
    return null;
  }
};

export const runEngine = new RunEngine({
  // why not `(runId) => void syncRunToHealth(runId)`: that discards the real promise, so fireSync's
  // own `Promise.resolve(sync(runId)).catch(...)` would await `undefined` and any rejection from
  // syncRunToHealth would become an unhandled rejection instead of a logged warning. Pass the
  // function straight through so its promise reaches fireSync.
  persistence: withHealthSync(dbRunPersistence, syncRunToHealth),
  cue: cueService,
  runStore: dbRunStore,
  tracker: locationTracker,
  elevation: elevationWithSensorLog,
  stepCounter,
});

// Module scope, never a React effect, and imported from the app entry rather than a route: iOS
// relaunches the app headlessly for location updates, so the subscription has to exist before any
// route is required (ADR 0008 §4). The engine drops fixes unless a run is running.
locationTracker.onFix((fix) => {
  // why here and not in the engine: this is the ONLY place every delivered fix is visible —
  // `ingestFix` never sees a fix delivered while paused, and CoreLocation delivers batches, so a
  // receipt-time stamp is what makes a process freeze detectable at all (spec §6.1).
  runEngine.note('fix_batch', { receivedAt: Date.now(), fixAt: fix.timestamp });
  // why the clamp: a fix dated ahead of the wall clock would tag its point with a segment index the
  // finalize rollup never emits, silently dropping that distance from the per-segment split (ADR 0021 §4).
  runEngine.heartbeat(Math.min(fix.timestamp, Date.now()), fix);
});

try {
  AppState.addEventListener('change', (state) => {
    runEngine.note('lifecycle', { state });
  });
} catch (error) {
  console.warn('[run-engine] lifecycle subscription failed', error);
}

// expo-battery is device-only (Simulator has no battery) — these resolve to defaults or reject
// there, and the wrap absorbs it so a missing sensor can never affect a run (spec §6.3).
void Battery.getBatteryLevelAsync()
  .then((level) => runEngine.note('battery', { level }))
  .catch((error) => console.warn('[run-engine] battery level read failed', error));
try {
  Battery.addLowPowerModeListener(({ lowPowerMode }) => {
    runEngine.note('battery', { lowPowerMode });
  });
} catch (error) {
  console.warn('[run-engine] battery subscription failed', error);
}

export interface ResumableRun {
  runId: string;
  session: PlanSession;
  state: RunSnapshotState;
  /** Where this run's record ends if it is abandoned rather than resumed (`snapshotAliveUntil`). */
  aliveUntil: number;
}

// Background location updates outlive the process, so anything that ends without a live run must
// stop them — otherwise a crashed run keeps the GPS on indefinitely (ADR 0008 §3).
function stopIdleTracking(): null {
  if (runEngine.getSnapshot().status === 'idle') {
    void locationTracker
      .stop()
      .catch((error) => console.warn('[run-engine] location stop failed', error));
  }
  return null;
}

async function clearSnapshot(): Promise<void> {
  try {
    await dbRunStore.clearSnapshot();
  } catch (error) {
    console.warn('[run-engine] snapshot discard failed', error);
  }
}

/**
 * The interrupted run worth offering at launch, or null. Never throws, and never leaves work for the
 * next launch: a corrupt, stale or expired snapshot is settled here — finalized as `partial` when its
 * own `'active'` row is identifiable, else discarded.
 */
export async function detectResumableRun(): Promise<ResumableRun | null> {
  try {
    const loaded = await dbRunStore.loadSnapshot();
    if (!loaded) return stopIdleTracking();

    const state = parseSnapshotState(loaded.state);
    const active = state ? findActiveRun() : null;
    // why the exact start-time match: it is the only thing tying this snapshot to this row. On
    // `sessionKey` alone, a same-session run started after the crash would be resumed from the
    // previous attempt's log.
    const tiedToRow =
      state !== null &&
      active !== null &&
      active.sessionKey === state.sessionKey &&
      Date.parse(active.startedAt) === state.events[0].at;
    const session = state ? getSession(activePlan(), state.sessionKey) : undefined;
    if (!state || !active || !session || !tiedToRow) {
      await clearSnapshot();
      return stopIdleTracking();
    }

    const now = Date.now();
    const candidate: ResumableRun = {
      runId: active.id,
      session,
      state,
      aliveUntil: snapshotAliveUntil(loaded.updatedAt, now),
    };
    if (
      !isSnapshotFresh(loaded.updatedAt, session, now) ||
      isTimelineExhausted(session, state.events, now)
    ) {
      // why here too, not just resumeCrashedRun: abandon() also rebuilds the log counters before its
      // own finalize flush mints new rows (a tick at least) — without this the same duplicate-seq risk
      // applies to the discarded run's tail.
      await runEngine.abandon({
        ...candidate,
        logResume: loadLogResumeWatermarks(candidate.runId),
      });
      return null;
    }
    return candidate;
  } catch (error) {
    console.warn('[run-engine] resume detection failed; treating as not resumable', error);
    return stopIdleTracking();
  }
}

/** Rebuilds the interrupted run in the engine from its persisted points (ADR 0021 §3). */
export async function resumeCrashedRun(candidate: ResumableRun): Promise<boolean> {
  try {
    return runEngine.restore({
      ...candidate,
      points: loadBufferedRunPoints(candidate.runId),
      // why: continues this run's log `seq`/`epoch` instead of restarting them (spec §5.1) — see
      // db/run-log.ts's `loadLogResumeWatermarks` for why `epochBase` always comes from here.
      logResume: loadLogResumeWatermarks(candidate.runId),
    });
  } catch (error) {
    console.warn('[run-engine] resume failed', error);
    return false;
  }
}

/** Declining an offered run still finalizes it as `partial`, so its track stays reachable from the Log. */
export async function discardResumableRun(candidate: ResumableRun): Promise<void> {
  try {
    await runEngine.abandon({ ...candidate, logResume: loadLogResumeWatermarks(candidate.runId) });
  } catch (error) {
    console.warn('[run-engine] discard failed', error);
  }
}

/** Re-arms tracking after location is granted mid-run: this run's start() bailed out while the
 *  permission was missing, and nothing else retries (ADR 0008 §5). */
export async function retryTracking(): Promise<void> {
  const { status } = runEngine.getSnapshot();
  if (status !== 'running' && status !== 'paused') return;
  if ((await locationTracker.getPermissionStatus()) !== 'granted') return;
  await locationTracker.start();
}

/** Motion analogue of `retryTracking()`: re-arms barometer capture after Motion & Fitness is granted
 *  mid-run through Settings (ADR 0008 §5's pattern, applied to the second sensor). */
export async function retryMotion(): Promise<void> {
  const { status } = runEngine.getSnapshot();
  if (status !== 'running' && status !== 'paused') return;
  if ((await elevationSource.getPermissionStatus()) !== 'granted') return;
  await elevationWithSensorLog.start();
}

export function useRunEngine() {
  return useSyncExternalStore(runEngine.subscribe, runEngine.getSnapshot);
}
