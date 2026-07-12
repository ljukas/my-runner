import type { StringStorage } from './storage';

/**
 * Versioned first-launch steps (spec §13). A later release that needs a new
 * permission appends a step here; existing users then see only that step.
 */
export const ONBOARDING_STEPS = [
  { id: 'welcome-v1', route: '/onboarding' },
  { id: 'how-it-works-v1', route: '/onboarding/how-it-works' },
  { id: 'health-note-v1', route: '/onboarding/health-note' },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id'];
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const STORAGE_KEY = 'onboarding.completedSteps';

export function createOnboarding(storage: StringStorage) {
  const readCompleted = (): string[] => {
    const raw = storage.getItemSync(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return []; // corrupted storage must never crash startup — re-showing onboarding is benign
    }
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
  };
}
