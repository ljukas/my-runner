import { LazyColumn } from '@expo/ui/jetpack-compose';
import { background, fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';

import { Island } from '@/components/island';
import { ListSectionHeader } from '@/components/list-section-header';
import { PlanSessionRow } from '@/components/plan-session-row';
import { weekTitle } from '@/domain/plan-progress';
import { usePlanProgress } from '@/hooks/use-plan-progress';
import { useRunEntry } from '@/hooks/use-run-entry';
import { useTheme } from '@/hooks/use-theme';

export default function PlanScreen() {
  const colors = useTheme();
  const progress = usePlanProgress();
  const entry = useRunEntry();

  return (
    <Island>
      <LazyColumn
        modifiers={[fillMaxSize(), background(colors.background)]}
        contentPadding={{ bottom: 24 }}
      >
        {progress.weeks.flatMap((week) => [
          <ListSectionHeader key={`week-${week.week}`} title={weekTitle(week)} />,
          ...week.sessions.map((session) => (
            <PlanSessionRow
              key={session.key}
              session={session}
              completed={progress.completed.has(session.key)}
              isNext={session.key === progress.next?.key}
              disabled={entry.disabled}
              onPress={() => entry.openSession(session.key)}
            />
          )),
        ])}
      </LazyColumn>
    </Island>
  );
}
