import { asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { Island } from '@/components/island';
import { RunStatGrid } from '@/components/run-stat-grid';
import { RunSummaryHeadline } from '@/components/run-summary-headline';
import { RunUnavailable } from '@/components/run-unavailable';
import { SegmentBreakdown } from '@/components/segment-breakdown';
import { SegmentSplits } from '@/components/segment-splits';
import { Footer } from '@/components/ui/footer';
import { UNSAVED_RUN_ID } from '@/constants/routes';
import { db } from '@/db/client';
import { runs, runSegments } from '@/db/schema';
import { sessionTitle } from '@/domain/format';

/**
 * The run summary, opened as a large-title modal (route config in `_layout`,
 * dismissed by its `xmark` toolbar button). A fresh finish arrives with
 * `celebrate=1` and acknowledges with a native bottom-toolbar "Done"; a Log
 * revisit omits it and shows the date. The scroll view's automatic content
 * inset lets iOS fade the summary under that toolbar and the large title — no
 * hand-drawn overlays (iOS 26 target). Data is read reactively via
 * `useLiveQuery`, the house pattern; the screen only composes.
 */
export default function RunSummaryScreen() {
  const router = useRouter();
  const { runId, celebrate } = useLocalSearchParams<'/runs/[runId]'>();
  const celebrating = celebrate === '1';

  const {
    data: runRows,
    updatedAt: runLoaded,
    error: runError,
  } = useLiveQuery(db.select().from(runs).where(eq(runs.id, runId)), [runId]);
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

  if (runId === UNSAVED_RUN_ID || failed || (loaded && !run)) {
    const unsaved = runId === UNSAVED_RUN_ID;
    return (
      <View className="flex-1 bg-background-grouped">
        <RunUnavailable unsaved={unsaved} />

        {celebrating ? (
          <Footer>
            <Island.Button fill label="Done" onPress={() => router.dismissAll()} />
          </Footer>
        ) : null}
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
            <RunStatGrid run={run} segments={segments} />
            <SegmentBreakdown segments={segments} />
            <SegmentSplits segments={segments} />
          </>
        ) : null}
      </ScrollView>

      {celebrating ? (
        <Footer>
          <Island.Button fill label="Done" onPress={() => router.dismissAll()} />
        </Footer>
      ) : null}
    </>
  );
}
