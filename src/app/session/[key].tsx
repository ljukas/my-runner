import { and, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { androidOnly } from '@/lib/android-only';
import { cn } from '@/lib/cn';
import { SegmentBar } from '@/components/segment-bar';
import { SegmentLegend } from '@/components/segment-legend';
import { StatList } from '@/components/stat-list';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { db } from '@/db/client';
import { runCompleted } from '@/db/queries';
import { runs } from '@/db/schema';
import { formatMinutes, sessionSummary, sessionTitle } from '@/domain/format';
import { scriptedPlan } from '@/domain/free-run';
import {
  getSession,
  sessionRunSeconds,
  sessionTotalSeconds,
  sessionWalkSeconds,
} from '@/domain/plan';
import { useRunEntry } from '@/hooks/use-run-entry';
import { useStartRun } from '@/hooks/use-start-run';
import { useTheme } from '@/hooks/use-theme';
import { useActivePlan } from '@/services/active-plan';

export default function SessionSheet() {
  const { key } = useLocalSearchParams<'/session/[key]'>();
  const colors = useTheme();
  const plan = useActivePlan();
  const session = getSession(plan, key);
  const start = useStartRun();
  const entry = useRunEntry();
  const { data: attempts, updatedAt } = useLiveQuery(
    db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.sessionKey, key), runCompleted)),
    [key],
  );

  if (!session) return <Redirect href="/" />;

  return (
    <View className={cn('gap-6 bg-background px-6 pt-8', androidOnly('pb-safe-offset-6'))}>
      <View className="gap-1.5">
        <Text variant="subtitle" accessibilityRole="header">
          {sessionTitle(session.key)}
        </Text>
        <Text variant="footnote" tone="secondary">
          {sessionSummary(session)}
        </Text>
      </View>
      <Card className="gap-4">
        <SegmentBar
          segments={session.segments}
          accessibilityLabel="Interval timeline"
          dividerColor={colors.backgroundElement}
        />
        <SegmentLegend segments={session.segments} />
        <View className="h-px bg-background-selected" />
        <StatList>
          <StatList.Row label="Total" value={formatMinutes(sessionTotalSeconds(session))} />
          <StatList.Row label="Run" value={formatMinutes(sessionRunSeconds(session))} />
          <StatList.Row label="Walk" value={formatMinutes(sessionWalkSeconds(session))} />
          <StatList.Row label="Completed" value={updatedAt ? `${attempts.length}×` : '—'} />
        </StatList>
      </Card>

      <Island.Button
        fill
        label="Start Session"
        disabled={entry.disabled}
        onPress={() => void start(scriptedPlan(session))}
      />
    </View>
  );
}
