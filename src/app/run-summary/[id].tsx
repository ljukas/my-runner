import { ContentUnavailableView } from '@expo/ui/swift-ui';
import { asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { Island } from '@/components/island';
import { RunStatGrid } from '@/components/run-stat-grid';
import { RunSummaryHeadline } from '@/components/run-summary-headline';
import { SegmentBreakdown } from '@/components/segment-breakdown';
import { db } from '@/db/client';
import { runs, runSegments } from '@/db/schema';
import { sessionTitle } from '@/domain/format';

/**
 * A dynamic segment can't be empty, so a failed save routes here with this
 * sentinel instead of a run id (run ids are UUIDs — no collision). The screen
 * renders it as the save-failure apology without a matching row.
 */
export const UNSAVED_RUN_ID = 'unsaved';

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
  const { width } = useWindowDimensions();
  const { id, celebrate } = useLocalSearchParams<'/run-summary/[id]'>();
  const celebrating = celebrate === '1';

  const {
    data: runRows,
    updatedAt: runLoaded,
    error: runError,
  } = useLiveQuery(db.select().from(runs).where(eq(runs.id, id)), [id]);
  const {
    data: segments,
    updatedAt: segmentsLoaded,
    error: segmentsError,
  } = useLiveQuery(
    db.select().from(runSegments).where(eq(runSegments.runId, id)).orderBy(asc(runSegments.seq)),
    [id],
  );

  const run = runRows[0];
  const loaded = runLoaded !== undefined && segmentsLoaded !== undefined;
  const failed = runError !== undefined || segmentsError !== undefined;

  // The bottom "Done" acknowledges a fresh finish; a revisit dismisses via the
  // header xmark. A native bottom toolbar so iOS owns the placement and the
  // scroll-edge fade; a full-width filled CTA hosted in the toolbar's custom
  // view (an explicit width — the RN host has no intrinsic one). Shared by the
  // summary and the edge states so the save-failure apology (which also arrives
  // celebrating) keeps its CTA.
  const doneToolbar = celebrating ? (
    <Stack.Toolbar placement="bottom">
      {/* hidesSharedBackground drops the toolbar's glass capsule so only our
          filled CTA shows; the width matches the session sheet's px-6 inset. */}
      <Stack.Toolbar.View hidesSharedBackground>
        <View style={{ width: width - 48 }} className="pb-6">
          <Island.Button fill label="Done" onPress={() => router.dismissAll()} />
        </View>
      </Stack.Toolbar.View>
    </Stack.Toolbar>
  ) : null;

  // Edge states: the save-failure sentinel (synchronous — no row to wait for), a
  // read error, or an id with no matching run. The session title only exists for
  // a real run, so the header title clears here.
  if (id === UNSAVED_RUN_ID || failed || (loaded && !run)) {
    const unsaved = id === UNSAVED_RUN_ID;
    return (
      <>
        <Stack.Screen options={{ title: '' }}>{doneToolbar}</Stack.Screen>

        <View className="flex-1 bg-background-grouped">
          <Island>
            <ContentUnavailableView
              title={unsaved ? 'Run not saved' : 'Run unavailable'}
              systemImage={unsaved ? 'exclamationmark.triangle' : 'questionmark.circle'}
              description={
                unsaved
                  ? 'This run could not be saved. Sorry about that.'
                  : "This run isn't available."
              }
            />
          </Island>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: run ? sessionTitle(run.sessionKey) : '' }}>
        {doneToolbar}
      </Stack.Screen>

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
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
