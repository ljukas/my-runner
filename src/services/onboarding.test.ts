import { describe, expect, test } from 'bun:test';

import { ONBOARDING_STEPS, createOnboarding } from './onboarding';
import { fakeStorage } from './test-helpers';

describe('createOnboarding', () => {
  test('all steps pending on first launch, in declared order', () => {
    const onboarding = createOnboarding(fakeStorage());
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(ONBOARDING_STEPS.map((s) => s.id));
  });

  test('completing steps removes them from pending, idempotently', () => {
    const onboarding = createOnboarding(fakeStorage());
    onboarding.completeStep('welcome-v1');
    onboarding.completeStep('welcome-v1');
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual([
      'how-it-works-v1',
      'health-note-v1',
    ]);
  });

  test('versioned resume: a partially-complete user sees only pending steps', () => {
    const storage = fakeStorage();
    createOnboarding(storage).completeStep('welcome-v1');
    // fresh instance over the same storage — e.g. an app update adding a step
    const later = createOnboarding(storage);
    expect(later.pendingSteps()[0].id).toBe('how-it-works-v1');
  });

  test('nothing pending once all steps are complete', () => {
    const onboarding = createOnboarding(fakeStorage());
    for (const step of ONBOARDING_STEPS) onboarding.completeStep(step.id);
    expect(onboarding.pendingSteps()).toEqual([]);
  });

  test('corrupted persisted JSON is treated as no steps completed', () => {
    const storage = fakeStorage();
    storage.setItemSync('onboarding.completedSteps', 'not-json{');
    const onboarding = createOnboarding(storage);
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(ONBOARDING_STEPS.map((s) => s.id));
  });
});
