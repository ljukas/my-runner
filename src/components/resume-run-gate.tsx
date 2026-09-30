import { useRouter, usePathname } from 'expo-router';
import { useEffect } from 'react';

import { onboarding } from '@/services/onboarding-store';
import { detectResumableRun, runEngine } from '@/services/run-engine';
import {
  beginResumeCheck,
  setResumeOffer,
  settleResumeCheck,
} from '@/services/run-engine/resume-offer';

/** Offers the run a crash or force-quit interrupted, at most once per launch. Detection reads the
 *  database, so it must sit behind the migrations gate. */
export function ResumeRunGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // A live in-process run already owns the engine: nothing to offer while it runs.
    if (runEngine.getSnapshot().status !== 'idle') return settleResumeCheck();
    // A pending onboarding step would strand the sheet under the onboarding modal — pathname re-runs
    // this once that modal closes.
    if (onboarding.pendingSteps().length > 0) return;
    // Module scope, so a StrictMode double-mount cannot offer the same run twice.
    if (!beginResumeCheck()) return;
    void detectResumableRun()
      .then((found) => {
        if (!found) return settleResumeCheck();
        setResumeOffer(found);
        router.push('/resume-run');
      })
      .catch(() => settleResumeCheck());
  }, [router, pathname]);

  return null;
}
