import { useRouter } from 'expo-router';
import { useSyncExternalStore } from 'react';

import { getResumeGate, subscribeResumeGate } from '@/services/run-engine/resume-offer';

/** The Plan header's free-run entry: closed while a launch-time resume is looked for or decided. */
export function useFreeRunEntry() {
  const router = useRouter();
  const gate = useSyncExternalStore(subscribeResumeGate, getResumeGate);
  return { disabled: gate !== 'clear', open: () => router.push('/free-run') };
}
