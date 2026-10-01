import { desc } from 'drizzle-orm';

import { db } from '@/db/client';
import { runs } from '@/db/schema';
import { syncRunToHealth, type HealthSyncResult } from './sync';

/** Dev only: exposes `resaveLatestRunToHealth(olderBy?)` on the JS console, past the saved-once guard. */
export function registerDevResave(): void {
  Object.assign(globalThis, {
    resaveLatestRunToHealth: async (olderBy = 0): Promise<HealthSyncResult> => {
      const run = db
        .select({ id: runs.id })
        .from(runs)
        .orderBy(desc(runs.startedAt))
        .limit(1)
        .offset(olderBy)
        .all()[0];
      return run ? syncRunToHealth(run.id, { resave: true }) : 'skipped';
    },
  });
}
