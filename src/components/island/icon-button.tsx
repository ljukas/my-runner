import { Button, Image } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  frame,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

type SystemImageName = NonNullable<ComponentProps<typeof Image>['systemName']>;

/**
 * A chrome-less SwiftUI icon button — a tappable SF Symbol (ADR 0013), used for
 * the run screen's music-player transport row. `label` is required: it is the
 * only text an icon-only control exposes, so it doubles as the VoiceOver label
 * and the text-first Maestro selector (ADR 0016).
 */
export function IslandIconButton({
  systemName,
  size,
  color,
  label,
  onPress,
}: {
  systemName: SystemImageName;
  size: number;
  color: ColorValue;
  label: string;
  onPress?: () => void;
}) {
  // The visible glyph stays `size`; the tap region is floored at the 44pt HIG
  // minimum. `contentShape(rectangle)` is required so a `.plain` button hit-tests
  // the whole frame rather than just the glyph.
  const target = Math.max(size, 44);
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        frame({ width: target, height: target }),
        contentShape(shapes.rectangle()),
        accessibilityLabel(label),
      ]}
    >
      <Image systemName={systemName} size={size} color={color} />
    </Button>
  );
}
