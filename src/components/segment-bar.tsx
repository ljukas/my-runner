import { View } from 'react-native';

import { SegmentColors } from '@/constants/theme';
import type { PlannedSegment } from '@/domain/plan';

export function SegmentBar({ segments }: { segments: PlannedSegment[] }) {
  return (
    <View className="h-3 flex-row overflow-hidden rounded-full">
      {segments.map((segment, index) => (
        <View
          key={index}
          style={{ flex: segment.seconds, backgroundColor: SegmentColors[segment.kind] }}
        />
      ))}
    </View>
  );
}
