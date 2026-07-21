import { Button, Text } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, font, frame, padding, tint } from '@expo/ui/swift-ui/modifiers';
import { PixelRatio, Platform } from 'react-native';

import { Button as PillButton } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { isGlassAvailable } from '@/lib/glass';

import { IslandHost } from './host';

type IslandButtonVariant = 'primary' | 'secondary' | 'destructive';

/**
 * The app's SwiftUI buttons, named once (ADR 0013): the `borderedProminent` +
 * `tint` primary CTA (Liquid Glass where the build supports it), plus `bordered`
 * `secondary` and `destructive` variants. Threads `useTheme()` /
 * `isGlassAvailable()` internally so screens stop hand-rolling the stack.
 *
 * Standalone by default — it brings its own `Host` and the Android `ui/Button`
 * fallback (ADR 0005 §4). Pass `inline` to render a bare `<Button>` for use
 * inside a screen's existing SwiftUI tree (iOS-only run/session screens). `fill`
 * makes the label span the width via the label-frame trick (the bottom CTA).
 */
export function IslandButton({
  variant = 'primary',
  label,
  onPress,
  fill = false,
  inline = false,
}: {
  variant?: IslandButtonVariant;
  label: string;
  onPress: () => void;
  fill?: boolean;
  inline?: boolean;
}) {
  const colors = useTheme();

  if (!inline && Platform.OS !== 'ios') {
    return <PillButton variant={variant} label={label} onPress={onPress} />;
  }

  const modifiers =
    variant === 'primary'
      ? [
          buttonStyle(isGlassAvailable() ? 'glassProminent' : 'borderedProminent'),
          controlSize('large'),
          tint(colors.primaryFill),
        ]
      : [buttonStyle('bordered'), controlSize('large')];
  const role = variant === 'destructive' ? 'destructive' : undefined;

  const button = fill ? (
    <Button role={role} onPress={onPress} modifiers={modifiers}>
      {/* SwiftUI sizes a button by its label — the maxWidth frame on the label
          (not the button) is what makes the capsule span the screen. */}
      <Text
        modifiers={[
          font({ textStyle: 'body', weight: 'semibold' }),
          frame({ maxWidth: 10000 }),
          padding({ vertical: 2 }),
        ]}
      >
        {label}
      </Text>
    </Button>
  ) : (
    <Button role={role} label={label} onPress={onPress} modifiers={modifiers} />
  );

  if (inline) return button;

  return fill ? (
    <IslandHost
      style={{ width: '100%', height: Math.round(50 * Math.min(PixelRatio.getFontScale(), 2)) }}
    >
      {button}
    </IslandHost>
  ) : (
    <IslandHost matchContents>{button}</IslandHost>
  );
}
