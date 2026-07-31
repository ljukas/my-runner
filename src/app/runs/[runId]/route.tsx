import { and, asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaFrame } from 'react-native-safe-area-context';

import { RouteMap } from '@/components/route-map';
import { RunUnavailable } from '@/components/run-unavailable';
import { db } from '@/db/client';
import { runNotDeleted } from '@/db/queries';
import { runs, runSegments } from '@/db/schema';
import { formatDistanceKm } from '@/domain/format';
import { VIEWER_DP_EPSILON_M } from '@/domain/geo';
import { useRunRoute } from '@/hooks/use-run-route';

/** The full-screen, pannable/zoomable route (modal registered in `_layout`, dismissed by `router.back()`). */
export default function RunRouteScreen() {
  const { runId } = useLocalSearchParams<'/runs/[runId]/route'>();
  const frame = useSafeAreaFrame();

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
  // why: both queries, not just the segments' — the a11y label below reads the run row, and gating on
  // one of the two lets VoiceOver announce the route without its distance and then correct itself.
  const loaded = runLoaded !== undefined && segmentsLoaded !== undefined;
  const failed = runError !== undefined || segmentsError !== undefined;

  const route = useRunRoute(runId, segments, loaded, VIEWER_DP_EPSILON_M);

  if (failed || (loaded && !run)) return <RunUnavailable reason="missing" />;
  if (!loaded) return <View className="flex-1 bg-background" />;
  // why: a real run with nothing drawable is not a missing one. Deep links and state restoration both
  // reach this screen for a treadmill run, which the summary explains with RouteUnavailableCard.
  if (!route.ready) return <RunUnavailable reason="no-route" />;

  const distance = run?.distanceM != null ? formatDistanceKm(run.distanceM) : null;

  return (
    <View className="flex-1">
      {/* why: in flow ABOVE the map, never over it — RN overlapping an ExpoSwiftUI host loses the very
          a11y identity this node exists for (ADR 0005); `accessible` on the wrapper flattens the map
          instead (spec §7.1). */}
      <View
        accessible
        accessibilityLabel={distance ? `Your ${distance} route` : 'Your route'}
        className="h-px"
        pointerEvents="none"
      />

      <RouteMap
        route={route.route}
        endpoints={route.endpoints}
        bbox={route.bbox}
        aspectRatio={frame.width / frame.height}
        interactive
        style={{ flex: 1 }}
      />
    </View>
  );
}
