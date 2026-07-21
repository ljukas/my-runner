import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { PixelRatio, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';

/** One tinted-symbol feature row on the onboarding welcome screen (Apple first-launch template). */
export function FeatureRow({
  symbol,
  title,
  children,
}: {
  symbol: SymbolViewProps['name'];
  title: string;
  children: string;
}) {
  const colors = useTheme();
  return (
    <View className="flex-row gap-4">
      <View
        className="w-10 items-center pt-1"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <SymbolView
          name={symbol}
          size={Math.round(32 * Math.min(PixelRatio.getFontScale(), 1.6))}
          tintColor={colors.primary}
        />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-semibold">{title}</Text>
        <Text tone="secondary">{children}</Text>
      </View>
    </View>
  );
}
