import { and, desc, eq } from 'drizzle-orm';

import { db } from './client';
import { runNotDeleted } from './queries';
import { runs } from './schema';

/** The most recently started run left in flight by a crash; null when there is none. */
export function findActiveRun(): { id: string; sessionKey: string; startedAt: string } | null {
  return (
    db
      .select({ id: runs.id, sessionKey: runs.sessionKey, startedAt: runs.startedAt })
      .from(runs)
      .where(and(eq(runs.status, 'active'), runNotDeleted))
      .orderBy(desc(runs.startedAt))
      .limit(1)
      .get() ?? null
  );
}
