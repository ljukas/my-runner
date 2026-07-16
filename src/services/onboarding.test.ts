import { describe, expect, test } from 'bun:test';

import { ONBOARDING_STEPS, createOnboarding } from './onboarding';
import { fakeStorage } from './test-helpers';

describe('createOnboarding', () => {
  test('the welcome and audio-cues steps are pending on first launch', () => {
    const onboarding = createOnboarding(fakeStorage());
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(['welcome-v1', 'audio-cues-v1']);
  });

  test('a user who already finished welcome sees only the newer audio-cues step', () => {
    const onboarding = createOnboarding(fakeStorage());
    onboarding.completeStep('welcome-v1');
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(['audio-cues-v1']);
  });

  test('completing every step empties pending idempotently and persists', () => {
    const storage = fakeStorage();
    const onboarding = createOnboarding(storage);
    onboarding.completeStep('welcome-v1');
    onboarding.completeStep('audio-cues-v1');
    onboarding.completeStep('audio-cues-v1'); // idempotent
    expect(onboarding.pendingSteps()).toEqual([]);
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
