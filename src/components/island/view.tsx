import { VStack } from '@expo/ui/swift-ui';
import type { ReactNode } from 'react';

import { islandButtonHeight } from './button';
import { IslandHost } from './host';

/**
 * One island holding a vertical stack of `Island.Button inline` CTAs (ADR 0013),
 * so the gap between them is SwiftUI spacing inside a single Host rather than RN
 * spacing between two of them.
 *
 * `count` sizes the Host because it needs an explicit height — `matchContents`
 * collapses a full-width button — and SwiftUI cannot report its own size back.
 */
export function IslandView({
  count,
  spacing = 12,
  children,
}: {
  count: number;
  spacing?: number;
  children: ReactNode;
}) {
  const height = count * islandButtonHeight() + Math.max(0, count - 1) * spacing;
  return (
    <IslandHost style={{ width: '100%', height }}>
      <VStack spacing={spacing}>{children}</VStack>
    </IslandHost>
  );
}
