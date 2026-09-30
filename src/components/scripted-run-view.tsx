import { View } from 'react-native';

import { RunPhaseHeader } from '@/components/run-phase-header';
import { RunProgressBar } from '@/components/run-progress-bar';
import { RunTransport } from '@/components/run-transport';
import { SkiaCountdown } from '@/components/skia-countdown';
import { Text } from '@/components/ui/text';
import { SEGMENT_KIND_LABEL, formatClock, formatDistanceKm, formatPace } from '@/domain/format';
import { showsRunMetrics } from '@/domain/free-run-view';
import { useSegmentColors, useTheme } from '@/hooks/use-theme';
import type { LocationPermissionStatus } from '@/services/location-tracker';
import { endCountsAsCompleted } from '@/services/run-engine';
import type { ScriptedRunSnapshot } from '@/services/run-engine/types';
import { useSegmentClock } from '@/services/run-engine/use-segment-clock';

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
      <RunTransport paused={paused} locked={locked} end={{ mode: 'scripted', endsAsCompleted }} />
      <Text tone="secondary">
        {snapshot.nextSegment
          ? `Next: ${SEGMENT_KIND_LABEL[snapshot.nextSegment.kind]} ${formatClock(snapshot.nextSegment.seconds)}`
          : 'Last segment — finish strong!'}
      </Text>
      <Text tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
        {`${formatClock(snapshot.activeElapsedSeconds)} / ${formatClock(snapshot.totalSeconds)}`}
      </Text>
      {showsRunMetrics(locationStatus, snapshot.distanceM) ? (
        <Text tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
          {`${formatDistanceKm(snapshot.distanceM)} · ${formatPace(snapshot.paceSecPerKm)}`}
        </Text>
      ) : null}
    </View>
  );
}
