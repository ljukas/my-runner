import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SEGMENT_KIND_LABEL } from '@/domain/format';
import type { StoredSegmentKind } from '@/domain/run-motion';
import { useSegmentColors } from '@/hooks/use-theme';

const ORDER: StoredSegmentKind[] = ['warmup', 'run', 'walk', 'cooldown', 'stopped'];

/**
 * Colour key for the SegmentBar (ADR 0013 domain component). One swatch + label per kind present,
 * in `ORDER` — a single continuous-run week shows no "Walk".
 */
export function SegmentLegend({
  segments,
}: {
  segments: { kind: StoredSegmentKind; seconds: number }[];
}) {
  const segmentColors = useSegmentColors();
  const present = new Set(segments.map((s) => s.kind));
  const kinds = ORDER.filter((kind) => present.has(kind));
  return (
    <View className="flex-row flex-wrap gap-x-4 gap-y-1">
      {kinds.map((kind) => (
        <View key={kind} className="flex-row items-center gap-1.5">
          <View
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: segmentColors[kind] }}
          />
          <Text variant="footnote" tone="secondary">
            {SEGMENT_KIND_LABEL[kind]}
          </Text>
        </View>
      ))}
    </View>
  );
}
