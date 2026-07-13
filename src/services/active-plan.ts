import { COMPRESSED_PLAN, NHS_PLAN, type PlanSession } from '@/domain/plan';

import { compressedPlanReachable } from './e2e';
import { useSetting } from './settings-store';

/** The compressed plan is a dev/E2E tool only — reachable in dev or E2E builds, never production. */
export function useActivePlan(): PlanSession[] {
  const compressed = useSetting('useCompressedPlan');
  return compressedPlanReachable() && compressed ? COMPRESSED_PLAN : NHS_PLAN;
}
