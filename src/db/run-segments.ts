import { asc, eq } from 'drizzle-orm';

import type { SegmentRow } from '@/domain/health-segments';
import { db } from './client';
import { runSegments } from './schema';

export function loadRunSegments(runId: string): SegmentRow[] {
  return db
    .select({
      seq: runSegments.seq,
      kind: runSegments.kind,
      actualDurationS: runSegments.actualDurationS,
    })
    .from(runSegments)
    .where(eq(runSegments.runId, runId))
    .orderBy(asc(runSegments.seq))
    .all();
}
