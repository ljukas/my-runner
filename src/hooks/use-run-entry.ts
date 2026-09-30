import { useRouter } from 'expo-router';
import { useSyncExternalStore } from 'react';

import { getResumeGate, subscribeResumeGate } from '@/services/run-engine/resume-offer';

/**
 * The Run tab's ways in. `disabled` closes every start (a session or a free run) while a launch-time
 * resume is looked for or decided; opening the week list only browses, so it stays open.
 */
export function useRunEntry() {
  const router = useRouter();
  const gate = useSyncExternalStore(subscribeResumeGate, getResumeGate);
  return {
    disabled: gate !== 'clear',
    openPlan: () => router.push('/plan'),
    openSession: (key: string) => router.push(`/session/${key}`),
    openFreeRun: () => router.push('/free-run'),
  };
}
