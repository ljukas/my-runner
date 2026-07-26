import { PixelRatio, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { RunSegment } from '@/db/schema';
import { SEGMENT_KIND_LABEL, formatDistanceKm, formatPace } from '@/domain/format';
import { bestRunSegment, segmentPaceSecPerKm } from '@/domain/run-stats';
import { useSegmentColors } from '@/hooks/use-theme';
import { cn } from '@/lib/cn';

/**
 * Per-segment distance and pace for a finished run (ADR 0013 domain component), with the fastest
 * run interval badged. Renders nothing when no segment carries a distance, so a run recorded
 * without GPS keeps its time-only summary.
 */
export function SegmentSplits({ segments }: { segments: RunSegment[] }) {
  const segmentColors = useSegmentColors();
  const best = bestRunSegment(segments);
  const hasDistance = segments.some((s) => s.distanceM !== null && s.distanceM > 0);
  // Stack the numbers under the phase name at accessibility Dynamic Type, as StatList.Row does.
  const stacked = PixelRatio.getFontScale() >= 1.6;

  if (!hasDistance) return null;

  return (
    <Card surface="card" className="gap-3">
      <Text
        variant="footnote"
        tone="secondary"
        className="font-semibold"
        accessibilityRole="header"
      >
        Interval Pace
      </Text>
      {segments.map((segment) => {
        const fastest = segment === best;
        const paceSec = segmentPaceSecPerKm(segment);
        const distanceText = segment.distanceM === null ? '—' : formatDistanceKm(segment.distanceM);
        return (
          <View key={segment.id} className={stacked ? 'gap-1' : 'flex-row items-center gap-3'}>
            <View className={cn('flex-row items-center gap-2', !stacked && 'flex-1')}>
              <View
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: segmentColors[segment.kind] }}
              />
              <Text
                variant="small"
                className={fastest ? 'font-bold' : undefined}
                numberOfLines={stacked ? undefined : 1}
              >
                {SEGMENT_KIND_LABEL[segment.kind]}
              </Text>
              {fastest ? <Badge tone="positive" label="Fastest" /> : null}
            </View>
            <View className="flex-row items-center gap-3">
              {/* F10: tabular figures so the two columns line up down the card. */}
              <Text variant="small" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                {distanceText}
              </Text>
              <Text variant="small" style={{ fontVariant: ['tabular-nums'] }}>
                {formatPace(paceSec)}
              </Text>
            </View>
          </View>
        );
      })}
    </Card>
  );
}
