import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { androidOnly } from '@/lib/android-only';
import { cn } from '@/lib/cn';
import { Island } from '@/components/island';
import { Text } from '@/components/ui/text';
import { runTitle } from '@/domain/format';
import { keyOf } from '@/domain/free-run';
import { leaveToTabs } from '@/lib/leave-to-tabs';
import { declineResumableRun, resumeCrashedRun } from '@/services/run-engine';
import { clearResumeOffer, peekResumeOffer } from '@/services/run-engine/resume-offer';

export default function ResumeRunScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  // Snapshot once: `decide` clears the module-scope offer, and re-reading it on the re-render that
  // follows would leave this screen before the navigation it just asked for.
  const [candidate] = useState(peekResumeOffer);
  const decided = useRef(false);

  useEffect(() => {
    if (!candidate) {
      leaveToTabs(router);
      return;
    }
    // why: Android's back, scrim tap and drag close the sheet without asking (`gestureEnabled` is
    // iOS-only), and an undecided run would stay hidden and hold the resume gate — so leaving saves it,
    // as an offer that expires does
    return navigation.addListener('beforeRemove', () => {
      if (decided.current) return;
      decided.current = true;
      clearResumeOffer();
      void declineResumableRun(candidate);
    });
  }, [candidate, navigation, router]);

  if (!candidate) return null;

  const decide = async (resume: boolean) => {
    if (decided.current) return;
    decided.current = true;
    clearResumeOffer();
    // The engine announces the resume itself, behind the cue-suppression flag (spec §8.0).
    if (resume && (await resumeCrashedRun(candidate))) {
      router.replace('/run');
      return;
    }
    // A false resume means the run expired between detection and the tap, so finalizing is the only
    // outcome left; show the saved run rather than returning silently. `celebrate` because this is a
    // fresh finish either way — the same acknowledgement an ended-early run gets.
    // Nothing saved to show: a free run under a minute is deleted, and a failed save retries at launch.
    if (!(await declineResumableRun(candidate))) {
      leaveToTabs(router);
      return;
    }
    router.replace({
      pathname: '/runs/[runId]',
      params: { runId: candidate.runId, celebrate: '1' },
    });
  };

  return (
    <View className={cn('gap-8 bg-background px-6 pt-8', androidOnly('pb-safe-offset-6'))}>
      <View className="gap-2">
        <Text variant="subtitle" accessibilityRole="header">
          Resume run?
        </Text>
        <Text tone="secondary">
          {`${runTitle(keyOf(candidate.plan))} was interrupted. Resume to pick up where you left off, or save what you ran so far.`}
        </Text>
      </View>

      <View className="gap-3">
        <Island.Button fill label="Resume" onPress={() => void decide(true)} />
        <Island.Button
          fill
          variant="secondary"
          label={candidate.plan.mode === 'open' ? 'Save Run' : 'Save as Partial'}
          onPress={() => void decide(false)}
        />
      </View>
    </View>
  );
}
