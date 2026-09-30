import { useRouter } from 'expo-router';
import { useRef } from 'react';

import type { RunPlan } from '@/domain/free-run';
import { locationTracker } from '@/services/location-tracker';
import { runEngine } from '@/services/run-engine';

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
    // The engine's start() no-ops unless idle, so reset any prior finished run
    // here (its state lingers harmlessly until now — no screen reads it between
    // runs). This is why the summary no longer needs to reset the engine when it's dismissed.
    runEngine.reset();
    runEngine.start(plan);
    // Replace, not push: the run screen is a full-screen modal, so the start sheet
    // must leave the stack — otherwise the lingering formSheet bleeds into
    // the accessibility tree behind the run/summary modals and occludes their
    // controls (e.g. the summary's toolbar "Close").
    router.replace('/run');
  };
}
