// `UIText` is @expo/ui's SwiftUI Text — here the value side of `LabeledContent`
// rows, which SwiftUI styles natively (so it stays direct, not an `Island.Text`).
// The unqualified `Text` below is the design-system RN primitive (ADR 0013).
import { Form, LabeledContent, Section, Text as UIText } from '@expo/ui/swift-ui';
import { asc, eq } from 'drizzle-orm';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { db } from '@/db/client';
import { runSegments, runs } from '@/db/schema';
import { SEGMENT_KIND_LABEL, formatClock, sessionTitle } from '@/domain/format';
import { runEngine } from '@/services/run-engine';

type RunRow = typeof runs.$inferSelect;
type SegmentRow = typeof runSegments.$inferSelect;

export default function RunSummaryScreen() {
  const router = useRouter();
  // Read once at mount: the run screen navigates here only after the save has
  // settled, and the engine keeps the outcome until done() resets it.
  const [runId] = useState(() => runEngine.getSnapshot().savedRunId);
  const [data, setData] = useState<{ run: RunRow; segments: SegmentRow[] } | null>(null);

  useEffect(() => {
    if (!runId) return;
    void (async () => {
      const [[run], segments] = await Promise.all([
        db.select().from(runs).where(eq(runs.id, runId)),
        db
          .select()
          .from(runSegments)
          .where(eq(runSegments.runId, runId))
          .orderBy(asc(runSegments.seq)),
      ]);
      if (!run) return;
      setData({ run, segments });
    })();
  }, [runId]);

  const done = () => {
    runEngine.reset();
    router.dismissAll();
  };

  const doneButton = <Button label="Done" onPress={done} />;

  if (!runId || !data) {
    return (
      <View className="flex-1 justify-between bg-background px-6 pt-24 pb-16">
        <Text tone="secondary">
          {runId ? 'Loading…' : 'This run could not be saved. Sorry about that.'}
        </Text>
        {doneButton}
      </View>
    );
  }

  const completed = data.run.status === 'completed';

  return (
    <View className="flex-1 bg-background px-6 pt-24 pb-16">
      <Text variant="subtitle">{completed ? 'Workout complete! 🎉' : 'Good effort!'}</Text>
      <Island useViewportSizeMeasurement>
        <Form>
          <Section title="Session">
            <LabeledContent label="Session">
              <UIText>{sessionTitle(data.run.sessionKey)}</UIText>
            </LabeledContent>
            <LabeledContent label="Active time">
              <UIText>{formatClock(data.run.activeDurationS)}</UIText>
            </LabeledContent>
            {!completed ? (
              <LabeledContent label="Status">
                <UIText>Partial</UIText>
              </LabeledContent>
            ) : null}
          </Section>
          <Section title="Segments">
            {data.segments.map((segment) => (
              <LabeledContent
                key={segment.id}
                label={`${segment.seq + 1}. ${SEGMENT_KIND_LABEL[segment.kind]}${segment.wasSkipped ? ' (skipped)' : ''}`}
              >
                <UIText>{`${formatClock(segment.actualDurationS)} / ${formatClock(segment.plannedDurationS)}`}</UIText>
              </LabeledContent>
            ))}
          </Section>
        </Form>
      </Island>
      {doneButton}
    </View>
  );
}
