import { List, Section } from '@expo/ui/swift-ui';

import { Island } from '@/components/island';
import { PlanSessionRow } from '@/components/plan-session-row';
import { RunNoticeRow } from '@/components/run-notice-row';
import { weekTitle } from '@/domain/plan-progress';
import { usePlanProgress } from '@/hooks/use-plan-progress';
import { useRunEntry } from '@/hooks/use-run-entry';
import { useRunNotice } from '@/services/run-notice/use-run-notice';

export default function PlanScreen() {
  const progress = usePlanProgress();
  const entry = useRunEntry();
  const notice = useRunNotice();

  return (
    <Island>
      <List>
        {notice ? (
          <Section>
            <RunNoticeRow notice={notice} />
          </Section>
        ) : null}
        {progress.weeks.map((week) => (
          <Section key={week.week} title={weekTitle(week)}>
            {week.sessions.map((session) => (
              <PlanSessionRow
                key={session.key}
                session={session}
                completed={progress.completed.has(session.key)}
                isNext={session.key === progress.next?.key}
                disabled={entry.disabled}
                onPress={() => entry.openSession(session.key)}
              />
            ))}
          </Section>
        ))}
      </List>
    </Island>
  );
}
