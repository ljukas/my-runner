import {
  AnimatedVisibility,
  Box,
  Button,
  EnterTransition,
  ExitTransition,
  FilledTonalButton,
  Row,
  Text,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  animateContentSize,
  background,
  clip,
  defaultMinSize,
  fillMaxWidth,
  Shapes,
  snap,
  tween,
} from '@expo/ui/jetpack-compose/modifiers';
import type { SymbolViewProps } from 'expo-symbols';

import { ComposeSymbol } from '@/components/compose-symbol';

// Matches Island.Button's CTA height, as a minimum so a label that wraps at a large font scale
// grows the button instead of clipping.
const CTA_HEIGHT = 52;
const TRAILING_SYMBOL_SIZE = 20;

/**
 * The onboarding footer's pill buttons (carousel spec §3.1, §5.1), for a Compose tree. Kept out
 * of `Island.Button`: these styles are Android-only, and island pairs share their props.
 */
export function OnboardingButton({
  variant = 'filled',
  label,
  onPress,
  fill = false,
  trailingSymbol,
}: {
  variant?: 'filled' | 'tonal' | 'text';
  label: string;
  onPress: () => void;
  fill?: boolean;
  trailingSymbol?: SymbolViewProps['name'];
}) {
  const colors = useMaterialColors();
  const text = (
    <Text
      style={{
        typography: 'labelLarge',
        ...(variant === 'text' ? null : { fontSize: 16 }),
        textAlign: 'center',
      }}
    >
      {label}
    </Text>
  );

  if (variant === 'text') return <TextButton onClick={onPress}>{text}</TextButton>;

  const shared = {
    onClick: onPress,
    modifiers: [...(fill ? [fillMaxWidth()] : []), defaultMinSize({ minHeight: CTA_HEIGHT })],
    contentPadding: { start: 28, end: trailingSymbol ? 20 : 28 },
  };
  const content = trailingSymbol ? (
    <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 8 }}>
      {text}
      <ComposeSymbol
        name={trailingSymbol}
        size={TRAILING_SYMBOL_SIZE}
        tint={variant === 'tonal' ? colors.onSecondaryContainer : colors.onPrimary}
      />
    </Row>
  ) : (
    text
  );

  return variant === 'tonal' ? (
    <FilledTonalButton {...shared}>{content}</FilledTonalButton>
  ) : (
    <Button {...shared}>{content}</Button>
  );
}

const MORPH_MS = 300;
const TRANSPARENT = '#00000000';
const PILL = Shapes.RoundedCorner(CTA_HEIGHT / 2);
// Fade only: the labels share a Box, so the pill's width change comes from animateContentSize and
// neither label is clipped while it resizes.
const LABEL_IN = EnterTransition.fadeIn();
const LABEL_OUT = ExitTransition.fadeOut();

/**
 * The carousel's advance button: tonal "next" that morphs into the filled finish button with a
 * trailing arrow when `finish` turns true — colour, width and label animate in one button rather
 * than one button being swapped for another. `reduceMotion` makes the change instant.
 */
export function OnboardingAdvanceButton({
  finish,
  nextLabel,
  finishLabel,
  onPress,
  reduceMotion,
}: {
  finish: boolean;
  nextLabel: string;
  finishLabel: string;
  onPress: () => void;
  reduceMotion: boolean;
}) {
  const colors = useMaterialColors();
  const labelStyle = { typography: 'labelLarge', fontSize: 16 } as const;
  const next = (
    <Text color={colors.onSecondaryContainer} style={labelStyle}>
      {nextLabel}
    </Text>
  );
  const done = (
    <Row verticalAlignment="center" horizontalArrangement={{ spacedBy: 8 }}>
      <Text color={colors.onPrimary} style={labelStyle}>
        {finishLabel}
      </Text>
      <ComposeSymbol
        name={{ ios: 'arrow.right', android: 'arrow_forward' }}
        size={TRAILING_SYMBOL_SIZE}
        tint={colors.onPrimary}
      />
    </Row>
  );

  return (
    <Button
      onClick={onPress}
      // why transparent: the container colour is painted by the animated background below; M3
      // Button's own container colour switches without a transition.
      colors={{ containerColor: TRANSPARENT }}
      contentPadding={{ start: 28, end: finish ? 20 : 28 }}
      modifiers={[
        defaultMinSize({ minHeight: CTA_HEIGHT }),
        clip(PILL),
        background(finish ? colors.primary : colors.secondaryContainer, {
          animationSpec: reduceMotion ? snap() : tween({ durationMillis: MORPH_MS }),
        }),
        ...(reduceMotion ? [] : [animateContentSize()]),
      ]}
    >
      {reduceMotion ? (
        finish ? (
          done
        ) : (
          next
        )
      ) : (
        <Box contentAlignment="center">
          <AnimatedVisibility
            visible={!finish}
            enterTransition={LABEL_IN}
            exitTransition={LABEL_OUT}
          >
            {next}
          </AnimatedVisibility>
          <AnimatedVisibility
            visible={finish}
            enterTransition={LABEL_IN}
            exitTransition={LABEL_OUT}
          >
            {done}
          </AnimatedVisibility>
        </Box>
      )}
    </Button>
  );
}
