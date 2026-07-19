import { HStack } from '@expo/ui/swift-ui';
import { font } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Island } from '@/components/island';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

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
  return (
    <Card surface="card" className="w-[48%] gap-5">
      <View className="flex-row items-center gap-1.5">
        <SymbolView name={icon} size={16} tintColor={color} />
        <Text variant="footnote" className="font-semibold" style={{ color }}>
          {label}
        </Text>
      </View>
      <Island matchContents>
        <HStack spacing={5} alignment="lastTextBaseline">
          <Island.Text modifiers={[font({ design: 'rounded', weight: 'bold', size: 27 })]}>
            {value}
          </Island.Text>
          <Island.Text
            tone="secondary"
            modifiers={[font({ design: 'rounded', weight: 'semibold', size: 14 })]}
          >
            {unit}
          </Island.Text>
        </HStack>
      </Island>
    </Card>
  );
}

export const StatGrid = Object.assign(StatGridRoot, { Tile: StatGridTile });
