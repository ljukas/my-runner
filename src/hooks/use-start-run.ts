import { useRouter } from 'expo-router';
import { useRef } from 'react';

import type { RunPlan } from '@/domain/free-run';
import { locationTracker } from '@/services/location-tracker';
import { runEngine } from '@/services/run-engine';
import { runNotices } from '@/services/run-notice/store';

/** A start sheet's one action: ask for location if never asked, start the run, open the run screen. */
export function useStartRun(): (plan: RunPlan) => Promise<void> {
  const router = useRouter();
  const starting = useRef(false);

  return async (plan) => {
    // The handler is async, so a second tap could start the run twice.
    if (starting.current) return;
    starting.current = true;
    try {
      // The just-in-time ask, reached only when the primer was skipped — the prompt is never cold
      // (ADR 0008 §2). Denial still starts the run: timer-only (§5).
      if ((await locationTracker.getPermissionStatus()) === 'undetermined') {
        await locationTracker.requestPermission();
      }
    } catch (error) {
      console.warn('[start] location ask failed', error);
    }
    runNotices.dismiss();
    // why reset: start() no-ops unless idle, and the last run's finished state lingers until here
    runEngine.reset();
    runEngine.start(plan);
    // Replace, not push: a start sheet left under the run modal occludes its controls for VoiceOver
    // and Maestro (e.g. the summary's "Close").
    router.replace('/run');
  };
}
