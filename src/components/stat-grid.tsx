import { HStack } from '@expo/ui/swift-ui';
import { font } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Island } from '@/components/island';
import { Card } from '@/components/ui/card';

/**
 * A two-column grid of stat tiles (ADR 0013 domain component) for the run
 * summary, styled after Apple Health's summary cards: a tinted SF Symbol,
 * then a big number with a smaller gray lowercase unit beside it. The value
 * row is a SwiftUI island because SF Rounded — Health's metric face — is only
 * reachable as `Font.system(design: .rounded)`; RN's `fontFamily` cannot name
 * it. Tiles wrap, so adding more later (distance, pace) grows the grid.
 */
function StatGridRoot({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap justify-between gap-y-3">{children}</View>;
}

function StatGridTile({
  icon,
  color,
  value,
  unit,
}: {
  icon: SFSymbol;
  color: string;
  value: string;
  unit: string;
}) {
  return (
    <Card surface="card" className="w-[48%] gap-5">
      <SymbolView name={icon} size={20} tintColor={color} />
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
