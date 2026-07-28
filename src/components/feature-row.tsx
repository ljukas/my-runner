import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { PixelRatio, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';

// Two Apple templates are in play: the roomier first-launch welcome screen, and the
// tighter feature-intro sheet the permission primers follow (primer-polish spec §4.1).
const templates = {
  welcome: {
    row: 'flex-row gap-4',
    gutter: 'w-10 items-center pt-1',
    symbol: 32,
    body: 'flex-1 gap-0.5',
  },
  primer: {
    row: 'flex-row gap-3',
    gutter: 'w-8 items-center pt-1',
    symbol: 28,
    body: 'flex-1 gap-0',
  },
} as const;

/** One tinted-symbol feature row of an onboarding step. */
export function FeatureRow({
  symbol,
  title,
  template = 'welcome',
  children,
}: {
  symbol: SymbolViewProps['name'];
  title: string;
  template?: keyof typeof templates;
  children: string;
}) {
  const colors = useTheme();
  const metrics = templates[template];

  return (
    <View className={metrics.row}>
      <View
        className={metrics.gutter}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <SymbolView
          name={symbol}
          size={Math.round(metrics.symbol * Math.min(PixelRatio.getFontScale(), 1.6))}
          tintColor={colors.primary}
        />
      </View>

      <View className={metrics.body}>
        <Text className="font-semibold">{title}</Text>
        <Text tone="secondary">{children}</Text>
      </View>
    </View>
  );
}
