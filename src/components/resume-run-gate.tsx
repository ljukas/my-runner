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
    // A live run owns the engine, so there is nothing to offer — unless this launch's check is the one
    // running it (detection abandons a stale run), which settles the gate itself.
    if (runEngine.getSnapshot().status !== 'idle') {
      if (beginResumeCheck()) settleResumeCheck();
      return;
    }
    // A pending onboarding step would strand the sheet under the onboarding modal — pathname re-runs
    // this once that modal closes.
    if (onboarding.pendingSteps().length > 0) return;
    // At most one check per launch: every later pathname change finds it begun.
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
