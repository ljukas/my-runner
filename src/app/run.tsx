import {
  Button,
  ConfirmationDialog,
  HStack,
  Image,
  RNHostView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import { font, frame, monospacedDigit, padding } from '@expo/ui/swift-ui/modifiers';
import { useKeepAwake } from 'expo-keep-awake';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { RunProgressBar } from '@/components/run-progress-bar';
import { SettingsToggle } from '@/components/settings-toggle';
import { SkiaCountdown } from '@/components/skia-countdown';
import { SegmentColors, SegmentSymbols } from '@/constants/theme';
import { SEGMENT_KIND_LABEL, formatClock } from '@/domain/format';
import { useTheme } from '@/hooks/use-theme';
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
  const colors = useTheme();
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
  // Whole-second countdown split into MM:SS for TimeFlow (hours omitted).
  const secondsLeft = Math.max(0, Math.ceil(snapshot.segmentSecondsRemaining));
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <View className="flex-1 bg-background">
      {keepAwake ? <KeepAwakeWhileMounted /> : null}
      <Island useViewportSizeMeasurement>
        <VStack spacing={24} modifiers={[padding({ all: 24 })]}>
          <Spacer />
          {/* Icon stacked above the label so each is centred on its own line: a
              lone centred icon and centred text keep a fixed centre and only
              breathe in width — the phase header never translates sideways
              between segments the way the inline row did. The coloured SF Symbol
              carries the segment-colour cue; the label stays on the theme
              foreground so it's legible regardless of palette (main #32). */}
          <VStack spacing={6} modifiers={[frame({ height: 62 })]}>
            <Image systemName={SegmentSymbols[kind]} size={26} color={SegmentColors[kind]} />
            <Island.Text modifiers={[font({ textStyle: 'title2' })]}>
              {paused ? 'Paused' : SEGMENT_KIND_LABEL[kind]}
            </Island.Text>
          </VStack>
          {/* Both RN elements on this SwiftUI screen (ADR 0005), each hosted via
              RNHostView with a plain-View root (a bare RN leaf as the direct
              RNHostView child mounts but never paints): number-flow's Skia
              digit-roll countdown, and the Reanimated progress bar. */}
          <RNHostView matchContents>
            <SkiaCountdown minutes={minutes} seconds={seconds} color={colors.text} />
          </RNHostView>
          <RNHostView matchContents>
            <RunProgressBar
              progress={segmentProgress}
              color={SegmentColors[kind]}
              segmentIndex={snapshot.segmentIndex}
            />
          </RNHostView>
          {/* Transport row, music-player order: End · Pause/Resume · Skip. */}
          <HStack spacing={40}>
            <ConfirmationDialog
              title="End this run?"
              isPresented={endDialogOpen}
              onIsPresentedChange={setEndDialogOpen}
              titleVisibility="visible"
            >
              <ConfirmationDialog.Trigger>
                <Island.IconButton
                  systemName="stop.fill"
                  size={30}
                  color={colors.textSecondary}
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
            <Island.IconButton
              systemName={paused ? 'play.fill' : 'pause.fill'}
              size={48}
              color={SegmentColors[kind]}
              label={paused ? 'Resume' : 'Pause'}
              onPress={() => (paused ? runEngine.resume() : runEngine.pause())}
            />
            <Island.IconButton
              systemName="forward.fill"
              size={30}
              color={colors.textSecondary}
              label="Skip"
              onPress={() => runEngine.skipSegment()}
            />
          </HStack>
          <Island.Text tone="secondary">
            {snapshot.nextSegment
              ? `Next: ${SEGMENT_KIND_LABEL[snapshot.nextSegment.kind]} ${formatClock(snapshot.nextSegment.seconds)}`
              : 'Last segment — finish strong!'}
          </Island.Text>
          <Island.Text tone="secondary" modifiers={[monospacedDigit()]}>
            {`${formatClock(snapshot.activeElapsedSeconds)} / ${formatClock(snapshot.totalSeconds)}`}
          </Island.Text>
          <Spacer />
          <SettingsToggle label="Keep screen awake" settingKey="keepScreenAwake" />
        </VStack>
      </Island>
    </View>
  );
}
