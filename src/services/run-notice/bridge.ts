import type { RunNotice } from '@/domain/run-notice';

/**
 * Posts each outcome the engine leaves on its idle snapshot. why by identity: the idle snapshot
 * keeps its outcome until the next run starts, so a screen that read it on mount would post it
 * again every time it remounted; one outcome is one snapshot object.
 */
export function bridgeEngineNotices(
  engine: {
    subscribe: (l: () => void) => () => void;
    getSnapshot: () => { lastOutcome: RunNotice | null };
  },
  notices: { post: (notice: RunNotice) => void },
): () => void {
  let noticed: unknown = null;
  return engine.subscribe(() => {
    const snapshot = engine.getSnapshot();
    if (snapshot.lastOutcome === null || snapshot === noticed) return;
    noticed = snapshot;
    notices.post(snapshot.lastOutcome);
  });
}
