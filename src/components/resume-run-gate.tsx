import { useRouter, usePathname } from 'expo-router';
import { useEffect } from 'react';

import { onboarding } from '@/services/onboarding-store';
import { detectResumableRun, runEngine } from '@/services/run-engine';
import { setResumeOffer } from '@/services/run-engine/resume-offer';

// Module scope, so a StrictMode double-mount cannot offer the same run twice.
let offered = false;

/** Offers the run a crash or force-quit interrupted, at most once per launch. Detection reads the
 *  database, so it must sit behind the migrations gate. */
export function ResumeRunGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (offered) return;
    // A live in-process run already owns the engine, and a pending onboarding step would strand the
    // sheet under the onboarding modal — pathname re-runs this once that modal closes.
    if (runEngine.getSnapshot().status !== 'idle') return;
    if (onboarding.pendingSteps().length > 0) return;
    offered = true;
    void detectResumableRun().then((found) => {
      if (!found) return;
      setResumeOffer(found);
      router.push('/resume-run');
    });
  }, [router, pathname]);

  return null;
}
