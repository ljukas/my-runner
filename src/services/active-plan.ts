import { COMPRESSED_PLAN, NHS_PLAN, type PlanSession } from '@/domain/plan';
import { useSetting } from './settings-store';

/** The compressed plan is a dev/E2E tool only — unreachable in release builds. */
export function useActivePlan(): PlanSession[] {
  const compressed = useSetting('useCompressedPlan');
  return __DEV__ && compressed ? COMPRESSED_PLAN : NHS_PLAN;
}
