import { and, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { SegmentBar } from '@/components/segment-bar';
import { SegmentLegend } from '@/components/segment-legend';
import { StatList } from '@/components/stat-list';
import { Text } from '@/components/ui/text';
import { db } from '@/db/client';
import { runCompleted } from '@/db/queries';
import { runs } from '@/db/schema';
import { formatMinutes, sessionSummary, sessionTitle } from '@/domain/format';
import {
  getSession,
  sessionRunSeconds,
  sessionTotalSeconds,
  sessionWalkSeconds,
} from '@/domain/plan';
import { useActivePlan } from '@/services/active-plan';
import { runEngine } from '@/services/run-engine';

export default function SessionSheet() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const plan = useActivePlan();
  const session = getSession(plan, key);
  const { data: attempts, updatedAt } = useLiveQuery(
    db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.sessionKey, key), runCompleted)),
    [key],
  );

  if (!session) return <Redirect href="/" />;

  return (
    <View className="gap-6 bg-background px-6 pt-8 pb-8">
      <View className="gap-1.5">
        <Text variant="subtitle">{sessionTitle(session.key)}</Text>
        <Text variant="footnote" tone="secondary">
          {sessionSummary(session)}
        </Text>
      </View>
      <View className="bg-background-element gap-4 rounded-2xl p-4">
        <SegmentBar segments={session.segments} />
        <SegmentLegend segments={session.segments} />
        <View className="bg-background-selected h-px" />
        <StatList>
          <StatList.Row label="Total" value={formatMinutes(sessionTotalSeconds(session))} />
          <StatList.Row label="Running" value={formatMinutes(sessionRunSeconds(session))} />
          <StatList.Row label="Walking" value={formatMinutes(sessionWalkSeconds(session))} />
          <StatList.Row label="Completed" value={updatedAt ? `${attempts.length}×` : '—'} />
        </StatList>
      </View>
      <Island.Button
        fill
        label="Start session"
        onPress={() => {
          runEngine.start(session);
          // Replace, not push: the run screen is a full-screen modal, so the
          // session sheet must leave the stack — otherwise the lingering
          // formSheet bleeds into the accessibility tree behind the run/summary
          // modals and occludes their controls (e.g. the summary's "Done").
          router.replace('/run');
        }}
      />
    </View>
  );
}
