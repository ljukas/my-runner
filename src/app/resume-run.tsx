import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { Text } from '@/components/ui/text';
import { sessionTitle } from '@/domain/format';
import { cueService } from '@/services/cue-service';
import { discardResumableRun, resumeCrashedRun } from '@/services/run-engine';
import { clearResumeOffer, peekResumeOffer } from '@/services/run-engine/resume-offer';

export default function ResumeRunScreen() {
  const router = useRouter();
  // Snapshot once: `decide` clears the module-scope offer, and re-reading it on the re-render that
  // follows would trip the redirect below and cancel the navigation it just asked for.
  const [candidate] = useState(peekResumeOffer);
  const [busy, setBusy] = useState(false);

  if (!candidate) return <Redirect href="/" />;

  const decide = async (resume: boolean) => {
    if (busy) return;
    setBusy(true);
    clearResumeOffer();
    if (resume && (await resumeCrashedRun(candidate))) {
      cueService.announce('resuming');
      router.replace('/run');
      return;
    }
    // A false resume means the run expired between detection and the tap, so finalizing is the only
    // outcome left; show the saved run rather than returning silently. `celebrate` because this is a
    // fresh finish either way — the same acknowledgement (and bottom "Done") an ended-early run gets.
    await discardResumableRun(candidate);
    router.replace({
      pathname: '/runs/[runId]',
      params: { runId: candidate.runId, celebrate: '1' },
    });
  };

  return (
    <View className="gap-8 bg-background px-6 pt-8">
      <View className="gap-2">
        <Text variant="subtitle" accessibilityRole="header">
          Resume run?
        </Text>
        <Text tone="secondary">
          {`${sessionTitle(candidate.session.key)} was interrupted. Resume to pick up where you left off, or save what you ran so far.`}
        </Text>
      </View>

      <View className="gap-3">
        <Island.Button fill label="Resume" onPress={() => void decide(true)} />
        <Island.Button
          fill
          variant="secondary"
          label="Save as Partial"
          onPress={() => void decide(false)}
        />
      </View>
    </View>
  );
}
