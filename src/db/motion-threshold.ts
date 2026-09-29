import { desc, eq } from 'drizzle-orm';

import { isFreeRun } from '@/domain/free-run';
import { parseSessionKey, type SegmentKind } from '@/domain/plan';
import { learnThresholdFromRuns, MOTION } from '@/domain/run-motion';
import { db } from './client';
import { runCompleted } from './queries';
import { loadRunFixes } from './run-points';
import { runSegments, runs } from './schema';

const PLAN_KINDS: readonly SegmentKind[] = ['warmup', 'run', 'walk', 'cooldown'];

/**
 * The run/walk threshold a new free run starts with: learned from the runner's last 3 completed
 * plan runs (ADR 0026 §3), 2.1 m/s without them. Never throws.
 */
export function loadLearnedThreshold(): number {
  try {
    const recent = db
      .select({ id: runs.id, sessionKey: runs.sessionKey })
      .from(runs)
      .where(runCompleted)
      .orderBy(desc(runs.startedAt))
      .all()
      .filter((run) => parseSessionKey(run.sessionKey) !== null && !isFreeRun(run.sessionKey))
      .slice(0, 3);
    return learnThresholdFromRuns(
      recent.map((run) => ({
        fixes: loadRunFixes(run.id),
        kindBySeq: new Map(
          db
            .select({ seq: runSegments.seq, kind: runSegments.kind })
            .from(runSegments)
            .where(eq(runSegments.runId, run.id))
            .all()
            .flatMap((row): [number, SegmentKind][] =>
              (PLAN_KINDS as readonly string[]).includes(row.kind)
                ? [[row.seq, row.kind as SegmentKind]]
                : [],
            ),
        ),
      })),
    );
  } catch (error) {
    console.warn('[motion] threshold read failed; using the fallback', error);
    return MOTION.fallbackThresholdMps;
  }
}
