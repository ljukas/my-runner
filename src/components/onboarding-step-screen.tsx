import { useRouter } from 'expo-router';
import { useRef, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { Island } from '@/components/island';
import { Footer } from '@/components/ui/footer';
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
    <View className="flex-1 bg-background">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="px-6 pb-3">
        {children}
      </ScrollView>

      <Footer className="absolute right-0 bottom-0 left-0">
        {footnote}

        {secondaryLabel ? (
          <Island.View count={2}>
            <Island.Button inline fill label={buttonLabel} onPress={press(onPrimaryPress)} />
            <Island.Button
              inline
              fill
              variant="secondary"
              label={secondaryLabel}
              onPress={press(onSecondaryPress)}
            />
          </Island.View>
        ) : (
          <Island.Button fill label={buttonLabel} onPress={press(onPrimaryPress)} />
        )}
      </Footer>
    </View>
  );
}
