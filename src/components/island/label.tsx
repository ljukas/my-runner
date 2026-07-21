import { Image, Label, type LabelProps } from '@expo/ui/swift-ui';
import { accessibilityHidden, font, foregroundColor } from '@expo/ui/swift-ui/modifiers';

import { useTheme } from '@/hooks/use-theme';

type Tone = 'default' | 'secondary' | 'primary' | 'success';

/**
 * A SwiftUI `Label` (SF Symbol + title) themed from the palette (ADR 0013).
 * `tone` colors the title, `iconTone` the symbol — both set explicitly so the
 * label reads correctly inside a tinted `Button` (a plain SwiftUI Button tints
 * its content with the accent color otherwise). The icon is a custom `Image` so
 * it can be tinted independently of the title; it scales with Dynamic Type via
 * the `body` text style (HIG §3/§5). Pass `decorativeIcon` when the title
 * already conveys the meaning, so the glyph is hidden from VoiceOver.
 */
export function IslandLabel({
  systemImage,
  iconTone = 'default',
  tone = 'default',
  decorativeIcon = false,
  modifiers = [],
  ...props
}: Omit<LabelProps, 'systemImage' | 'icon' | 'color'> & {
  systemImage: NonNullable<LabelProps['systemImage']>;
  iconTone?: Tone;
  tone?: Tone;
  decorativeIcon?: boolean;
}) {
  const colors = useTheme();
  const toColor = (t: Tone) =>
    t === 'primary'
      ? colors.primary
      : t === 'success'
        ? colors.success
        : t === 'secondary'
          ? colors.textSecondary
          : colors.text;
  return (
    <Label
      icon={
        <Image
          systemName={systemImage}
          color={toColor(iconTone)}
          modifiers={[
            font({ textStyle: 'body' }),
            ...(decorativeIcon ? [accessibilityHidden(true)] : []),
          ]}
        />
      }
      modifiers={[foregroundColor(toColor(tone)), ...modifiers]}
      {...props}
    />
  );
}
