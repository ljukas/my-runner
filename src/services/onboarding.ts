import type { Href } from 'expo-router';

import { readJson, type StringStorage } from './storage';

export type OnboardingPlatform = 'ios' | 'android';

/**
 * Versioned first-launch steps (spec §13). A later release that needs a new
 * permission appends a step here; existing users then see only that step.
 * A step without `platforms` shows everywhere; the primers for capabilities
 * Android does not have yet name iOS only (ADR 0025).
 */
export const ONBOARDING_STEPS = [
  { id: 'welcome-v1', route: '/onboarding' },
  { id: 'audio-cues-v1', route: '/onboarding/audio-cues', platforms: ['ios'] },
  { id: 'location-primer-v1', route: '/onboarding/location-primer' },
  { id: 'health-primer-v1', route: '/onboarding/health', platforms: ['ios'] },
] as const satisfies readonly {
  id: string;
  route: Href;
  platforms?: readonly OnboardingPlatform[];
}[];

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id'];
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const STORAGE_KEY = 'onboarding.completedSteps';

function stepAppliesTo(step: OnboardingStep, platform: OnboardingPlatform): boolean {
  if (!('platforms' in step)) return true;
  const platforms: readonly OnboardingPlatform[] = step.platforms;
  return platforms.includes(platform);
}

export function createOnboarding(storage: StringStorage, platform: OnboardingPlatform) {
  const readCompleted = (): string[] => {
    // Corrupt storage reads as nothing completed — re-showing onboarding is benign.
    const parsed = readJson(storage, STORAGE_KEY);
    return Array.isArray(parsed) ? parsed : [];
  };

  return {
    pendingSteps(): OnboardingStep[] {
      const completed = readCompleted();
      return ONBOARDING_STEPS.filter(
        (step) => !completed.includes(step.id) && stepAppliesTo(step, platform),
      );
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
