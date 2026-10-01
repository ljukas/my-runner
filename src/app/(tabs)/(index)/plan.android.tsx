import { Box, LazyColumn } from '@expo/ui/jetpack-compose';
import { background, fillMaxSize, padding } from '@expo/ui/jetpack-compose/modifiers';

import { Island } from '@/components/island';
import { ListSectionHeader } from '@/components/list-section-header';
import { PlanSessionRow } from '@/components/plan-session-row';
import { RunNoticeRow } from '@/components/run-notice-row';
import { weekTitle } from '@/domain/plan-progress';
import { usePlanProgress } from '@/hooks/use-plan-progress';
import { useRunEntry } from '@/hooks/use-run-entry';
import { useTheme } from '@/hooks/use-theme';
import { useRunNotice } from '@/services/run-notice/use-run-notice';

export default function PlanScreen() {
  const colors = useTheme();
  const progress = usePlanProgress();
  const entry = useRunEntry();
  const notice = useRunNotice();

  return (
    <Island>
      <LazyColumn
        modifiers={[fillMaxSize(), background(colors.background)]}
        contentPadding={{ bottom: 24 }}
      >
        {notice ? (
          <Box modifiers={[padding(12, 16, 12, 0)]}>
            <RunNoticeRow notice={notice} />
          </Box>
        ) : null}
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
