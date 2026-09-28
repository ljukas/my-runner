import type { ReactNode } from 'react';
import { SafeAreaListener } from 'react-native-safe-area-context';
import { Uniwind } from 'uniwind';

/**
 * Feeds the device's safe-area insets to Uniwind, which the free tier needs for its `*-safe*`
 * classes; without it `pb-safe-offset-6` is the 24 dp offset alone, flush with the gesture bar.
 */
export function UniwindInsets({ children }: { children: ReactNode }) {
  return (
    <SafeAreaListener style={{ flex: 1 }} onChange={({ insets }) => Uniwind.updateInsets(insets)}>
      {children}
    </SafeAreaListener>
  );
}
