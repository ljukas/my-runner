import { and, asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { HealthStatusRow } from '@/components/health-status-row';
import { RouteMapCard } from '@/components/route-map-card';
import { RunProfileCard } from '@/components/run-profile-card';
import { RunStatGrid } from '@/components/run-stat-grid';
import { RunSummaryHeadline } from '@/components/run-summary-headline';
import { RunUnavailable } from '@/components/run-unavailable';
import { SegmentBreakdown } from '@/components/segment-breakdown';
import { SegmentSplits } from '@/components/segment-splits';
import { UNSAVED_RUN_ID } from '@/constants/routes';
import { db } from '@/db/client';
import { runNotDeleted } from '@/db/queries';
import { runs, runSegments } from '@/db/schema';
import { sessionTitle } from '@/domain/format';
import { useRunTrack } from '@/hooks/use-run-track';

/**
 * The run summary, opened as a large-title modal (route config in `_layout`,
 * dismissed by its `xmark` toolbar button or a swipe down — no in-content
 * acknowledgement). A fresh finish arrives with `celebrate=1` and gets the
 * congratulatory headline; a Log revisit shows the date instead. The scroll
 * view's automatic content inset lets iOS fade the summary under the large
 * title — no hand-drawn overlays (iOS 26 target). Data is read reactively via
 * `useLiveQuery`, the house pattern; the screen only composes.
 */
export default function RunSummaryScreen() {
  const { runId, celebrate } = useLocalSearchParams<'/runs/[runId]'>();
  const celebrating = celebrate === '1';

  const {
    data: runRows,
    updatedAt: runLoaded,
    error: runError,
  } = useLiveQuery(
    db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), runNotDeleted)),
    [runId],
  );
  const {
    data: segments,
    updatedAt: segmentsLoaded,
    error: segmentsError,
  } = useLiveQuery(
    db.select().from(runSegments).where(eq(runSegments.runId, runId)).orderBy(asc(runSegments.seq)),
    [runId],
  );

  const run = runRows[0];
  const loaded = runLoaded !== undefined && segmentsLoaded !== undefined;
  const failed = runError !== undefined || segmentsError !== undefined;

  // why the screen owns this: the route and the pace cards derive from the same `run_points` read,
  // and hoisting it is what keeps the modal's first frame to one such read (and the two cards to
  // one readiness answer).
  const track = useRunTrack(runId, segments, loaded);

  if (runId === UNSAVED_RUN_ID || failed || (loaded && !run)) {
    return (
      <View className="flex-1 bg-background-grouped">
        <RunUnavailable reason={runId === UNSAVED_RUN_ID ? 'unsaved' : 'missing'} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: run ? sessionTitle(run.sessionKey) : '' }} />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="bg-background-grouped"
        contentContainerClassName="gap-4 px-4"
      >
        {loaded && run ? (
          <>
            <RunSummaryHeadline run={run} celebrate={celebrating} />
            <RouteMapCard run={run} track={track} />
            <RunStatGrid run={run} segments={segments} />
            <RunProfileCard run={run} track={track} />
            <SegmentBreakdown segments={segments} />
            <SegmentSplits segments={segments} />
            <HealthStatusRow run={run} />
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
