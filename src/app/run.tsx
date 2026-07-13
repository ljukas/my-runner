import { Button, ConfirmationDialog, Gauge, HStack, Host, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  contentTransition,
  controlSize,
  font,
  foregroundColor,
  gaugeStyle,
  monospacedDigit,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useKeepAwake } from 'expo-keep-awake';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { ThemedView } from '@/components/themed-view';
import { SegmentColors } from '@/constants/theme';
import { SEGMENT_KIND_LABEL, formatClock } from '@/domain/format';
import { useTheme } from '@/hooks/use-theme';
import { runEngine, useRunEngine } from '@/services/run-engine';
import { settingsStore, useSetting } from '@/services/settings-store';

/** useKeepAwake is unconditional, so the toggle mounts/unmounts this child. */
function KeepAwakeWhileMounted() {
  useKeepAwake();
  return null;
}

export default function RunScreen() {
  const snapshot = useRunEngine();
  const router = useRouter();
  const keepAwake = useSetting('keepScreenAwake');
  const colors = useTheme();
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
    <ThemedView className="flex-1">
      {keepAwake ? <KeepAwakeWhileMounted /> : null}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <VStack spacing={24} modifiers={[padding({ all: 24 })]}>
          <Spacer />
          <Text modifiers={[font({ textStyle: 'title2' }), foregroundColor(SegmentColors[kind])]}>
            {paused ? 'Paused' : SEGMENT_KIND_LABEL[kind]}
          </Text>
          <Text
            modifiers={[
              font({ size: 80, weight: 'bold' }),
              monospacedDigit(),
              contentTransition('numericText', { countsDown: true }),
              foregroundColor(colors.text),
            ]}>
            {formatClock(snapshot.segmentSecondsRemaining)}
          </Text>
          <Gauge value={segmentProgress} modifiers={[gaugeStyle('linearCapacity'), tint(SegmentColors[kind])]} />
          <Text modifiers={[foregroundColor(colors.textSecondary)]}>
            {snapshot.nextSegment
              ? `Next: ${SEGMENT_KIND_LABEL[snapshot.nextSegment.kind]} ${formatClock(snapshot.nextSegment.seconds)}`
              : 'Last segment — finish strong!'}
          </Text>
          <Text modifiers={[monospacedDigit(), foregroundColor(colors.textSecondary)]}>
            {`${formatClock(snapshot.activeElapsedSeconds)} / ${formatClock(snapshot.totalSeconds)}`}
          </Text>
          <Spacer />
          <HStack spacing={16}>
            <Button
              label={paused ? 'Resume' : 'Pause'}
              onPress={() => (paused ? runEngine.resume() : runEngine.pause())}
              modifiers={[buttonStyle('borderedProminent'), controlSize('large'), tint(colors.primary)]}
            />
            <Button
              label="Skip"
              onPress={() => runEngine.skipSegment()}
              modifiers={[buttonStyle('bordered'), controlSize('large')]}
            />
            <ConfirmationDialog
              title="End this run?"
              isPresented={endDialogOpen}
              onIsPresentedChange={setEndDialogOpen}
              titleVisibility="visible">
              <ConfirmationDialog.Trigger>
                <Button
                  label="End"
                  role="destructive"
                  onPress={() => setEndDialogOpen(true)}
                  modifiers={[buttonStyle('bordered'), controlSize('large')]}
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
          <Toggle
            label="Keep screen awake"
            isOn={keepAwake}
            onIsOnChange={(value) => settingsStore.set('keepScreenAwake', value)}
          />
        </VStack>
      </Host>
    </ThemedView>
  );
}
