import { View } from 'react-native';

import { SegmentColors } from '@/constants/theme';
import type { PlannedSegment } from '@/domain/plan';

export function SegmentBar({ segments, testID }: { segments: PlannedSegment[]; testID?: string }) {
  return (
    <View testID={testID} className="h-3 flex-row overflow-hidden rounded-full">
      {segments.map((segment, index) => (
        <View key={index} style={{ flex: segment.seconds, backgroundColor: SegmentColors[segment.kind] }} />
      ))}
    </View>
  );
}
