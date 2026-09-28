import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { PixelRatio, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';

type Tone = 'default' | 'secondary' | 'primary' | 'success';

const SYMBOL_POINTS = 20;

/** Plain RN, not Compose: one icon pipeline app-wide (ADR 0025 §2). Same tones as the SwiftUI label. */
export function IslandLabel({
  systemImage,
  title,
  iconTone = 'default',
  tone = 'default',
  decorativeIcon = false,
}: {
  systemImage: SymbolViewProps['name'];
  title: string;
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
    <View className="flex-row items-center gap-3">
      <View
        accessibilityElementsHidden={decorativeIcon}
        importantForAccessibility={decorativeIcon ? 'no-hide-descendants' : 'auto'}
      >
        <SymbolView
          name={systemImage}
          size={Math.round(SYMBOL_POINTS * Math.min(PixelRatio.getFontScale(), 1.6))}
          tintColor={toColor(iconTone)}
        />
      </View>
      <Text style={{ color: toColor(tone) }}>{title}</Text>
    </View>
  );
}
