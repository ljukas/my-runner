import { asc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { loadRunFixes } from '@/db/run-points';
import { runSegments, runs } from '@/db/schema';
import { toHealthWorkout } from '@/domain/health';
import { healthAdapter } from './adapter';

// why: the auto-save and a summary button tap can target the same run at once, and HealthKit would
// happily write the workout twice.
const inFlight = new Set<string>();

/**
 * Writes a finalized run to Apple Health and records it locally. Never throws and never blocks a
 * run: the local save has already committed by the time this runs (ADR 0011 §4). `false` means
 * nothing was written — not authorized, already saved, or the save failed.
 */
export async function syncRunToHealth(runId: string): Promise<boolean> {
  if (inFlight.has(runId)) return false;
  if (healthAdapter.getAuthorization() !== 'authorized') return false;

  inFlight.add(runId);
  try {
    const run = db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run || run.status === 'active' || run.healthkitSaved) return false;

    const segments = db
      .select()
      .from(runSegments)
      .where(eq(runSegments.runId, runId))
      .orderBy(asc(runSegments.seq))
      .all();

    await healthAdapter.saveRun(toHealthWorkout(run, segments, loadRunFixes(runId)));

    db.update(runs)
      .set({ healthkitSaved: true, updatedAt: new Date().toISOString() })
      .where(eq(runs.id, runId))
      .run();
    return true;
  } catch (error) {
    console.warn('[health] save failed', error);
    return false;
  } finally {
    inFlight.delete(runId);
  }
}
