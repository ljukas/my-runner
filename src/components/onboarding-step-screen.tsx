import { useRouter } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { Island } from '@/components/island';
import { Footer } from '@/components/ui/footer';
import { useTheme } from '@/hooks/use-theme';
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
  const colors = useTheme();

  // why: the strip is an overlay, not iOS's scroll-edge effect, so painting it unconditionally fades
  // the last line of a step whose content already fits — an affordance for scrolling that cannot
  // happen. Compared with a 1 pt slack for float rounding.
  const [overflows, setOverflows] = useState(false);
  const viewportH = useRef(0);
  const contentH = useRef(0);
  const syncOverflow = () => setOverflows(contentH.current > viewportH.current + 1);

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
        onLayout={(event) => {
          viewportH.current = event.nativeEvent.layout.height;
          syncOverflow();
        }}
        onContentSizeChange={(_, height) => {
          contentH.current = height;
          syncOverflow();
        }}
      >
        {children}

        {/* px-2 lands the footnote on the footer's px-8 inset from the content's px-6, so it keeps
            its alignment when it moves here. */}
        {footnoteScrolls && footnote ? <View className="px-2 pt-5">{footnote}</View> : null}
      </ScrollView>

      {/* why the negative margin: the footer is opaque and in layout, so scrolling content would
          otherwise end at a hard edge against it. Pulling this strip back over its own height costs
          no layout and no footer movement, and painting last puts it above the scroll content, which
          then fades into the background instead of being cut off. The stop is the background at zero
          alpha rather than `transparent`, which iOS fades through black. */}
      {overflows ? (
        <View
          pointerEvents="none"
          className="-mt-7 h-7"
          style={{
            experimental_backgroundImage: `linear-gradient(to bottom, ${colors.background}00, ${colors.background})`,
          }}
        />
      ) : null}

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
