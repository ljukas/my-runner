import { Button, HStack, Image, ProgressView, ScrollView, Spacer, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  disabled as disabledModifier,
  font,
  frame,
  padding,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { AndroidSymbol, SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';

import { Island } from '@/components/island';
import { useTheme } from '@/hooks/use-theme';

const CORNER_RADIUS = 22;

function RunModeCardList({ children }: { children: ReactNode }) {
  const colors = useTheme();
  return (
    <ScrollView modifiers={[background(colors.backgroundGrouped)]}>
      <VStack
        alignment="leading"
        spacing={16}
        modifiers={[padding({ horizontal: 16, vertical: 8 }), frame({ maxWidth: 10000 })]}
      >
        {children}
      </VStack>
    </ScrollView>
  );
}

/**
 * One way to run, as a Health-style grouped card: the header opens the mode, `action` is a
 * shortcut past it. The two are siblings, never nested, so a tap on one never fires the other.
 */
function RunModeCardRoot({
  title,
  detail,
  symbol,
  featured = false,
  progress,
  hint,
  disabled = false,
  onPress,
  action,
}: {
  title: string;
  detail: string;
  symbol: { ios: SFSymbol; android: AndroidSymbol };
  featured?: boolean;
  /** 0–1. */
  progress?: number;
  hint?: string;
  disabled?: boolean;
  onPress: () => void;
  action?: { label: string; disabled?: boolean; onPress: () => void };
}) {
  const colors = useTheme();
  return (
    <VStack
      alignment="leading"
      spacing={14}
      modifiers={[
        padding({ all: 16 }),
        frame({ maxWidth: 10000, alignment: 'leading' }),
        background(
          colors.backgroundCard,
          shapes.roundedRectangle({
            cornerRadius: CORNER_RADIUS,
            roundedCornerStyle: 'continuous',
          }),
        ),
      ]}
    >
      <Button
        onPress={onPress}
        modifiers={[
          buttonStyle('plain'),
          disabledModifier(disabled),
          accessibilityLabel(`${title}, ${detail}`),
          ...(hint ? [accessibilityHint(hint)] : []),
        ]}
      >
        <HStack spacing={14} modifiers={[contentShape(shapes.rectangle())]}>
          <Image
            systemName={symbol.ios}
            color={featured ? colors.primary : colors.textSecondary}
            modifiers={[font({ textStyle: 'title2' }), frame({ width: 34 })]}
          />
          <VStack alignment="leading" spacing={2}>
            <Island.Text modifiers={[font({ textStyle: 'headline' })]}>{title}</Island.Text>
            <Island.Text tone="secondary" modifiers={[font({ textStyle: 'subheadline' })]}>
              {detail}
            </Island.Text>
          </VStack>
          <Spacer />
          <Image
            systemName="chevron.right"
            color={colors.textSecondary}
            modifiers={[font({ textStyle: 'footnote', weight: 'semibold' })]}
          />
        </HStack>
      </Button>
      {progress === undefined ? null : (
        <ProgressView value={progress} modifiers={[tint(colors.primary)]} />
      )}
      {action ? (
        <Island.Button
          inline
          fill
          label={action.label}
          disabled={action.disabled}
          onPress={action.onPress}
        />
      ) : null}
    </VStack>
  );
}

export const RunModeCard = Object.assign(RunModeCardRoot, { List: RunModeCardList });
