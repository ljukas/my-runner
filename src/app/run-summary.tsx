import { asc, eq } from 'drizzle-orm';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Island } from '@/components/island';
import { SegmentBar } from '@/components/segment-bar';
import { SegmentLegend } from '@/components/segment-legend';
import { StatGrid } from '@/components/stat-grid';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { db } from '@/db/client';
import { runSegments, runs } from '@/db/schema';
import { formatClock, formatRunDate, sessionTitle } from '@/domain/format';
import { runStats } from '@/domain/run-stats';

type RunRow = typeof runs.$inferSelect;
type SegmentRow = typeof runSegments.$inferSelect;
type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; run: RunRow; segments: SegmentRow[] };

export default function RunSummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, celebrate } = useLocalSearchParams<{ id?: string; celebrate?: string }>();
  const [state, setState] = useState<LoadState>(() => {
    return !id ? { status: 'missing' } : { status: 'loading' };
  });

  useEffect(() => {
    if (!id) return;
    let active = true;
    void (async () => {
      const [[run], segments] = await Promise.all([
        db.select().from(runs).where(eq(runs.id, id)),
        db
          .select()
          .from(runSegments)
          .where(eq(runSegments.runId, id))
          .orderBy(asc(runSegments.seq)),
      ]);
      if (!active) return;
      setState(run ? { status: 'ready', run, segments } : { status: 'missing' });
    })();
    return () => {
      active = false;
    };
  }, [id]);

  let content: ReactNode;
  if (state.status === 'loading') {
    content = <Text tone="secondary">Loading…</Text>;
  } else if (state.status === 'missing') {
    content = (
      <Text tone="secondary">
        {id ? "This run isn't available." : 'This run could not be saved. Sorry about that.'}
      </Text>
    );
  } else {
    const { run, segments } = state;
    const completed = run.status === 'completed';
    const stats = runStats(segments);
    const barSegments = segments.map((s) => ({ kind: s.kind, seconds: s.actualDurationS }));
    content = (
      <View className="gap-4">
        {celebrate === '1' ? (
          <Text variant="smallBold" tone="primary">
            {completed ? 'Nice work! 🎉' : 'Good effort! 💪'}
          </Text>
        ) : null}
        <View className="flex-row items-start justify-between">
          <View className="gap-0.5">
            <Text variant="largeTitle">{sessionTitle(run.sessionKey)}</Text>
            <Text tone="secondary">{formatRunDate(run.startedAt)}</Text>
          </View>
          <Badge
            tone={completed ? 'positive' : 'neutral'}
            label={completed ? 'Completed' : 'Partial'}
          />
        </View>
        <StatGrid>
          <StatGrid.Tile label="Time running" value={formatClock(stats.timeRunningS)} />
          <StatGrid.Tile label="Run intervals" value={String(stats.runIntervals)} />
          <StatGrid.Tile label="Active time" value={formatClock(run.activeDurationS)} />
          <StatGrid.Tile label="Longest run" value={formatClock(stats.longestRunS)} />
        </StatGrid>
        <Card className="gap-3">
          <SegmentBar segments={barSegments} />
          <SegmentLegend segments={barSegments} />
        </Card>
      </View>
    );
  }

  // SwiftUI Island.Button (not an RN pill): an RN Pressable below an Island host
  // is painted but dropped from the a11y tree (host frame occludes it), leaving
  // "Done" invisible to VoiceOver and Maestro. `fill` brings its own sized host.
  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      {content}
      <View className="mt-auto pt-6">
        <Island.Button fill label="Done" onPress={() => router.dismissAll()} />
      </View>
    </View>
  );
}
