import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Island } from '@/components/island';
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
    <View className="flex-1 bg-background" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
      {/* Full-width ScrollView so the scroll indicator sits at the screen edge;
          horizontal inset lives on the content. The footnote scrolls WITH the
          content (not pinned) so it can't dominate the screen at large Dynamic
          Type — only the CTA stays pinned. */}
      <ScrollView contentInsetAdjustmentBehavior="automatic">
        <View className="px-6 pt-10 pb-6">
          {children}
          {footnote ? <View className="pt-8">{footnote}</View> : null}
        </View>
      </ScrollView>
      <View className="px-6 pt-2">
        <Island.Button
          fill
          label={buttonLabel}
          onPress={() => completeAndAdvance(router, stepId)}
        />
      </View>
    </View>
  );
}
