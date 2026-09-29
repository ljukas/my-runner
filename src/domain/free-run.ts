/** A free run's identity and limits (ADR 0026 §1, §2, §6). Pure. */
import type { FixPolicy } from './geo';
import type { PlanSession } from './plan';
import type { PausedInterval } from './run-altitude';
import { pausePolicy } from './run-motion';

/** `runs.session_key` of a free run; no plan day can claim it (ADR 0023). */
export const FREE_RUN_KEY = 'free-run';

export type RunPlan =
  { mode: 'scripted'; session: PlanSession } | { mode: 'open'; key: typeof FREE_RUN_KEY };

/** Owner decisions, 2026-09-29 (spec §2). */
export const OPEN_LIMITS = {
  minActiveS: 60,
  stoppedLimitS: 30 * 60,
  capActiveS: 4 * 3600,
  resumeWindowMs: 4 * 3600 * 1000,
} as const;

export function isFreeRun(sessionKey: string): boolean {
  return sessionKey === FREE_RUN_KEY;
}

export function keyOf(plan: RunPlan): string {
  return plan.mode === 'scripted' ? plan.session.key : plan.key;
}

/** How a stored run's points are re-folded: a free run by its pause rule, a plan run as ever. */
export function runPolicy(
  sessionKey: string,
  paused: readonly PausedInterval[],
): FixPolicy | undefined {
  return isFreeRun(sessionKey) ? pausePolicy(paused) : undefined;
}
