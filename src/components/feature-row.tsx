import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
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
      <View className="w-10 items-center pt-1">
        <SymbolView name={symbol} size={32} tintColor={colors.primary} />
      </View>
      <View className="flex-1 gap-0.5">
        <ThemedText className="font-semibold">{title}</ThemedText>
        <ThemedText themeColor="textSecondary">{children}</ThemedText>
      </View>
    </View>
  );
}
