import { Form, Host, LabeledContent, Section, Text } from '@expo/ui/swift-ui';
import { asc, eq } from 'drizzle-orm';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { db } from '@/db/client';
import { runSegments, runs } from '@/db/schema';
import { formatClock, sessionTitle } from '@/domain/format';
import { runEngine } from '@/services/run-engine';

type RunRow = typeof runs.$inferSelect;
type SegmentRow = typeof runSegments.$inferSelect;

const KIND_LABEL = { warmup: 'Warm up', run: 'Run', walk: 'Walk', cooldown: 'Cool down' } as const;

export default function RunSummaryScreen() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const [data, setData] = useState<{ run: RunRow; segments: SegmentRow[] } | null>(null);

  useEffect(() => {
    if (!runId) return;
    (async () => {
      const [run] = await db.select().from(runs).where(eq(runs.id, runId));
      if (!run) return;
      const segments = await db
        .select()
        .from(runSegments)
        .where(eq(runSegments.runId, runId))
        .orderBy(asc(runSegments.seq));
      setData({ run, segments });
    })();
  }, [runId]);

  const done = () => {
    runEngine.reset();
    router.dismissAll();
  };

  const doneButton = (
    <Pressable testID="summary-done" onPress={done} className="items-center rounded-full bg-primary py-4">
      <ThemedText className="text-white">Done</ThemedText>
    </Pressable>
  );

  if (!runId || !data) {
    return (
      <ThemedView className="flex-1 justify-between px-6 pb-16 pt-24">
        <ThemedText themeColor="textSecondary">
          {runId ? 'Loading…' : 'This run could not be saved. Sorry about that.'}
        </ThemedText>
        {doneButton}
      </ThemedView>
    );
  }

  const completed = data.run.status === 'completed';

  return (
    <ThemedView className="flex-1 px-6 pb-16 pt-24">
      <ThemedText type="subtitle">{completed ? 'Workout complete! 🎉' : 'Good effort!'}</ThemedText>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title="Session">
            <LabeledContent label="Session">
              <Text>{sessionTitle(data.run.sessionKey)}</Text>
            </LabeledContent>
            <LabeledContent label="Active time">
              <Text>{formatClock(data.run.activeDurationS)}</Text>
            </LabeledContent>
            {!completed ? (
              <LabeledContent label="Status">
                <Text>Partial</Text>
              </LabeledContent>
            ) : null}
          </Section>
          <Section title="Segments">
            {data.segments.map((segment) => (
              <LabeledContent
                key={segment.id}
                label={`${segment.seq + 1}. ${KIND_LABEL[segment.kind]}${segment.wasSkipped ? ' (skipped)' : ''}`}>
                <Text>{`${formatClock(segment.actualDurationS)} / ${formatClock(segment.plannedDurationS)}`}</Text>
              </LabeledContent>
            ))}
          </Section>
        </Form>
      </Host>
      {doneButton}
    </ThemedView>
  );
}
