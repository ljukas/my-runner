import type { Run } from '@/db/schema';
import { isFieldTestRun } from '@/services/field-test';

/**
 * Whether a stored run may be written to Apple Health at all. why a predicate inside the sync and
 * not only at its callers: a capture must never reach Health (spec §8.0) and a written workout
 * cannot be undone, so the invariant has to hold for a call site nobody has written yet — a resync
 * or backfill path would silently defeat one enforced by enumerating today's two.
 */
export function isHealthWritable(
  run: Pick<Run, 'sessionKey' | 'status' | 'healthkitSaved'>,
): boolean {
  return !isFieldTestRun(run.sessionKey) && run.status !== 'active' && !run.healthkitSaved;
}
