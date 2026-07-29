import { useRouter } from 'expo-router';
import { useRef, type ReactNode } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { Island } from '@/components/island';
import { Footer } from '@/components/ui/footer';
import { completeAndAdvance } from '@/services/onboarding-store';
import type { OnboardingStepId } from '@/services/onboarding';

// why 1.5: iOS's standard text ramp tops out near 1.35x and its accessibility sizes start near
// 1.64x, so this splits them. At accessibility sizes the footnote alone can outgrow the screen, and
// as a flex sibling that pushes the CTA out of reach — so past this it scrolls with the content and
// only the CTA keeps its pinned slot.
const FOOTNOTE_SCROLLS_ABOVE_FONT_SCALE = 1.5;

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
  const { fontScale } = useWindowDimensions();
  const footnoteScrolls = fontScale >= FOOTNOTE_SCROLLS_ABOVE_FONT_SCALE;

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
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="px-6 pb-3"
      >
        {children}

        {/* px-2 lands the footnote on the footer's px-8 inset from the content's px-6, so it keeps
            its alignment when it moves here. */}
        {footnoteScrolls && footnote ? <View className="px-2 pt-5">{footnote}</View> : null}
      </ScrollView>

      <Footer>
        {footnoteScrolls ? null : footnote}

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
