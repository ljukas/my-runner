import { View } from 'react-native';

import { RunPhaseHeader } from '@/components/run-phase-header';
import { RunTransport } from '@/components/run-transport';
import { SkiaElapsedClock } from '@/components/skia-elapsed-clock';
import { Text } from '@/components/ui/text';
import { formatDistanceKm } from '@/domain/format';
import { formatRollingPace, freeRunPhase, showsFreeRunMetrics } from '@/domain/free-run-view';
import { useTheme } from '@/hooks/use-theme';
import type { LocationPermissionStatus } from '@/services/location-tracker';
import type { OpenRunSnapshot } from '@/services/run-engine/types';
import { useElapsedClock } from '@/services/run-engine/use-elapsed-clock';

/** A free run in progress (spec §5.2): what it is doing now, how long, and how far and fast. */
export function FreeRunView({
  snapshot,
  paused,
  locked,
  locationStatus,
}: {
  snapshot: OpenRunSnapshot;
  paused: boolean;
  locked: boolean;
  locationStatus: LocationPermissionStatus | null;
}) {
  const colors = useTheme();
  const seconds = useElapsedClock(snapshot.elapsedAnchorMs, snapshot.activeElapsedSeconds);
  const phase = freeRunPhase({
    motion: snapshot.motion,
    gpsStale: snapshot.gpsStale,
    location: locationStatus,
  });

  return (
    <View className="items-center gap-6">
      <RunPhaseHeader kind={phase.look} label={phase.label} paused={paused} />
      <SkiaElapsedClock seconds={seconds} color={colors.text} />
      <RunTransport
        paused={paused}
        locked={locked}
        end={{ mode: 'open', discards: snapshot.endDiscards }}
      />
      {showsFreeRunMetrics(locationStatus, snapshot.distanceM) ? (
        <Text tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
          {`${formatDistanceKm(snapshot.distanceM)} · ${formatRollingPace(snapshot.rollingPaceSecPerKm)}`}
        </Text>
      ) : null}
    </View>
  );
}
