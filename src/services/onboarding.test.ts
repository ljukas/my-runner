import { describe, expect, test } from 'bun:test';

import { ONBOARDING_STEPS, createOnboarding } from './onboarding';
import { fakeStorage } from './test-helpers';

describe('createOnboarding', () => {
  test('the welcome step is pending on first launch', () => {
    const onboarding = createOnboarding(fakeStorage());
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(['welcome-v1']);
  });

  test('completing the welcome step empties pending, idempotently', () => {
    const onboarding = createOnboarding(fakeStorage());
    onboarding.completeStep('welcome-v1');
    onboarding.completeStep('welcome-v1');
    expect(onboarding.pendingSteps()).toEqual([]);
  });

  test('completion persists across instances over the same storage', () => {
    const storage = fakeStorage();
    createOnboarding(storage).completeStep('welcome-v1');
    expect(createOnboarding(storage).pendingSteps()).toEqual([]);
  });

  test('reset makes every step pending again', () => {
    const onboarding = createOnboarding(fakeStorage());
    for (const step of ONBOARDING_STEPS) onboarding.completeStep(step.id);
    onboarding.reset();
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(ONBOARDING_STEPS.map((s) => s.id));
  });

  test('corrupted persisted JSON is treated as no steps completed', () => {
    const storage = fakeStorage();
    storage.setItemSync('onboarding.completedSteps', 'not-json{');
    const onboarding = createOnboarding(storage);
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(ONBOARDING_STEPS.map((s) => s.id));
  });
});
