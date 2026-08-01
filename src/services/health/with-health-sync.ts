import type { CompletedRunRecord, RunLifecyclePersistence } from '@/services/run-engine/types';

/**
 * Fires the Health save after — never before — the local write commits (ADR 0011 §4), and only on a
 * run *finish*, which is what keeps "no backfill" true: a Log revisit goes through neither method.
 * Wrapping at the composition root leaves the engine unaware that Health exists.
 */
export function withHealthSync(
  base: RunLifecyclePersistence,
  sync: (runId: string) => void,
): RunLifecyclePersistence {
  return {
    startRun: (sessionKey, startedAtIso) => base.startRun(sessionKey, startedAtIso),

    async saveRun(record: CompletedRunRecord): Promise<string> {
      const runId = await base.saveRun(record);
      sync(runId);
      return runId;
    },

    async finalizeRun(runId: string, record: CompletedRunRecord): Promise<void> {
      await base.finalizeRun(runId, record);
      sync(runId);
    },
  };
}
