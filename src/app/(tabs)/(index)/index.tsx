import { Button, HStack, Image, List, Section, Spacer } from '@expo/ui/swift-ui';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';

import { Island } from '@/components/island';
import { db } from '@/db/client';
import { runCompleted } from '@/db/queries';
import { runs } from '@/db/schema';
import { formatMinutes } from '@/domain/format';
import { nextSessionKey, sessionTotalSeconds, type PlanSession } from '@/domain/plan';
import { useTheme } from '@/hooks/use-theme';
import { useActivePlan } from '@/services/active-plan';

export default function PlanScreen() {
  const router = useRouter();
  const plan = useActivePlan();
  const { data: completedRuns } = useLiveQuery(
    db.select({ sessionKey: runs.sessionKey }).from(runs).where(runCompleted),
  );

  const completedKeys = new Set(completedRuns.map((run) => run.sessionKey));
  const nextKey = nextSessionKey(plan, completedKeys);
  const weeks = [...new Set(plan.map((session) => session.week))];

  return (
    <Island>
      <List>
        {weeks.map((week) => {
          const sessions = plan.filter((session) => session.week === week);
          const done = sessions.filter((session) => completedKeys.has(session.key)).length;
          return (
            <Section key={week} title={`Week ${week} · ${done}/${sessions.length}`}>
              {sessions.map((session) => (
                <SessionRow
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

function SessionRow({
  session,
  completed,
  isNext,
  onPress,
}: {
  session: PlanSession;
  completed: boolean;
  isNext: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <Button onPress={onPress}>
      <HStack spacing={12}>
        <Island.Label
          systemImage={completed ? 'checkmark.circle.fill' : 'circle'}
          iconTone={completed ? 'primary' : 'secondary'}
          title={`Day ${session.day}`}
        />
        <Spacer />
        {isNext ? (
          // E2E escape hatch (ADR 0016): icon-only, no text to target.
          <Image
            testID={`plan-next-${session.key}`}
            systemName="arrow.forward.circle.fill"
            color={colors.primary}
            size={22}
          />
        ) : null}
        <Island.Text tone="secondary">{formatMinutes(sessionTotalSeconds(session))}</Island.Text>
      </HStack>
    </Button>
  );
}
