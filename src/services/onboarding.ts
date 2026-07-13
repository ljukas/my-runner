import type { Href } from 'expo-router';

import { readJson, type StringStorage } from './storage';

/**
 * Versioned first-launch steps (spec §13). A later release that needs a new
 * permission appends a step here; existing users then see only that step.
 */
export const ONBOARDING_STEPS = [
  { id: 'welcome-v1', route: '/onboarding' },
  { id: 'how-it-works-v1', route: '/onboarding/how-it-works' },
  { id: 'health-note-v1', route: '/onboarding/health-note' },
] as const satisfies readonly { id: string; route: Href }[];

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id'];
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const STORAGE_KEY = 'onboarding.completedSteps';

export function createOnboarding(storage: StringStorage) {
  const readCompleted = (): string[] => {
    // Corrupt storage reads as nothing completed — re-showing onboarding is benign.
    const parsed = readJson(storage, STORAGE_KEY);
    return Array.isArray(parsed) ? parsed : [];
  };

  return {
    pendingSteps(): OnboardingStep[] {
      const completed = readCompleted();
      return ONBOARDING_STEPS.filter((step) => !completed.includes(step.id));
    },
    completeStep(id: OnboardingStepId): void {
      const completed = readCompleted();
      if (!completed.includes(id)) {
        storage.setItemSync(STORAGE_KEY, JSON.stringify([...completed, id]));
      }
    },
    reset(): void {
      storage.setItemSync(STORAGE_KEY, JSON.stringify([]));
    },
  };
}
