import { Button, HStack, Host, Image, List, Section, Spacer, Text } from '@expo/ui/swift-ui';
import { foregroundColor } from '@expo/ui/swift-ui/modifiers';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';

import { db } from '@/db/client';
import { runs } from '@/db/schema';
import { formatMinutes } from '@/domain/format';
import { nextSessionKey, sessionTotalSeconds, type PlanSession } from '@/domain/plan';
import { useTheme } from '@/hooks/use-theme';
import { useActivePlan } from '@/services/active-plan';

export default function PlanScreen() {
  const router = useRouter();
  const plan = useActivePlan();
  const { data: allRuns } = useLiveQuery(db.select().from(runs));

  const completedKeys = new Set(
    (allRuns ?? [])
      .filter((run) => run.status === 'completed' && !run.deletedAt)
      .map((run) => run.sessionKey),
  );
  const nextKey = nextSessionKey(plan, completedKeys);
  const weeks = [...new Set(plan.map((session) => session.week))];

  return (
    <Host style={{ flex: 1 }}>
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
    </Host>
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
    <Button testID={`plan-row-${session.key}`} onPress={onPress}>
      <HStack spacing={12}>
        <Image
          systemName={completed ? 'checkmark.circle.fill' : 'circle'}
          color={completed ? colors.primary : colors.textSecondary}
          size={22}
        />
        <Text modifiers={[foregroundColor(colors.text)]}>{`Day ${session.day}`}</Text>
        <Spacer />
        {isNext ? (
          <Image
            testID={`plan-next-${session.key}`}
            systemName="arrow.forward.circle.fill"
            color={colors.primary}
            size={22}
          />
        ) : null}
        <Text modifiers={[foregroundColor(colors.textSecondary)]}>
          {formatMinutes(sessionTotalSeconds(session))}
        </Text>
      </HStack>
    </Button>
  );
}
