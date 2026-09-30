import { sessionTitle } from './format';
import { nextSessionKey, type PlanSession } from './plan';

export interface WeekProgress {
  week: number;
  sessions: PlanSession[];
  done: number;
}

export interface PlanProgress {
  weeks: WeekProgress[];
  completed: ReadonlySet<string>;
  done: number;
  total: number;
  next: PlanSession | null;
}

export function planProgress(
  plan: PlanSession[],
  completedKeys: ReadonlySet<string>,
): PlanProgress {
  const weeks = new Map<number, WeekProgress>();
  let done = 0;
  for (const session of plan) {
    const week = weeks.get(session.week) ?? { week: session.week, sessions: [], done: 0 };
    weeks.set(session.week, week);
    week.sessions.push(session);
    if (completedKeys.has(session.key)) {
      week.done += 1;
      done += 1;
    }
  }
  const nextKey = nextSessionKey(plan, completedKeys);
  return {
    weeks: [...weeks.values()],
    completed: completedKeys,
    done,
    total: plan.length,
    next: plan.find((s) => s.key === nextKey) ?? null,
  };
}

export function weekTitle(week: WeekProgress): string {
  return `Week ${week.week} · ${week.done}/${week.sessions.length}`;
}

export function planCardDetail(progress: PlanProgress): string {
  if (progress.next === null) return `Plan complete · all ${progress.total} runs done`;
  if (progress.done === 0) return `${progress.weeks.length} weeks · ${progress.total} runs`;
  return `${progress.done} of ${progress.total} runs done`;
}

export function nextRunLabel(progress: PlanProgress): string | null {
  return progress.next ? `Up next: ${sessionTitle(progress.next.key)}` : null;
}
