import { desc } from 'drizzle-orm';

import { db } from '@/db/client';
import { runs } from '@/db/schema';
import { syncRunToHealth, type HealthSyncResult } from './sync';

/**
 * Development only: `resaveLatestRunToHealth()` on the JS console writes the newest run to Health
 * again, past the saved-once guard, so a re-save can be checked for replacing rather than
 * duplicating the workout, its distance and its route (ADR 0011, 2026-10-01 amendment).
 */
export function registerDevResave(): void {
  Object.assign(globalThis, {
    resaveLatestRunToHealth: async (): Promise<HealthSyncResult> => {
      const latest = db.select({ id: runs.id }).from(runs).orderBy(desc(runs.startedAt)).get();
      return latest ? syncRunToHealth(latest.id, { resave: true }) : 'skipped';
    },
  });
}
