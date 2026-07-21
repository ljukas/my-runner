import { and, eq, isNull, ne } from 'drizzle-orm';

import { runs } from './schema';

/** Soft-deleted rows are hidden from every user-facing query (ADR 0004). */
export const runNotDeleted = isNull(runs.deletedAt);

/**
 * A run that counts as a *result* — finalized (completed or partial) and not
 * soft-deleted. Excludes the in-flight/abandoned `'active'` row created at
 * `start()` (Stage 3 crash-recovery contract): an unfinalized run is never a
 * history entry. Use for any list/aggregate over runs (e.g. the Log); use
 * `runCompleted` where only fully-completed runs count (plan progression).
 */
export const runIsResult = and(ne(runs.status, 'active'), runNotDeleted)!;

/** The one definition of a run that counts as completed: status + not soft-deleted. */
export const runCompleted = and(eq(runs.status, 'completed'), runNotDeleted)!;
