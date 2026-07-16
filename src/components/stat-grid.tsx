import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

/**
 * A two-column grid of stat tiles (ADR 0013 domain component) for the run
 * summary. Tiles wrap, so adding more later (distance, pace) grows the grid.
 */
function StatGridRoot({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap justify-between gap-y-2">{children}</View>;
}

function StatGridTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="w-[48%]">
      <Text className="text-3xl font-bold" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      <Text variant="footnote" tone="secondary" className="mt-1 tracking-wide uppercase">
        {label}
      </Text>
    </Card>
  );
}

export const StatGrid = Object.assign(StatGridRoot, { Tile: StatGridTile });
