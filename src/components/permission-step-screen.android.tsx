import { Column, Row, Spacer, useMaterialColors } from '@expo/ui/jetpack-compose';
import {
  background,
  clip,
  fillMaxSize,
  fillMaxWidth,
  height,
  padding,
  Shapes,
  verticalScroll,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import { useRouter } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import { BackHandler, useWindowDimensions, View } from 'react-native';

import { ComposeSymbol } from '@/components/compose-symbol';
import { Island } from '@/components/island';
import { OnboardingButton } from '@/components/onboarding-button';
import { OnboardingHero } from '@/components/onboarding-hero';
import { completeAndAdvance } from '@/services/onboarding-store';
import type { OnboardingStepId } from '@/services/onboarding';

export type PermissionStepRow = { symbol: SymbolViewProps['name']; text: string };

const COMPACT_FONT_SCALE = 1.5;
const ROW_SYMBOL_SIZE = 22;
// Matches FeatureRow's cap: symbols follow the text up to a point, then stop growing.
const MAX_SYMBOL_SCALE = 1.6;
const OUTER_CORNER = 20;
const INNER_CORNER = 6;

function rowShape(index: number, count: number) {
  const top = index === 0 ? OUTER_CORNER : INNER_CORNER;
  const bottom = index === count - 1 ? OUTER_CORNER : INNER_CORNER;
  return Shapes.RoundedCorner({
    topStart: top,
    topEnd: top,
    bottomStart: bottom,
    bottomEnd: bottom,
  });
}

/**
 * The Android permission-primer layout (carousel spec §5, "B4"), shared by every primer step.
 * A step that must act before advancing passes `onPrimaryPress` and then owns advancing; the
 * secondary action, when labelled, advances unless `onSecondaryPress` says otherwise.
 */
export function PermissionStepScreen({
  stepId,
  symbol,
  headline,
  body,
  rows,
  disclosure,
  primaryLabel,
  secondaryLabel,
  onPrimaryPress,
  onSecondaryPress,
}: {
  stepId: OnboardingStepId;
  symbol: SymbolViewProps['name'];
  headline: string;
  body: string;
  rows: readonly PermissionStepRow[];
  disclosure: string;
  primaryLabel: string;
  secondaryLabel?: string;
  onPrimaryPress?: (advance: () => void) => void | Promise<void>;
  onSecondaryPress?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const colors = useMaterialColors();
  const { fontScale } = useWindowDimensions();
  const busy = useRef(false);

  // why: the step is mandatory to see, and the step before it was replaced rather than pushed, so
  // back has nothing to return to — letting it through would pop the whole onboarding group.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, []);

  // why the guard: an async action (a permission prompt) leaves both buttons live until it
  // settles, and a second tap would prompt twice and advance twice.
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

  // why: side by side, a long primary label clips at a large font scale; stacked it can wrap.
  const compact = fontScale >= COMPACT_FONT_SCALE;
  const primary = (fill: boolean) => (
    <OnboardingButton fill={fill} label={primaryLabel} onPress={press(onPrimaryPress)} />
  );
  const secondary = secondaryLabel ? (
    <OnboardingButton variant="text" label={secondaryLabel} onPress={press(onSecondaryPress)} />
  ) : null;
  const rowSymbolSize = Math.round(ROW_SYMBOL_SIZE * Math.min(fontScale, MAX_SYMBOL_SCALE));

  return (
    // why offset-6: a button ends the screen, so it clears the gesture bar by 24 dp, not by nothing.
    <View className="flex-1 bg-background pt-safe pb-safe-offset-6">
      <Island>
        <Column modifiers={[fillMaxSize()]}>
          <Column
            horizontalAlignment="center"
            modifiers={[fillMaxWidth(), weight(1), verticalScroll(), padding(24, 32, 24, 24)]}
          >
            <OnboardingHero shape="scallop" symbol={symbol} side={compact ? 120 : 180} />
            <Spacer modifiers={[height(32)]} />
            <Island.Text
              style={{ typography: 'headlineMedium', fontWeight: '500', textAlign: 'center' }}
            >
              {headline}
            </Island.Text>
            <Spacer modifiers={[height(12)]} />
            <Island.Text
              tone="secondary"
              style={{ typography: 'bodyLarge', textAlign: 'center' }}
              modifiers={[padding(11, 0, 11, 0)]}
            >
              {body}
            </Island.Text>
            <Spacer modifiers={[height(28)]} />
            <Column verticalArrangement={{ spacedBy: 2 }} modifiers={[fillMaxWidth()]}>
              {rows.map((row, index) => (
                <Row
                  key={row.text}
                  verticalAlignment="center"
                  horizontalArrangement={{ spacedBy: 12 }}
                  modifiers={[
                    fillMaxWidth(),
                    clip(rowShape(index, rows.length)),
                    background(colors.surfaceContainer),
                    padding(16, 12, 16, 12),
                  ]}
                >
                  <ComposeSymbol name={row.symbol} size={rowSymbolSize} tint={colors.primary} />
                  <Island.Text style={{ typography: 'bodyMedium' }} modifiers={[weight(1)]}>
                    {row.text}
                  </Island.Text>
                </Row>
              ))}
            </Column>
            <Spacer modifiers={[height(20)]} />
            <Island.Text tone="secondary" style={{ typography: 'bodySmall', textAlign: 'center' }}>
              {disclosure}
            </Island.Text>
          </Column>

          {compact ? (
            <Column
              horizontalAlignment="center"
              verticalArrangement={{ spacedBy: 8 }}
              modifiers={[fillMaxWidth(), padding(24, 16, 24, 0)]}
            >
              {primary(true)}
              {secondary}
            </Column>
          ) : (
            <Row
              modifiers={[fillMaxWidth(), padding(24, 16, 24, 0)]}
              horizontalArrangement={secondaryLabel ? 'spaceBetween' : 'end'}
              verticalAlignment="center"
            >
              {secondary}
              {primary(false)}
            </Row>
          )}
        </Column>
      </Island>
    </View>
  );
}
