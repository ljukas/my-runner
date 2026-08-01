import type { CompletedRunRecord, RunLifecyclePersistence } from '@/services/run-engine/types';

/**
 * Fires the Health save after — never before — the local write commits (ADR 0011 §4), and only on a
 * run *finish*, which is what keeps "no backfill" true: a Log revisit goes through neither method.
 * Wrapping at the composition root leaves the engine unaware that Health exists.
 */
export function withHealthSync(
  base: RunLifecyclePersistence,
  // why Promise<unknown>, not Promise<void>: it has to accept syncRunToHealth's Promise<HealthSyncResult>
  // directly — fireSync only ever awaits the promise to catch a rejection, never its resolved value.
  sync: (runId: string) => void | Promise<unknown>,
): RunLifecyclePersistence {
  // why: a `sync` failure must never read back as the local write failing (ADR 0011 §4) — a run that
  // already committed locally has to stay a success regardless of whether `sync` throws synchronously
  // or returns a rejected promise. Both are caught and logged here, never left to the caller.
  function fireSync(runId: string): void {
    try {
      void Promise.resolve(sync(runId)).catch((error: unknown) => {
        console.warn('[health] sync failed', error);
      });
    } catch (error) {
      console.warn('[health] sync failed', error);
    }
  }

  return {
    ...base,
    async saveRun(record: CompletedRunRecord): Promise<string> {
      const runId = await base.saveRun(record);
      fireSync(runId);
      return runId;
    },

    async finalizeRun(runId: string, record: CompletedRunRecord): Promise<void> {
      await base.finalizeRun(runId, record);
      fireSync(runId);
    },
  };
}
