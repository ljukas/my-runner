import { LazyColumn } from '@expo/ui/jetpack-compose';
import { background, fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';

import { Island } from '@/components/island';
import { ListSectionHeader } from '@/components/list-section-header';
import { PlanSessionRow } from '@/components/plan-session-row';
import { db } from '@/db/client';
import { runCompleted } from '@/db/queries';
import { runs } from '@/db/schema';
import { nextSessionKey } from '@/domain/plan';
import { useTheme } from '@/hooks/use-theme';
import { useActivePlan } from '@/services/active-plan';

export default function PlanScreen() {
  const router = useRouter();
  const colors = useTheme();
  const plan = useActivePlan();
  const { data: completedRuns } = useLiveQuery(
    db.select({ sessionKey: runs.sessionKey }).from(runs).where(runCompleted),
  );

  const completedKeys = new Set(completedRuns.map((run) => run.sessionKey));
  const nextKey = nextSessionKey(plan, completedKeys);
  const weeks = [...new Set(plan.map((session) => session.week))];

  return (
    <Island>
      <LazyColumn
        modifiers={[fillMaxSize(), background(colors.background)]}
        contentPadding={{ bottom: 24 }}
      >
        {weeks.flatMap((week) => {
          const sessions = plan.filter((session) => session.week === week);
          const done = sessions.filter((session) => completedKeys.has(session.key)).length;
          return [
            <ListSectionHeader
              key={`week-${week}`}
              title={`Week ${week} · ${done}/${sessions.length}`}
            />,
            ...sessions.map((session) => (
              <PlanSessionRow
                key={session.key}
                session={session}
                completed={completedKeys.has(session.key)}
                isNext={session.key === nextKey}
                onPress={() => router.push(`/session/${session.key}`)}
              />
            )),
          ];
        })}
      </LazyColumn>
    </Island>
  );
}
