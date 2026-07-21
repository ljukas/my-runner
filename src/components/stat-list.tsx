import { PixelRatio, View, type ViewProps } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

/**
 * A vertical list of label/value stat rows (ADR 0013), promoted from the
 * session sheet's private `StatRow`. This is the RN-side vocabulary; the
 * SwiftUI equivalent for a Form/Section context is `@expo/ui`'s native
 * `LabeledContent` (settings), used directly — not this component.
 */
function StatListRoot({ className, ...props }: ViewProps) {
  return <View className={cn('gap-2', className)} {...props} />;
}

function StatListRow({ label, value }: { label: string; value: string }) {
  // Stack value under label at accessibility Dynamic Type so the two don't collide.
  const stacked = PixelRatio.getFontScale() >= 1.6;
  return (
    <View
      className={stacked ? 'flex-col items-start gap-0.5' : 'flex-row items-center justify-between'}
      accessible // F8: one VoiceOver stop
      accessibilityLabel={`${label}, ${value.replace('×', ' times')}`} // F8: "12 times"
    >
      <Text tone="secondary" className="flex-shrink" numberOfLines={stacked ? undefined : 1}>
        {label}
      </Text>
      {/* F10: tabular figures so value columns line up */}
      <Text style={{ fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

export const StatList = Object.assign(StatListRoot, { Row: StatListRow });
