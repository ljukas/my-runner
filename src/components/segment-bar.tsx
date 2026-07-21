import { StyleSheet, View, type ColorValue } from 'react-native';

import type { PlannedSegment } from '@/domain/plan';
import { useSegmentColors } from '@/hooks/use-theme';

export function SegmentBar({
  segments,
  accessibilityLabel,
  dividerColor,
}: {
  segments: PlannedSegment[];
  accessibilityLabel?: string;
  dividerColor?: ColorValue;
}) {
  const segmentColors = useSegmentColors();
  return (
    <View
      className="h-3 flex-row overflow-hidden rounded-full"
      accessible={accessibilityLabel != null}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {segments.map((segment, index) => (
        <View
          key={index}
          style={{
            flex: segment.seconds,
            backgroundColor: segmentColors[segment.kind],
            // Hairline separator so interval boundaries survive grayscale / CVD.
            borderRightWidth: index < segments.length - 1 ? StyleSheet.hairlineWidth : 0,
            borderColor: dividerColor,
          }}
        />
      ))}
    </View>
  );
}
