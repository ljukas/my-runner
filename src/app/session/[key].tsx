import { Button, Host } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, tint } from '@expo/ui/swift-ui/modifiers';
import { and, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { SegmentBar } from '@/components/segment-bar';
import { Text } from '@/components/ui/text';
import { db } from '@/db/client';
import { runCompleted } from '@/db/queries';
import { runs } from '@/db/schema';
import { formatMinutes, sessionTitle } from '@/domain/format';
import { getSession, sessionRunSeconds, sessionTotalSeconds } from '@/domain/plan';
import { useTheme } from '@/hooks/use-theme';
import { useActivePlan } from '@/services/active-plan';
import { runEngine } from '@/services/run-engine';

export default function SessionSheet() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const plan = useActivePlan();
  const colors = useTheme();
  const session = getSession(plan, key);
  const { data: attempts, updatedAt } = useLiveQuery(
    db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.sessionKey, key), runCompleted)),
    [key],
  );

  if (!session) return <Redirect href="/" />;

  return (
    <View className="flex-1 gap-6 bg-background px-6 pt-8">
      <Text variant="subtitle">{sessionTitle(session.key)}</Text>
      <SegmentBar segments={session.segments} />
      <View className="gap-2">
        <StatRow label="Total" value={formatMinutes(sessionTotalSeconds(session))} />
        <StatRow label="Running" value={formatMinutes(sessionRunSeconds(session))} />
        <StatRow label="Completed" value={updatedAt ? `${attempts.length}×` : '—'} />
      </View>
      <Host matchContents>
        <Button
          label="Start session"
          onPress={() => {
            runEngine.start(session);
            router.push('/run');
          }}
          modifiers={[buttonStyle('borderedProminent'), controlSize('large'), tint(colors.primary)]}
        />
      </Host>
    </View>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <Text tone="secondary">{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}
