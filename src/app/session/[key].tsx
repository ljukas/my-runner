import { and, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { SegmentBar } from '@/components/segment-bar';
import { SegmentLegend } from '@/components/segment-legend';
import { StatList } from '@/components/stat-list';
import { Card } from '@/components/ui/card';
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
import { useTheme } from '@/hooks/use-theme';
import { useActivePlan } from '@/services/active-plan';
import { locationTracker } from '@/services/location-tracker';
import { runEngine } from '@/services/run-engine';

export default function SessionSheet() {
  const { key } = useLocalSearchParams<'/session/[key]'>();
  const router = useRouter();
  const colors = useTheme();
  const plan = useActivePlan();
  const session = getSession(plan, key);
  const starting = useRef(false);
  const { data: attempts, updatedAt } = useLiveQuery(
    db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.sessionKey, key), runCompleted)),
    [key],
  );

  if (!session) return <Redirect href="/" />;

  const startSession = async () => {
    // The handler is async now, so a second tap could start the run twice.
    if (starting.current) return;
    starting.current = true;
    try {
      // The just-in-time ask, reached only when the primer was skipped — the prompt is never cold
      // (ADR 0008 §2). Denial still starts the run: timer-only (§5).
      if ((await locationTracker.getPermissionStatus()) === 'undetermined') {
        await locationTracker.requestPermission();
      }
    } catch (error) {
      console.warn('[session] location ask failed', error);
    }
    // The engine's start() no-ops unless idle, so reset any prior finished run
    // here (its state lingers harmlessly until now — no screen reads it between
    // runs). This is why the summary no longer needs to reset the engine on "Done".
    runEngine.reset();
    runEngine.start(session);
    // Replace, not push: the run screen is a full-screen modal, so the session
    // sheet must leave the stack — otherwise the lingering formSheet bleeds into
    // the accessibility tree behind the run/summary modals and occludes their
    // controls (e.g. the summary's "Done").
    router.replace('/run');
  };

  return (
    <View className="gap-6 bg-background px-6 pt-8">
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

      <Island.Button fill label="Start Session" onPress={() => void startSession()} />
    </View>
  );
}
