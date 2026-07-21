import { SegmentBar } from '@/components/segment-bar';
import { SegmentLegend } from '@/components/segment-legend';
import { Card } from '@/components/ui/card';
import type { RunSegment } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';

/**
 * A finished run's realized segment composition (ADR 0013 domain component): the
 * proportional bar plus its colour key, on the grouped-list card surface. Maps
 * the stored segments to the actual durations the bar and legend render.
 *
 * The legend renders each phase name as real Text, so VoiceOver already speaks
 * "Warm Up", "Run", … individually — do NOT wrap this card in `accessible`
 * with a combined label: that collapses those labels out of the a11y tree and
 * breaks the summary's phase assertions (complete-session's scrollUntilVisible
 * "Warm Up"). Describing the silent bar alone is a deferred follow-up.
 */
export function SegmentBreakdown({ segments }: { segments: RunSegment[] }) {
  const colors = useTheme();
  const bars = segments.map((s) => ({ kind: s.kind, seconds: s.actualDurationS }));
  return (
    <Card surface="card" className="gap-3">
      <SegmentBar segments={bars} dividerColor={colors.backgroundCard} />
      <SegmentLegend segments={bars} />
    </Card>
  );
}
