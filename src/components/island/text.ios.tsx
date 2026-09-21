import { Text, type TextProps } from '@expo/ui/swift-ui';
import { foregroundColor } from '@expo/ui/swift-ui/modifiers';

import { useTheme } from '@/hooks/use-theme';

type Tone = 'default' | 'secondary';

/**
 * A SwiftUI `Text` that carries its theme color itself (ADR 0013), so screens
 * stop threading `useTheme()` into modifier arrays. `tone` picks the color;
 * any extra `modifiers` (font, monospacedDigit, contentTransition, …) compose
 * after it. For a non-theme color (e.g. a segment accent) use `@expo/ui` `Text`
 * directly.
 */
export function IslandText({
  tone = 'default',
  modifiers = [],
  ...props
}: TextProps & { tone?: Tone }) {
  const colors = useTheme();
  const color = tone === 'secondary' ? colors.textSecondary : colors.text;
  return <Text modifiers={[foregroundColor(color), ...modifiers]} {...props} />;
}
