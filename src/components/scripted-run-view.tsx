import { View } from 'react-native';

import { RunPhaseHeader } from '@/components/run-phase-header';
import { RunProgressBar } from '@/components/run-progress-bar';
import { RunTransport } from '@/components/run-transport';
import { SkiaCountdown } from '@/components/skia-countdown';
import { Text } from '@/components/ui/text';
import { SEGMENT_KIND_LABEL, formatClock, formatDistanceKm, formatPace } from '@/domain/format';
import { useSegmentColors, useTheme } from '@/hooks/use-theme';
import type { LocationPermissionStatus } from '@/services/location-tracker';
import { endCountsAsCompleted } from '@/services/run-engine';
import type { ScriptedRunSnapshot } from '@/services/run-engine/types';
import { useSegmentClock } from '@/services/run-engine/use-segment-clock';

/** A plan session's run: the segment countdown, its progress, and what comes next. */
export function ScriptedRunView({
  snapshot,
  paused,
  locked,
  locationStatus,
}: {
  snapshot: ScriptedRunSnapshot;
  paused: boolean;
  locked: boolean;
  locationStatus: LocationPermissionStatus | null;
}) {
  const colors = useTheme();
  const segmentColors = useSegmentColors();
  const remaining = useSegmentClock(snapshot.segmentIndex, snapshot.status);

  const kind = snapshot.segmentKind ?? 'run';
  // Ending during the final cool-down saves the run as completed (issue #40);
  // the engine resolves the same rule from the event log at finalize time.
  const endsAsCompleted = endCountsAsCompleted(snapshot);

  return (
    <View className="items-center gap-6">
      <RunPhaseHeader kind={kind} paused={paused} />
      <SkiaCountdown remaining={remaining} color={colors.text} />
      <RunProgressBar
        remaining={remaining}
        totalSeconds={snapshot.segmentSecondsTotal}
        color={segmentColors[kind]}
      />
      <RunTransport paused={paused} locked={locked} endsAsCompleted={endsAsCompleted} />
      <Text tone="secondary">
        {snapshot.nextSegment
          ? `Next: ${SEGMENT_KIND_LABEL[snapshot.nextSegment.kind]} ${formatClock(snapshot.nextSegment.seconds)}`
          : 'Last segment — finish strong!'}
      </Text>
      <Text tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
        {`${formatClock(snapshot.activeElapsedSeconds)} / ${formatClock(snapshot.totalSeconds)}`}
      </Text>
      {/* Only with location granted can these numbers ever move; otherwise the row is absent
          rather than a permanent 0.00 km. */}
      {locationStatus === 'granted' || snapshot.distanceM > 0 ? (
        <Text tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
          {`${formatDistanceKm(snapshot.distanceM)} · ${formatPace(snapshot.paceSecPerKm)}`}
        </Text>
      ) : null}
    </View>
  );
}
