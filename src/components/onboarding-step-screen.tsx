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
      {/* Full-width ScrollView so the scroll indicator sits at the screen edge; the
          horizontal inset lives on the content and matches the Footer's, so the copy
          lines up whether it is scrolling or pinned. */}
      <ScrollView contentInsetAdjustmentBehavior="automatic">
        <View className="px-6 pt-10 pb-3">{children}</View>
      </ScrollView>
      {/* Footnote and CTAs are one pinned block on a shared width, the relationship
          Apple's welcome template draws. Pinned rather than scrolled, so at very large
          Dynamic Type it takes screen from the content above rather than sliding out
          of reach beneath the CTA. */}
      <Footer>
        {footnote}
        {/* One island either way: a lone CTA is a standalone `Island.Button` (as the
            session sheet does), and a pair goes inside a single `Island.View` so the
            gap between them is SwiftUI spacing rather than RN spacing between two
            separate Hosts. */}
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
