import { Button, Host, Text } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, font, frame, padding, tint } from '@expo/ui/swift-ui/modifiers';
import { Platform } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { useTheme } from '@/hooks/use-theme';
import { isGlassAvailable } from '@/lib/glass';

/**
 * The app's primary CTA as a system-native SwiftUI island: Liquid Glass when
 * the build supports it, bordered-prominent otherwise; the RN pill on Android
 * until the compose side of the seam lands (ADR 0005 §4). Becomes
 * `Island.Button` when the ADR 0013 island layer is fully adopted.
 */
export function IslandButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const colors = useTheme();
  if (Platform.OS !== 'ios') {
    return <PrimaryButton label={label} onPress={onPress} />;
  }
  return (
    <Host style={{ width: '100%', height: 50 }}>
      <Button
        onPress={onPress}
        modifiers={[
          buttonStyle(isGlassAvailable() ? 'glassProminent' : 'borderedProminent'),
          controlSize('large'),
          tint(colors.primary),
        ]}>
        {/* SwiftUI sizes a button by its label — the maxWidth frame on the
            label (not the button) is what makes the capsule span the screen. */}
        <Text
          modifiers={[
            font({ textStyle: 'body', weight: 'semibold' }),
            frame({ maxWidth: 10000 }),
            padding({ vertical: 2 }),
          ]}>
          {label}
        </Text>
      </Button>
    </Host>
  );
}
