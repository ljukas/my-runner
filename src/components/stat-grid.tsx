import { HStack } from '@expo/ui/swift-ui';
import { dynamicTypeSize, font } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { PixelRatio, useWindowDimensions, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Island } from '@/components/island';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

/**
 * A two-column grid of stat tiles (ADR 0013 domain component) for the run
 * summary, styled after Apple Health's summary cards: a header of tinted SF
 * Symbol plus a label in the same tint, then a big number with a smaller gray
 * lowercase unit beside it. The value row is a SwiftUI island because SF
 * Rounded — Health's metric face — is only reachable as
 * `Font.system(design: .rounded)`; RN's `fontFamily` cannot name it. Tiles
 * wrap, so adding more later (distance, pace) grows the grid.
 */
function StatGridRoot({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap justify-between gap-y-3">{children}</View>;
}

function StatGridTile({
  icon,
  color,
  label,
  value,
  unit,
}: {
  icon: SFSymbol;
  color: string;
  label: string;
  value: string;
  unit: string;
}) {
  // C: at accessibility text sizes the 48%-wide tiles crowd the big number —
  // reflow to a single full-width column so the Dynamic-Type value has room.
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.6;
  return (
    <Card surface="card" className={cn(stacked ? 'w-full' : 'w-[48%]', 'gap-5')}>
      <View className="flex-row items-center gap-1.5">
        {/* B: glyph scales with the OS font-size setting instead of a frozen 16 pt. */}
        <SymbolView name={icon} size={16 * PixelRatio.getFontScale()} tintColor={color} />
        {/* Label shares the tile's accent (matches the icon) per the owner's vibrant
            direction. A: cap at AX3 to match the value's cap so the value stays larger. */}
        <Text
          variant="footnote"
          className="font-semibold"
          style={{ color }}
          maxFontSizeMultiplier={2.35}
        >
          {label}
        </Text>
      </View>
      <Island matchContents>
        <HStack spacing={5} alignment="lastTextBaseline">
          {/* A: Dynamic-Type text styles (scale with the OS setting) capped at AX3;
              relax the cap toward AX5 once C's full-width reflow lands. */}
          <Island.Text
            modifiers={[
              font({ design: 'rounded', textStyle: 'title', weight: 'bold' }),
              dynamicTypeSize({ max: 'accessibility3' }),
            ]}
          >
            {value}
          </Island.Text>
          <Island.Text
            tone="secondary"
            modifiers={[
              font({ design: 'rounded', textStyle: 'subheadline', weight: 'semibold' }),
              dynamicTypeSize({ max: 'accessibility3' }),
            ]}
          >
            {unit}
          </Island.Text>
        </HStack>
      </Island>
    </Card>
  );
}

export const StatGrid = Object.assign(StatGridRoot, { Tile: StatGridTile });
