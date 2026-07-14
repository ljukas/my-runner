import { Image, Label, type LabelProps } from '@expo/ui/swift-ui';
import { foregroundColor } from '@expo/ui/swift-ui/modifiers';

import { useTheme } from '@/hooks/use-theme';

type Tone = 'default' | 'secondary' | 'primary';

/**
 * A SwiftUI `Label` (SF Symbol + title) themed from the palette (ADR 0013).
 * `tone` colors the title, `iconTone` the symbol — both set explicitly so the
 * label reads correctly inside a tinted `Button` (a plain SwiftUI Button tints
 * its content with the accent color otherwise). The icon is a custom `Image`
 * so it can be tinted independently of the title.
 */
export function IslandLabel({
  systemImage,
  iconTone = 'default',
  tone = 'default',
  size = 22,
  modifiers = [],
  ...props
}: Omit<LabelProps, 'systemImage' | 'icon' | 'color'> & {
  systemImage: NonNullable<LabelProps['systemImage']>;
  iconTone?: Tone;
  tone?: Tone;
  size?: number;
}) {
  const colors = useTheme();
  const toColor = (t: Tone) =>
    t === 'primary' ? colors.primary : t === 'secondary' ? colors.textSecondary : colors.text;
  return (
    <Label
      icon={<Image systemName={systemImage} color={toColor(iconTone)} size={size} />}
      modifiers={[foregroundColor(toColor(tone)), ...modifiers]}
      {...props}
    />
  );
}
