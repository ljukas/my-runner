import { describe, expect, test } from 'bun:test';

import { ONBOARDING_STEPS, createOnboarding } from './onboarding';
import { fakeStorage } from './test-helpers';

describe('createOnboarding', () => {
  test('every versioned step is pending on first launch', () => {
    const onboarding = createOnboarding(fakeStorage());
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual([
      'welcome-v1',
      'audio-cues-v1',
      'location-primer-v1',
      'health-primer-v1',
    ]);
  });

  test('a user who already finished welcome sees only the newer steps', () => {
    const onboarding = createOnboarding(fakeStorage());
    onboarding.completeStep('welcome-v1');
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual([
      'audio-cues-v1',
      'location-primer-v1',
      'health-primer-v1',
    ]);
  });

  test('an upgrading user sees only the appended health primer', () => {
    const onboarding = createOnboarding(fakeStorage());
    onboarding.completeStep('welcome-v1');
    onboarding.completeStep('audio-cues-v1');
    onboarding.completeStep('location-primer-v1');
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(['health-primer-v1']);
  });

  test('completing every step empties pending idempotently and persists', () => {
    const storage = fakeStorage();
    const onboarding = createOnboarding(storage);
    for (const step of ONBOARDING_STEPS) onboarding.completeStep(step.id);
    onboarding.completeStep('location-primer-v1'); // idempotent
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
