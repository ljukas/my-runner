import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeepAwakeWhileMounted, runHoldsScreenAwake } from '@/components/keep-awake-while-mounted';
import { RunLocationBanner } from '@/components/run-location-banner';
import { RunLock } from '@/components/run-lock';
import { ScriptedRunView } from '@/components/scripted-run-view';
import { UNSAVED_RUN_ID } from '@/constants/routes';
import { useLocationPermission } from '@/services/location-tracker';
import { retryTracking, runEngine, useRunEngine } from '@/services/run-engine';

export default function RunScreen() {
  const snapshot = useRunEngine();
  const router = useRouter();
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

  if (snapshot.status === 'idle') return <Redirect href="/" />;

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      {runHoldsScreenAwake(locked) ? <KeepAwakeWhileMounted /> : null}

      {locationStatus !== null && locationStatus !== 'granted' ? (
        <RunLocationBanner status={locationStatus} locked={locked} />
      ) : null}

      <View className="flex-1" />

      {snapshot.mode === 'scripted' ? (
        <ScriptedRunView
          snapshot={snapshot}
          paused={paused}
          locked={locked}
          locationStatus={locationStatus}
        />
      ) : null}

      <View className="flex-1" />

      <View className="items-center">
        <RunLock locked={locked} onLockedChange={setLocked} />
      </View>

      <View className="flex-1" />
    </View>
  );
}
