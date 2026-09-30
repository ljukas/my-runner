import { List, Section } from '@expo/ui/swift-ui';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';

import { Island } from '@/components/island';
import { PlanSessionRow } from '@/components/plan-session-row';
import { RunNoticeRow } from '@/components/run-notice-row';
import { db } from '@/db/client';
import { runCompleted } from '@/db/queries';
import { runs } from '@/db/schema';
import { nextSessionKey } from '@/domain/plan';
import { useActivePlan } from '@/services/active-plan';
import { useRunNotice } from '@/services/run-notice/use-run-notice';

export default function PlanScreen() {
  const router = useRouter();
  const plan = useActivePlan();
  const notice = useRunNotice();
  const { data: completedRuns } = useLiveQuery(
    db.select({ sessionKey: runs.sessionKey }).from(runs).where(runCompleted),
  );

  const completedKeys = new Set(completedRuns.map((run) => run.sessionKey));
  const nextKey = nextSessionKey(plan, completedKeys);
  const weeks = [...new Set(plan.map((session) => session.week))];

  return (
    <Island>
      <List>
        <RunNoticeRow notice={notice} />
        {weeks.map((week) => {
          const sessions = plan.filter((session) => session.week === week);
          const done = sessions.filter((session) => completedKeys.has(session.key)).length;
          return (
            <Section key={week} title={`Week ${week} · ${done}/${sessions.length}`}>
              {sessions.map((session) => (
                <PlanSessionRow
                  key={session.key}
                  session={session}
                  completed={completedKeys.has(session.key)}
                  isNext={session.key === nextKey}
                  onPress={() => router.push(`/session/${session.key}`)}
                />
              ))}
            </Section>
          );
        })}
      </List>
    </Island>
  );
}
