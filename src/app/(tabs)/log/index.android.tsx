import { LazyColumn, ListItem, Text } from '@expo/ui/jetpack-compose';
import { background, clickable, fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { desc } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { Text as RNText } from '@/components/ui/text';
import { db } from '@/db/client';
import { runIsResult } from '@/db/queries';
import { runs } from '@/db/schema';
import { formatClock, formatDistanceKm, formatRunDate, sessionTitle } from '@/domain/format';
import { useTheme } from '@/hooks/use-theme';
import { isFieldTestRun } from '@/services/field-test';

/** See the iOS Log for why a field-test capture never reads as training. */
function rowTitle(sessionKey: string): string {
  return isFieldTestRun(sessionKey) ? 'Field test' : sessionTitle(sessionKey);
}

export default function LogScreen() {
  const router = useRouter();
  const colors = useTheme();

  const { data: visible } = useLiveQuery(
    db.select().from(runs).where(runIsResult).orderBy(desc(runs.startedAt)),
  );

  if (visible.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-background px-8">
        <SymbolView
          name={{ android: 'directions_run' }}
          size={48}
          tintColor={colors.textSecondary}
        />
        <RNText variant="title2">No runs yet</RNText>
        <RNText tone="secondary" className="text-center">
          Finish your first run and it will show up here.
        </RNText>
      </View>
    );
  }

  return (
    <Island>
      <LazyColumn
        modifiers={[fillMaxSize(), background(colors.background)]}
        contentPadding={{ top: 8, bottom: 24 }}
      >
        {visible.map((run) => {
          const details = [
            formatRunDate(run.startedAt),
            run.status === 'partial' ? 'Partial' : null,
            run.distanceM ? formatDistanceKm(run.distanceM) : null,
          ].filter((part): part is string => part !== null);
          return (
            <ListItem
              key={run.id}
              modifiers={[
                clickable(() =>
                  router.navigate({ pathname: '/runs/[runId]', params: { runId: run.id } }),
                ),
              ]}
            >
              <ListItem.HeadlineContent>
                <Text>{rowTitle(run.sessionKey)}</Text>
              </ListItem.HeadlineContent>
              <ListItem.SupportingContent>
                <Text>{details.join(' · ')}</Text>
              </ListItem.SupportingContent>
              <ListItem.TrailingContent>
                <Text>{formatClock(run.activeDurationS)}</Text>
              </ListItem.TrailingContent>
            </ListItem>
          );
        })}
      </LazyColumn>
    </Island>
  );
}
