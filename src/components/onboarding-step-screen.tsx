import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedView } from '@/components/themed-view';
import { completeAndAdvance } from '@/services/onboarding-store';
import type { OnboardingStepId } from '@/services/onboarding';

/** Shared scaffold for onboarding steps: copy block on top, advance CTA pinned to the bottom. */
export function OnboardingStepScreen({
  stepId,
  buttonLabel,
  buttonTestID,
  children,
}: {
  stepId: OnboardingStepId;
  buttonLabel: string;
  buttonTestID: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <ThemedView className="flex-1 justify-between px-6 pb-16 pt-24">
      <View className="gap-4">{children}</View>
      <PrimaryButton
        testID={buttonTestID}
        label={buttonLabel}
        onPress={() => completeAndAdvance(router, stepId)}
      />
    </ThemedView>
  );
}
