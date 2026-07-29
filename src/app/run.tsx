import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeepAwakeWhileMounted } from '@/components/keep-awake-while-mounted';
import { RunLocationBanner } from '@/components/run-location-banner';
import { RunLock } from '@/components/run-lock';
import { RunPhaseHeader } from '@/components/run-phase-header';
import { RunProgressBar } from '@/components/run-progress-bar';
import { RunTransport } from '@/components/run-transport';
import { SkiaCountdown } from '@/components/skia-countdown';
import { Text } from '@/components/ui/text';
import { UNSAVED_RUN_ID } from '@/constants/routes';
import { SEGMENT_KIND_LABEL, formatClock, formatDistanceKm, formatPace } from '@/domain/format';
import { useSegmentColors, useTheme } from '@/hooks/use-theme';
import { useLocationPermission } from '@/services/location-tracker';
import {
  endCountsAsCompleted,
  retryTracking,
  runEngine,
  useRunEngine,
} from '@/services/run-engine';
import { useSegmentClock } from '@/services/run-engine/use-segment-clock';

export default function RunScreen() {
  const snapshot = useRunEngine();
  const router = useRouter();
  const colors = useTheme();
  const segmentColors = useSegmentColors();
  const locationStatus = useLocationPermission();
  const insets = useSafeAreaInsets();

  const [locked, setLocked] = useState(false);
  const paused = snapshot.status === 'paused';

  useEffect(() => {
    // While paused, elapsed is frozen and nothing time-derived can change —
    // pause/resume/skip refresh the snapshot themselves, so the ticker rests.
    if (paused) return;
    const id = setInterval(() => runEngine.heartbeat(), 1000);
    return () => clearInterval(id);
  }, [paused]);

  const finished = snapshot.status === 'completed' || snapshot.status === 'endedEarly';
  const saveSettled = snapshot.savedRunId !== null || snapshot.saveFailed;
  useEffect(() => {
    // Hand the run id + a fresh-finish flag to the summary via params; the
    // summary is engine-free and reads only these. `replace` so Back never
    // returns to the finished run. `savedRunId` is null only on save failure,
    // which the summary renders as its "couldn't be saved" state.
    if (finished && saveSettled) {
      router.replace({
        pathname: '/runs/[runId]',
        params: { runId: snapshot.savedRunId ?? UNSAVED_RUN_ID, celebrate: '1' },
      });
    }
  }, [finished, saveSettled, snapshot.savedRunId, router]);

  useEffect(() => {
    if (locationStatus !== 'granted') return;
    void retryTracking().catch((error) => console.warn('[run] tracking restart failed', error));
  }, [locationStatus]);

  const remaining = useSegmentClock(snapshot.segmentIndex, snapshot.status);

  if (snapshot.status === 'idle') return <Redirect href="/" />;
  const kind = snapshot.segmentKind ?? 'run';
  // Ending during the final cool-down saves the run as completed (issue #40);
  // the engine resolves the same rule from the event log at finalize time.
  const endsAsCompleted = endCountsAsCompleted(snapshot);

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      {locked ? <KeepAwakeWhileMounted /> : null}

      {locationStatus !== null && locationStatus !== 'granted' ? (
        <RunLocationBanner status={locationStatus} locked={locked} />
      ) : null}

      <View className="flex-1" />

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

      <View className="flex-1" />

      <View className="items-center">
        <RunLock locked={locked} onLockedChange={setLocked} />
      </View>

      <View className="flex-1" />
    </View>
  );
}
