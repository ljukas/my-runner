import { SegmentBar } from '@/components/segment-bar';
import { SegmentLegend } from '@/components/segment-legend';
import { Card } from '@/components/ui/card';
import type { RunSegment } from '@/db/schema';

/**
 * A finished run's realized segment composition (ADR 0013 domain component): the
 * proportional bar plus its colour key, on the grouped-list card surface. Maps
 * the stored segments to the actual durations the bar and legend render.
 */
export function SegmentBreakdown({ segments }: { segments: RunSegment[] }) {
  const bars = segments.map((s) => ({ kind: s.kind, seconds: s.actualDurationS }));
  return (
    <Card surface="card" className="gap-3">
      <SegmentBar segments={bars} />
      <SegmentLegend segments={bars} />
    </Card>
  );
}
