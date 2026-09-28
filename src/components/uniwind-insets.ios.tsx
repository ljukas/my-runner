import type { ReactNode } from 'react';

// why a passthrough: iOS screens take the home-indicator inset from contentInsetAdjustmentBehavior,
// so feeding Uniwind the insets too would double the bottom padding of `pb-safe-offset-*`.
export function UniwindInsets({ children }: { children: ReactNode }) {
  return children;
}
