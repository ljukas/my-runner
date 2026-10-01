import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { runCompleted } from '@/db/queries';
import { runs } from '@/db/schema';
import { planProgress, type PlanProgress } from '@/domain/plan-progress';
import { useActivePlan } from '@/services/active-plan';

export function usePlanProgress(): PlanProgress {
  const plan = useActivePlan();
  const { data } = useLiveQuery(
    db.select({ sessionKey: runs.sessionKey }).from(runs).where(runCompleted),
  );
  return planProgress(plan, new Set(data.map((run) => run.sessionKey)));
}
