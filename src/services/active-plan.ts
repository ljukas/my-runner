import { COMPRESSED_PLAN, NHS_PLAN, type PlanSession } from '@/domain/plan';

import { compressedPlanReachable } from './e2e';
import { settingsStore, useSetting } from './settings-store';

/** The compressed plan is a dev/E2E tool only — reachable in dev or E2E builds, never production. */
function planFor(compressed: boolean): PlanSession[] {
  return compressedPlanReachable() && compressed ? COMPRESSED_PLAN : NHS_PLAN;
}

/** Non-reactive twin for the composition root: crash recovery resolves its session outside React. */
export function activePlan(): PlanSession[] {
  return planFor(settingsStore.getSnapshot().useCompressedPlan);
}

export function useActivePlan(): PlanSession[] {
  return planFor(useSetting('useCompressedPlan'));
}
