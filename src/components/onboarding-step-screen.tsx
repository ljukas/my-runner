import { useRouter } from 'expo-router';
import { useRef, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Island } from '@/components/island';
import { completeAndAdvance } from '@/services/onboarding-store';
import type { OnboardingStepId } from '@/services/onboarding';

/**
 * Shared scaffold for onboarding steps, matching Apple's first-launch welcome
 * template: scrollable content, an optional footnote block, and the advance
 * CTA pinned to the bottom of the sheet. A step that must act before advancing
 * (a permission prompt) passes `onPrimaryPress` and then owns advancing;
 * `secondaryLabel` adds the optional second CTA under it.
 */
export function OnboardingStepScreen({
  stepId,
  buttonLabel,
  secondaryLabel,
  onPrimaryPress,
  onSecondaryPress,
  footnote,
  children,
}: {
  stepId: OnboardingStepId;
  buttonLabel: string;
  secondaryLabel?: string;
  onPrimaryPress?: (advance: () => void) => void | Promise<void>;
  onSecondaryPress?: () => void | Promise<void>;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const busy = useRef(false);

  // why the guard: an async action (a permission prompt) leaves both CTAs live until it settles,
  // and a second tap would prompt twice and advance twice.
  const press = (handler?: (advance: () => void) => void | Promise<void>) => () => {
    if (busy.current) return;
    busy.current = true;
    void Promise.resolve(
      handler
        ? handler(() => completeAndAdvance(router, stepId))
        : completeAndAdvance(router, stepId),
    )
      .catch((error) => console.warn('[onboarding] step action failed', error))
      .finally(() => {
        busy.current = false;
      });
  };

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
      <View className="gap-3 px-6 pt-2">
        <Island.Button fill label={buttonLabel} onPress={press(onPrimaryPress)} />
        {secondaryLabel ? (
          <Island.Button
            fill
            variant="secondary"
            label={secondaryLabel}
            onPress={press(onSecondaryPress)}
          />
        ) : null}
      </View>
    </View>
  );
}
