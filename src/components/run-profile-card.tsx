import { View } from 'react-native';

import { RunProfileChart } from '@/components/run-profile-chart';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { Run } from '@/db/schema';
import { formatDistanceKm } from '@/domain/format';
import { useRunProfile } from '@/hooks/use-run-profile';

/**
 * A finished run's pace profile (ADR 0013 domain component). Renders nothing without a usable
 * route: the route card directly above already explains why such a run has no GPS data, and a
 * second explanatory card would be noise.
 *
 * Pace only: elevation is deferred whole (spec §3.6) because the smoothed series fabricates
 * terrain on flat ground, so both the line and its totals wait for the barometer slice.
 */
export function RunProfileCard({ run }: { run: Run }) {
  // why true: the caller (runs/[runId]/index) only mounts this card once its own live query has loaded.
  const profile = useRunProfile(run.id, true);

  if (!profile.ready) return null;

  const distance = run.distanceM !== null ? formatDistanceKm(run.distanceM) : null;
  const label = `Pace profile${distance ? ` over ${distance}` : ''}`;

  return (
    <Card surface="card" className="gap-3">
      <Text
        variant="footnote"
        tone="secondary"
        className="font-semibold"
        accessibilityRole="header"
      >
        Pace
      </Text>

      {/* why the label lives here: the chart is a Skia canvas and carries no accessible
          content of its own, so the card is the only thing VoiceOver can read. */}
      <View accessible accessibilityLabel={label}>
        <RunProfileChart points={profile.points} />
      </View>
    </Card>
  );
}
