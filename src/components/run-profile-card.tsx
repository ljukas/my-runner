import { View } from 'react-native';

import { RunProfileChart } from '@/components/run-profile-chart';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { Run } from '@/db/schema';
import { formatDistanceKm, formatElevation, formatPace, paceParts } from '@/domain/format';
import { bandsLabel } from '@/domain/profile-bands';
import { isDrawableElevation, paceRange } from '@/domain/run-profile';
import type { RunTrack } from '@/hooks/use-run-track';
import { useStatColors } from '@/hooks/use-theme';

/**
 * A finished run's pace profile, with its elevation when the run carries one (ADR 0013 domain
 * component). Renders nothing when `deriveRunSummary` withholds the profile — the route card
 * already explains why such a run has no GPS data, and a second explanatory card would be noise.
 */
export function RunProfileCard({ run, track }: { run: Run; track: RunTrack }) {
  const stat = useStatColors();
  if (!track.ready || !track.profile || run.distanceM === null) return null;

  const withElevation = isDrawableElevation(track.profile);
  const elevation =
    withElevation && track.elevation?.status === 'estimated' ? track.elevation : null;
  const range = paceRange(track.profile);
  const label = [
    `${withElevation ? 'Pace and elevation' : 'Pace'} profile over ${formatDistanceKm(run.distanceM)}.`,
    range &&
      `The chart spans ${paceParts(range.fastestSecPerKm).value} to ${formatPace(range.slowestSecPerKm)}.`,
    // why only when clipped: the line visibly exits the plot, and the label is a VoiceOver user's
    // only equivalent (design §8.1).
    range &&
      range.clippedCount > 0 &&
      `${range.clippedCount} slower ${range.clippedCount === 1 ? 'point' : 'points'} ` +
        `${range.clippedCount === 1 ? 'reaches' : 'reach'} ` +
        `${formatPace(range.clippedSlowestSecPerKm)}, above the chart.`,
    elevation &&
      `Estimated elevation gain ${formatElevation(elevation.gainM)}, ` +
        `loss ${formatElevation(elevation.lossM)}.`,
    track.bands && bandsLabel(track.bands),
  ]
    .filter(Boolean)
    .join(' ');

  const title = (
    <Text variant="footnote" tone="secondary" className="font-semibold" accessibilityRole="header">
      {withElevation ? 'Pace & Elevation' : 'Pace'}
    </Text>
  );

  return (
    <Card surface="card" className="gap-3">
      {/* why each unit rides the heading at its axis's side: HIG "Charts" tells a compact chart to
          describe units "in other areas of the chart, such as in a title", and the ticks each unit
          names render at that edge (pace `axisSide: 'right'`, elevation `'left'`). With both, the
          units take their lines' tints because colour is what tells the two series apart. */}
      <View className="gap-1">
        {withElevation ? title : null}
        <View className="flex-row items-baseline justify-between">
          {withElevation ? (
            <Text variant="caption" style={{ color: stat.elevation }}>
              m
            </Text>
          ) : (
            title
          )}
          <Text
            variant="caption"
            tone="secondary"
            style={withElevation ? { color: stat.pace } : undefined}
          >
            min/km
          </Text>
        </View>
      </View>

      {/* why the label lives here: the chart is a Skia canvas and carries no accessible
          content of its own, so the card is the only thing VoiceOver can read. */}
      <View accessible accessibilityRole="image" accessibilityLabel={label}>
        <RunProfileChart points={track.profile} bands={track.bands} />
      </View>
    </Card>
  );
}
