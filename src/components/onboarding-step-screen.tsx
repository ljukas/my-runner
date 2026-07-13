import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IslandButton } from '@/components/island/button';
import { ThemedView } from '@/components/themed-view';
import { completeAndAdvance } from '@/services/onboarding-store';
import type { OnboardingStepId } from '@/services/onboarding';

/**
 * Shared scaffold for onboarding steps, matching Apple's first-launch welcome
 * template: scrollable content, an optional footnote block, and the advance
 * CTA pinned to the bottom of the sheet.
 */
export function OnboardingStepScreen({
  stepId,
  buttonLabel,
  footnote,
  children,
}: {
  stepId: OnboardingStepId;
  buttonLabel: string;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <ThemedView className="flex-1 px-6" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false}>
        <View className="pt-10 pb-6">{children}</View>
      </ScrollView>
      <View className="gap-5 pt-2">
        {footnote}
        <IslandButton label={buttonLabel} onPress={() => completeAndAdvance(router, stepId)} />
      </View>
    </ThemedView>
  );
}
