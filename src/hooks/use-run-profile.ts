import { useMemo } from 'react';

import { loadRunFixes } from '@/db/run-points';
import { toRunProfile, type ProfilePoint } from '@/domain/run-profile';

export type RunProfile = { ready: false } | { ready: true; points: ProfilePoint[] };

/**
 * A finished run's pace series. Reads `run_points` ONCE, non-reactively — never via
 * `useLiveQuery` (ADR 0004 §3) — and re-folds with the same smoother the stored distance used
 * (ADR 0021 §3). `loaded` is the caller's `updatedAt !== undefined`.
 */
export function useRunProfile(runId: string, loaded: boolean): RunProfile {
  return useMemo(() => {
    if (!loaded) return { ready: false };
    try {
      const points = toRunProfile(loadRunFixes(runId));
      // why 2: a single point draws no line, so it is indistinguishable from no chart.
      if (points.length < 2) return { ready: false };
      return { ready: true, points };
    } catch (error) {
      // why: no ErrorBoundary wraps this route; a SQLite read failure must degrade to
      // no card, not crash render.
      console.warn('[use-run-profile] profile load failed; hiding the card', error);
      return { ready: false };
    }
  }, [runId, loaded]);
}
