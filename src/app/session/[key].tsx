import { Button, Host } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, tint } from '@expo/ui/swift-ui/modifiers';
import { and, eq, isNull } from 'drizzle-orm';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { SegmentBar } from '@/components/segment-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { db } from '@/db/client';
import { runs } from '@/db/schema';
import { formatMinutes, sessionTitle } from '@/domain/format';
import { getSession, sessionTotalSeconds } from '@/domain/plan';
import { useTheme } from '@/hooks/use-theme';
import { useActivePlan } from '@/services/active-plan';
import { runEngine } from '@/services/run-engine';

export default function SessionSheet() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const plan = useActivePlan();
  const colors = useTheme();
  const session = getSession(plan, key);
  const [attempts, setAttempts] = useState<number | null>(null);

  useEffect(() => {
    db.select()
      .from(runs)
      .where(and(eq(runs.sessionKey, key), eq(runs.status, 'completed'), isNull(runs.deletedAt)))
      .then((rows) => setAttempts(rows.length))
      .catch(() => setAttempts(null));
  }, [key]);

  if (!session) return <Redirect href="/" />;

  const runSeconds = session.segments
    .filter((segment) => segment.kind === 'run')
    .reduce((sum, segment) => sum + segment.seconds, 0);

  return (
    <ThemedView className="flex-1 gap-6 px-6 pt-8">
      <ThemedText type="subtitle">{sessionTitle(session.key)}</ThemedText>
      <SegmentBar segments={session.segments} testID="session-segment-bar" />
      <View className="gap-2">
        <StatRow label="Total" value={formatMinutes(sessionTotalSeconds(session))} />
        <StatRow label="Running" value={formatMinutes(runSeconds)} />
        <StatRow label="Completed" value={attempts === null ? '—' : `${attempts}×`} />
      </View>
      <Host matchContents>
        <Button
          testID="session-start"
          label="Start session"
          onPress={() => {
            runEngine.start(session);
            router.push('/run');
          }}
          modifiers={[buttonStyle('borderedProminent'), controlSize('large'), tint(colors.primary)]}
        />
      </Host>
    </ThemedView>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <ThemedText themeColor="textSecondary">{label}</ThemedText>
      <ThemedText>{value}</ThemedText>
    </View>
  );
}
