import { Stack, useRouter } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
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
  const { width } = useWindowDimensions();
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

  // A bottom toolbar is ONE row: it sizes itself and exposes no height control
  // (`StackToolbarViewProps` is children/hidden/background only), so two stacked
  // full-width capsules overflow it. The secondary is therefore a native bar
  // button beside the primary rather than a capsule beneath it, and the primary
  // gives up room for it.
  const primaryWidth = secondaryLabel ? Math.round((width - 48) * 0.62) : width - 48;
  // The toolbar floats OVER the scroll view and reports no height, so the content
  // has to reserve its own clearance or the footnote slides underneath. Measured
  // rather than guessed, so it tracks Dynamic Type and the safe-area inset; the
  // constant covers the native bar's own band above the hosted view, which is not
  // measurable from RN.
  const [toolbarHeight, setToolbarHeight] = useState(0);

  return (
    <>
      {/* headerShown pinned to match the nested layout — a bare `Stack.Screen`
          re-asserts the default, and toggling the header on an in-flight modal drops
          its page-sheet chrome (verify after a cold relaunch, never a Fast Refresh). */}
      <Stack.Screen options={{ headerShown: false }}>
        <Stack.Toolbar placement="bottom">
          {/* hidesSharedBackground drops the toolbar's glass capsule so only the
              filled CTA reads as a button; it also strips the toolbar's own
              safe-area padding, hence the explicit inset. The width is explicit
              because an RN host in a toolbar has no intrinsic one. */}
          <Stack.Toolbar.View hidesSharedBackground>
            <View
              style={{ width: primaryWidth, paddingBottom: Math.max(insets.bottom, 8) }}
              onLayout={(e) => setToolbarHeight(e.nativeEvent.layout.height)}
            >
              <Island.Button fill label={buttonLabel} onPress={press(onPrimaryPress)} />
            </View>
          </Stack.Toolbar.View>
          {secondaryLabel ? (
            <Stack.Toolbar.Button onPress={press(onSecondaryPress)}>
              {secondaryLabel}
            </Stack.Toolbar.Button>
          ) : null}
        </Stack.Toolbar>
      </Stack.Screen>

      <View className="flex-1 bg-background">
        {/* Full-width ScrollView so the scroll indicator sits at the screen edge; the
            horizontal inset lives on the content and matches the toolbar CTA's, so the
            footnote and the buttons share one edge. `flexGrow` + `mt-auto` settle the
            footnote against the toolbar when the content is short — the relationship
            Apple's welcome template draws — yet let it flow, and scroll, at large
            Dynamic Type where pinning it would eat the screen. */}
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <View className="flex-1 px-6 pt-10" style={{ paddingBottom: toolbarHeight + 32 }}>
            {children}
            {footnote ? <View className="mt-auto pt-8">{footnote}</View> : null}
          </View>
        </ScrollView>
      </View>
    </>
  );
}
