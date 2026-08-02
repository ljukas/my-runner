import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { loadRunFixes } from '@/db/run-points';
import { runs } from '@/db/schema';
import { toHealthWorkout } from '@/domain/health';
import { healthAdapter } from './adapter';

// why: the auto-save and a summary button tap can target the same run at once, and HealthKit would
// happily write the workout twice.
const inFlight = new Set<string>();

/**
 * Names why a sync attempt didn't end in a write, so a caller can react only to a genuine failure:
 * `busy` (another call for this run is already in flight) and `skipped` (not authorized, already
 * saved, or not a finalized run) are both no-ops the UI should stay quiet about; only `failed` is
 * worth surfacing.
 */
export type HealthSyncResult = 'saved' | 'skipped' | 'busy' | 'failed';

/** Whether a result is worth telling the user about — the only outcome that names an actual failure. */
export function isHealthSyncFailure(result: HealthSyncResult): boolean {
  return result === 'failed';
}

/**
 * Writes a finalized run to Apple Health and records it locally. Never throws and never blocks a
 * run: the local save has already committed by the time this runs (ADR 0011 §4).
 */
export async function syncRunToHealth(runId: string): Promise<HealthSyncResult> {
  if (inFlight.has(runId)) return 'busy';

  inFlight.add(runId);
  try {
    // why inside the try: getAuthorization() is a native call and this function's docstring
    // promises it never throws — a throw here must land in the catch below, not reject the caller.
    if (healthAdapter.getAuthorization() !== 'authorized') return 'skipped';

    const run = db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run || run.status === 'active' || run.healthkitSaved) return 'skipped';

    await healthAdapter.saveRun(toHealthWorkout(run, loadRunFixes(runId)));

    db.update(runs)
      .set({ healthkitSaved: true, updatedAt: new Date().toISOString() })
      .where(eq(runs.id, runId))
      .run();
    return 'saved';
  } catch (error) {
    console.warn('[health] save failed', error);
    return 'failed';
  } finally {
    inFlight.delete(runId);
  }
}
