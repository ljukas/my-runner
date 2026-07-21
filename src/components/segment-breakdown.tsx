import { SegmentBar } from '@/components/segment-bar';
import { SegmentLegend } from '@/components/segment-legend';
import { Card } from '@/components/ui/card';
import type { RunSegment } from '@/db/schema';
import { SEGMENT_KIND_LABEL } from '@/domain/format';
import { useTheme } from '@/hooks/use-theme';

/**
 * A finished run's realized segment composition (ADR 0013 domain component): the
 * proportional bar plus its colour key, on the grouped-list card surface. Maps
 * the stored segments to the actual durations the bar and legend render.
 */
export function SegmentBreakdown({ segments }: { segments: RunSegment[] }) {
  const colors = useTheme();
  const bars = segments.map((s) => ({ kind: s.kind, seconds: s.actualDurationS }));
  // M: the bar and legend are silent to VoiceOver; give the card a spoken summary
  // of which phases the run contained.
  const kinds = Array.from(new Set(bars.map((b) => b.kind)));
  const a11yLabel = `Segment breakdown: ${kinds.map((k) => SEGMENT_KIND_LABEL[k]).join(', ')}`;
  return (
    <Card surface="card" className="gap-3" accessible accessibilityLabel={a11yLabel}>
      <SegmentBar segments={bars} dividerColor={colors.backgroundCard} />
      <SegmentLegend segments={bars} />
    </Card>
  );
}
