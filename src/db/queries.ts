import { and, eq, isNull } from 'drizzle-orm';

import { runs } from './schema';

/** Soft-deleted rows are hidden from every user-facing query (ADR 0004). */
export const runNotDeleted = isNull(runs.deletedAt);

/** The one definition of a run that counts as completed: status + not soft-deleted. */
export const runCompleted = and(eq(runs.status, 'completed'), runNotDeleted)!;
