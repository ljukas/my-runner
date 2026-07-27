import { View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cn } from '@/lib/cn';

/**
 * The pinned bottom block of a screen (ADR 0013): supporting copy and the
 * call-to-action, on one shared inset so they read as a single unit.
 *
 * Deliberately not a native `Stack.Toolbar` — that is for search and quick
 * actions. A toolbar is one self-sizing row with no height control, so it clips
 * a stacked CTA block and floats over the content instead of reserving space
 * for it. Being ordinary RN, this participates in layout, so nothing underneath
 * needs clearance.
 */
export function Footer({ className, style, children, ...props }: ViewProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className={cn('gap-3 px-6 pt-3', className)}
      style={[{ paddingBottom: Math.max(insets.bottom, 16) }, style]}
      {...props}
    >
      {children}
    </View>
  );
}
