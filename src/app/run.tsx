import { Button, ConfirmationDialog, Gauge, HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  contentTransition,
  font,
  gaugeStyle,
  monospacedDigit,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useKeepAwake } from 'expo-keep-awake';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { SettingsToggle } from '@/components/settings-toggle';
import { SegmentColors } from '@/constants/theme';
import { SEGMENT_KIND_LABEL, formatClock } from '@/domain/format';
import { runEngine, useRunEngine } from '@/services/run-engine';
import { useSetting } from '@/services/settings-store';

/** useKeepAwake is unconditional, so the toggle mounts/unmounts this child. */
function KeepAwakeWhileMounted() {
  useKeepAwake();
  return null;
}

export default function RunScreen() {
  const snapshot = useRunEngine();
  const router = useRouter();
  const keepAwake = useSetting('keepScreenAwake');
  const [endDialogOpen, setEndDialogOpen] = useState(false);
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
    // The summary reads the run id / save outcome from the engine snapshot.
    if (finished && saveSettled) router.replace('/run-summary');
  }, [finished, saveSettled, router]);

  if (snapshot.status === 'idle') return <Redirect href="/" />;
  const kind = snapshot.segmentKind ?? 'run';
  const segmentProgress =
    snapshot.segmentSecondsTotal > 0
      ? Math.min(1, 1 - snapshot.segmentSecondsRemaining / snapshot.segmentSecondsTotal)
      : 0;

  return (
    <View className="flex-1 bg-background">
      {keepAwake ? <KeepAwakeWhileMounted /> : null}
      <Island useViewportSizeMeasurement>
        <VStack spacing={24} modifiers={[padding({ all: 24 })]}>
          <Spacer />
          {/* Segment name uses the theme foreground — segment colour would be illegible as text
              (e.g. walk-yellow on white). The gauge below carries the segment colour cue. */}
          <Island.Text modifiers={[font({ textStyle: 'title2' })]}>
            {paused ? 'Paused' : SEGMENT_KIND_LABEL[kind]}
          </Island.Text>
          <Island.Text
            modifiers={[
              font({ size: 80, weight: 'bold' }),
              monospacedDigit(),
              contentTransition('numericText', { countsDown: true }),
            ]}
          >
            {formatClock(snapshot.segmentSecondsRemaining)}
          </Island.Text>
          <Gauge
            value={segmentProgress}
            modifiers={[gaugeStyle('linearCapacity'), tint(SegmentColors[kind])]}
          />
          <Island.Text tone="secondary">
            {snapshot.nextSegment
              ? `Next: ${SEGMENT_KIND_LABEL[snapshot.nextSegment.kind]} ${formatClock(snapshot.nextSegment.seconds)}`
              : 'Last segment — finish strong!'}
          </Island.Text>
          <Island.Text tone="secondary" modifiers={[monospacedDigit()]}>
            {`${formatClock(snapshot.activeElapsedSeconds)} / ${formatClock(snapshot.totalSeconds)}`}
          </Island.Text>
          <Spacer />
          <HStack spacing={16}>
            <Island.Button
              inline
              label={paused ? 'Resume' : 'Pause'}
              onPress={() => (paused ? runEngine.resume() : runEngine.pause())}
            />
            <Island.Button
              inline
              variant="secondary"
              label="Skip"
              onPress={() => runEngine.skipSegment()}
            />
            <ConfirmationDialog
              title="End this run?"
              isPresented={endDialogOpen}
              onIsPresentedChange={setEndDialogOpen}
              titleVisibility="visible"
            >
              <ConfirmationDialog.Trigger>
                <Island.Button
                  inline
                  variant="destructive"
                  label="End"
                  onPress={() => setEndDialogOpen(true)}
                />
              </ConfirmationDialog.Trigger>
              <ConfirmationDialog.Actions>
                <Button role="destructive" label="End run" onPress={() => runEngine.endEarly()} />
              </ConfirmationDialog.Actions>
              <ConfirmationDialog.Message>
                <Text>Progress so far is saved as a partial run.</Text>
              </ConfirmationDialog.Message>
            </ConfirmationDialog>
          </HStack>
          <SettingsToggle label="Keep screen awake" settingKey="keepScreenAwake" />
        </VStack>
      </Island>
    </View>
  );
}
