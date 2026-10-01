import { desc } from 'drizzle-orm';

import { db } from '@/db/client';
import { runs } from '@/db/schema';
import { syncRunToHealth, type HealthSyncResult } from './sync';

/** Dev only: exposes `resaveLatestRunToHealth()` on the JS console, past the saved-once guard. */
export function registerDevResave(): void {
  Object.assign(globalThis, {
    resaveLatestRunToHealth: async (): Promise<HealthSyncResult> => {
      const latest = db.select({ id: runs.id }).from(runs).orderBy(desc(runs.startedAt)).get();
      return latest ? syncRunToHealth(latest.id, { resave: true }) : 'skipped';
    },
  });
}
