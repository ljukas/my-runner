import { View, type ViewProps } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

/**
 * A vertical list of label/value stat rows (ADR 0013), promoted from the
 * session sheet's private `StatRow`. This is the RN-side vocabulary; the
 * SwiftUI equivalent for a Form/Section context is `@expo/ui`'s native
 * `LabeledContent` (run-summary, settings), used directly — not this component.
 */
function StatListRoot({ className, ...props }: ViewProps) {
  return <View className={cn('gap-2', className)} {...props} />;
}

function StatListRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <Text tone="secondary">{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

export const StatList = Object.assign(StatListRoot, { Row: StatListRow });
