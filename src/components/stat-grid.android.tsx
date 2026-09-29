import { cva, type VariantProps } from 'class-variance-authority';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { PixelRatio, useWindowDimensions, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

/**
 * The run summary's two-column stat tiles, all RN: the SF Rounded value face the
 * iOS island exists for has no Android counterpart, so the value row is plain
 * text on the theme foreground.
 */
function StatGridRoot({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap justify-between gap-y-3">{children}</View>;
}

const tileVariants = cva('gap-5', {
  variants: {
    /** `full` for a tile that would otherwise sit alone in the grid's last row. */
    width: { half: 'w-[48%]', full: 'w-full' },
  },
  defaultVariants: { width: 'half' },
});

function StatGridTile({
  icon,
  color,
  label,
  value,
  unit,
  width,
}: VariantProps<typeof tileVariants> & {
  icon: SymbolViewProps['name'];
  color: string;
  label: string;
  value: string;
  unit: string;
}) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.6;
  return (
    <Card surface="card" className={tileVariants({ width: stacked ? 'full' : width })}>
      <View className="flex-row items-center gap-1.5">
        <SymbolView name={icon} size={16 * PixelRatio.getFontScale()} tintColor={color} />
        <Text
          variant="footnote"
          className="font-semibold"
          style={{ color }}
          maxFontSizeMultiplier={2.35}
        >
          {label}
        </Text>
      </View>
      <View className="flex-row items-baseline gap-1">
        <Text variant="title1" maxFontSizeMultiplier={2.35}>
          {value}
        </Text>
        <Text
          variant="small"
          tone="secondary"
          className="font-semibold"
          maxFontSizeMultiplier={2.35}
        >
          {unit}
        </Text>
      </View>
    </Card>
  );
}

export const StatGrid = Object.assign(StatGridRoot, { Tile: StatGridTile });
