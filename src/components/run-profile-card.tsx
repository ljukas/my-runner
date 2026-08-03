import { View } from 'react-native';

import { RunProfileChart } from '@/components/run-profile-chart';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { Run } from '@/db/schema';
import { formatDistanceKm, formatPace, paceParts } from '@/domain/format';
import { paceRange } from '@/domain/run-profile';
import { hasMeasuredDistance } from '@/domain/run-stats';
import type { RunTrack } from '@/hooks/use-run-track';

/**
 * A finished run's pace profile (ADR 0013 domain component). Renders nothing without a usable
 * route — it shares `useRunTrack`'s readiness with the route card, which already explains why
 * such a run has no GPS data, and a second explanatory card would be noise.
 *
 * Pace only: elevation is deferred whole (spec §3.6) because the smoothed series fabricates
 * terrain on flat ground, so both the line and its totals wait for the barometer slice.
 */
export function RunProfileCard({ run, track }: { run: Run; track: RunTrack }) {
  // why a second gate: `track.ready` is spatial — a 100 m bbox diagonal — while `RunStatGrid` and
  // `SegmentSplits` gate on a 0.5 m/s speed floor. A slow shuffle clears the first and fails the
  // second, and charting a min/km line on a summary that withholds pace everywhere else is the
  // divergence this closes; it also stopped the label announcing a distance the chart contradicts.
  if (!track.ready || !track.profile) return null;
  if (!hasMeasuredDistance(run.distanceM, run.activeDurationS)) return null;

  const range = paceRange(track.profile);
  const label = [
    `Pace profile over ${formatDistanceKm(run.distanceM)}.`,
    range &&
      `The chart spans ${paceParts(range.fastestSecPerKm).value} to ${formatPace(range.slowestSecPerKm)}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Card surface="card" className="gap-3">
      <View className="flex-row items-baseline justify-between">
        <Text
          variant="footnote"
          tone="secondary"
          className="font-semibold"
          accessibilityRole="header"
        >
          Pace
        </Text>
        {/* why here and not an axis title: the y-axis prints m:ss, a pace only once the unit is
            stated, and a rotated Skia title competes for width with the chart. */}
        <Text variant="caption" tone="secondary">
          min/km
        </Text>
      </View>

      {/* why the label lives here: the chart is a Skia canvas and carries no accessible
          content of its own, so the card is the only thing VoiceOver can read. */}
      <View accessible accessibilityRole="image" accessibilityLabel={label}>
        <RunProfileChart points={track.profile} />
      </View>
    </Card>
  );
}
