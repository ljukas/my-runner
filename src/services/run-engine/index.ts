import { useSyncExternalStore } from 'react';

import { findActiveRun, loadRunPoints } from '@/db/active-run';
import { dbRunPersistence } from '@/db/save-run';
import { getSession, type PlanSession } from '@/domain/plan';
import { activePlan } from '@/services/active-plan';
import { cueService } from '@/services/cue-service';
import { locationTracker } from '@/services/location-tracker';
import { dbRunStore } from '@/services/run-store';
import type { RunSnapshotState } from '@/services/run-store/port';
import { isTimelineExhausted, RunEngine } from './engine';
import { isSnapshotFresh, parseSnapshotState, snapshotAliveUntil } from './resumable';

export { endCountsAsCompleted } from './engine';

export const runEngine = new RunEngine({
  persistence: dbRunPersistence,
  cue: cueService,
  runStore: dbRunStore,
  tracker: locationTracker,
});

// Module scope, never a React effect, and imported from the app entry rather than a route: iOS
// relaunches the app headlessly for location updates, so the subscription has to exist before any
// route is required (ADR 0008 §4). The engine drops fixes unless a run is running.
// why the clamp: a fix dated ahead of the wall clock would tag its point with a segment index the
// finalize rollup never emits, silently dropping that distance from the per-segment split (ADR 0021 §4).
locationTracker.onFix((fix) => runEngine.heartbeat(Math.min(fix.timestamp, Date.now()), fix));

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
      await runEngine.abandon(candidate);
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
    return runEngine.restore({ ...candidate, points: loadRunPoints(candidate.runId) });
  } catch (error) {
    console.warn('[run-engine] resume failed', error);
    return false;
  }
}

/** Declining an offered run still finalizes it as `partial`, so its track stays reachable from the Log. */
export async function discardResumableRun(candidate: ResumableRun): Promise<void> {
  try {
    await runEngine.abandon(candidate);
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

export function useRunEngine() {
  return useSyncExternalStore(runEngine.subscribe, runEngine.getSnapshot);
}
