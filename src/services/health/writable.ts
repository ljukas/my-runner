import type { Run } from '@/db/schema';
import { isFieldTestRun } from '@/services/field-test';

/**
 * why a predicate inside the sync and not just the checks at its two callers: a written workout
 * cannot be undone, so a future resync or backfill caller must not be able to leak a capture
 * (spec §8.0).
 */
export function isHealthWritable(
  run: Pick<Run, 'sessionKey' | 'status' | 'healthkitSaved'>,
): boolean {
  return !isFieldTestRun(run.sessionKey) && run.status !== 'active' && !run.healthkitSaved;
}
