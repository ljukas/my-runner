import type { Href } from 'expo-router';

import { readJson, type StringStorage } from './storage';

export type OnboardingPlatform = 'ios' | 'android';

export type OnboardingStepDefinition = {
  id: string;
  route: Href;
  platforms?: readonly OnboardingPlatform[];
};

/**
 * Versioned first-launch steps (spec §13). A later release that needs a new
 * permission appends a step here; existing users then see only that step.
 * A step without `platforms` shows everywhere; a primer for a capability one
 * platform lacks names the other (ADR 0025 §7). Every capability has shipped on
 * both platforms since Android stage 5, so no current step needs it.
 */
export const ONBOARDING_STEPS = [
  { id: 'welcome-v1', route: '/onboarding' },
  { id: 'audio-cues-v1', route: '/onboarding/audio-cues' },
  { id: 'location-primer-v1', route: '/onboarding/location-primer' },
  { id: 'health-primer-v1', route: '/onboarding/health' },
] as const satisfies readonly OnboardingStepDefinition[];

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id'];
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const STORAGE_KEY = 'onboarding.completedSteps';

function stepAppliesTo(step: OnboardingStepDefinition, platform: OnboardingPlatform): boolean {
  return step.platforms === undefined || step.platforms.includes(platform);
}

export function createOnboarding(
  storage: StringStorage,
  platform: OnboardingPlatform,
  steps: readonly OnboardingStepDefinition[] = ONBOARDING_STEPS,
) {
  const readCompleted = (): string[] => {
    // Corrupt storage reads as nothing completed — re-showing onboarding is benign.
    const parsed = readJson(storage, STORAGE_KEY);
    return Array.isArray(parsed) ? parsed : [];
  };

  return {
    pendingSteps(): OnboardingStepDefinition[] {
      const completed = readCompleted();
      return steps.filter((step) => !completed.includes(step.id) && stepAppliesTo(step, platform));
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
