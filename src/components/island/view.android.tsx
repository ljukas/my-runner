import { Column } from '@expo/ui/jetpack-compose';
import type { ReactNode } from 'react';

import { IslandHost } from './host';

/**
 * A vertical stack of `Island.Button inline` CTAs in one Compose host. Compose
 * reports content height back to RN, so `count` is accepted for API parity
 * with the SwiftUI island but not needed to size anything.
 */
export function IslandView({
  spacing = 12,
  children,
}: {
  count: number;
  spacing?: number;
  children: ReactNode;
}) {
  return (
    <IslandHost matchContents={{ vertical: true }} style={{ width: '100%' }}>
      <Column verticalArrangement={{ spacedBy: spacing }}>{children}</Column>
    </IslandHost>
  );
}
