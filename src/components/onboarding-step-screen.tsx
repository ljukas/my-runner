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
      {/* Full-width ScrollView so the scroll indicator sits at the screen edge; the
          horizontal inset lives on the content and matches the CTA block's, so the
          footnote and the buttons share one edge. `flexGrow` + `mt-auto` settle the
          footnote against the buttons when the content is short — the relationship
          Apple's welcome template draws — yet let it flow, and scroll, at large
          Dynamic Type where pinning it would eat the screen.
          NOT a native `Stack.Toolbar`: a bottom toolbar sizes itself and exposes no
          height control (`StackToolbarViewProps` is children/hidden/background only),
          so it clips a block of a footnote plus two stacked full-width buttons. It
          fits a single CTA — see run-summary — but not this. */}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View className="flex-1 px-6 pt-10 pb-3">
          {children}
          {footnote ? <View className="mt-auto pt-8">{footnote}</View> : null}
        </View>
      </ScrollView>
      <View className="gap-3 px-6 pt-3">
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
