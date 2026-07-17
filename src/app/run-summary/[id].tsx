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
import { SegmentColors } from '@/constants/theme';
import { db } from '@/db/client';
import { runSegments, runs } from '@/db/schema';
import { clockParts, formatRunDate, sessionTitle } from '@/domain/format';
import { runStats } from '@/domain/run-stats';
import { useTheme } from '@/hooks/use-theme';

type RunRow = typeof runs.$inferSelect;
type SegmentRow = typeof runSegments.$inferSelect;
type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; run: RunRow; segments: SegmentRow[] };

/**
 * A dynamic segment can't be empty, so a failed save routes here with this
 * sentinel instead of a run id (run ids are UUIDs — no collision). The screen
 * renders it as the save-failure apology without querying.
 */
export const UNSAVED_RUN_ID = 'unsaved';

export default function RunSummaryScreen() {
  const router = useRouter();
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { id, celebrate } = useLocalSearchParams<'/run-summary/[id]'>();
  // A fresh finish is acknowledged with the bottom "Done"; a Log revisit is a
  // browse, so it gets a header Back button instead (and no Done).
  const isRevisit = celebrate !== '1';
  const [state, setState] = useState<LoadState>(() => {
    return id === UNSAVED_RUN_ID ? { status: 'missing' } : { status: 'loading' };
  });

  useEffect(() => {
    if (id === UNSAVED_RUN_ID) return;
    let active = true;
    (async () => {
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
    })().catch(() => {
      if (active) {
        setState({ status: 'missing' });
      }
    });
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
        {id === UNSAVED_RUN_ID
          ? 'This run could not be saved. Sorry about that.'
          : "This run isn't available."}
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
        <View className="gap-0.5">
          <View className="flex-row items-center justify-between">
            <Text variant="largeTitle">{sessionTitle(run.sessionKey)}</Text>
            <Badge
              className="bg-background-card"
              tone={completed ? 'positive' : 'neutral'}
              label={completed ? 'Completed' : 'Partial'}
            />
          </View>
          <Text tone="secondary">{formatRunDate(run.startedAt)}</Text>
        </View>
        <StatGrid>
          <StatGrid.Tile
            icon="figure.run"
            color={SegmentColors.run}
            label="Running"
            {...clockParts(stats.timeRunningS)}
          />
          <StatGrid.Tile
            icon="repeat"
            color={SegmentColors.warmup}
            label="Intervals"
            value={String(stats.runIntervals)}
            unit="runs"
          />
          <StatGrid.Tile
            icon="stopwatch.fill"
            color={SegmentColors.cooldown}
            label="Active Time"
            {...clockParts(run.activeDurationS)}
          />
          <StatGrid.Tile
            icon="trophy.fill"
            color={SegmentColors.walk}
            label="Longest Run"
            {...clockParts(stats.longestRunS)}
          />
        </StatGrid>
        <Card surface="card" className="gap-3">
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
      className="flex-1 bg-background-grouped px-6"
      style={{
        paddingTop: insets.top + (isRevisit ? 12 : 24),
        paddingBottom: insets.bottom + 16,
      }}
    >
      {isRevisit ? (
        <View className="mb-4 flex-row">
          <Island matchContents>
            <Island.IconButton
              systemName="chevron.backward"
              size={22}
              color={colors.text}
              label="Back"
              onPress={() => router.back()}
            />
          </Island>
        </View>
      ) : null}
      {content}
      {isRevisit ? null : (
        <View className="mt-auto pt-6">
          <Island.Button fill label="Done" onPress={() => router.dismissAll()} />
        </View>
      )}
    </View>
  );
}
