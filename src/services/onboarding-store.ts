import { type ImperativeRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';

import { createOnboarding, type OnboardingStepId } from './onboarding';

export const onboarding = createOnboarding(Storage);

/**
 * Mark this step done, then go to the next pending step or leave onboarding.
 *
 * Uses `replace` (not `push`) between steps so the nested onboarding Stack
 * (`src/app/onboarding/_layout.tsx`) never accumulates history — otherwise
 * `dismissAll`/`back` on the last step would only pop back to an earlier
 * onboarding screen instead of leaving the flow, since those actions target
 * the closest stack (the nested one), not the root Stack the flow is pushed
 * onto. With a single-entry nested stack, `back()` on the last step has
 * nothing left to pop locally, so it bubbles to the root Stack and dismisses
 * the whole onboarding group, revealing the tabs underneath.
 */
export function completeAndAdvance(router: ImperativeRouter, id: OnboardingStepId): void {
  onboarding.completeStep(id);
  const next = onboarding.pendingSteps()[0];
  if (next) {
    router.replace(next.route);
  } else {
    router.back();
  }
}
