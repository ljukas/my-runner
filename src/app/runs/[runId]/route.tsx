import { asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaFrame } from 'react-native-safe-area-context';

import { RouteMap } from '@/components/route-map';
import { RunUnavailable } from '@/components/run-unavailable';
import { db } from '@/db/client';
import { runs, runSegments } from '@/db/schema';
import { formatDistanceKm } from '@/domain/format';
import { VIEWER_DP_EPSILON_M } from '@/domain/geo';
import { useRunRoute } from '@/hooks/use-run-route';

/** The full-screen, pannable/zoomable route (modal registered in `_layout`, dismissed by `router.back()`). */
export default function RunRouteScreen() {
  const { runId } = useLocalSearchParams<'/runs/[runId]/route'>();
  const frame = useSafeAreaFrame();

  const { data: segments, updatedAt } = useLiveQuery(
    db.select().from(runSegments).where(eq(runSegments.runId, runId)).orderBy(asc(runSegments.seq)),
    [runId],
  );
  const { data: runRows } = useLiveQuery(db.select().from(runs).where(eq(runs.id, runId)), [runId]);

  // why: full frame height under-estimates the aspect ratio, so cameraForBoundingBox only ever
  // requests MORE span than the true fit needs (spec §4.2) — the route can never clip.
  const route = useRunRoute(
    runId,
    segments,
    updatedAt !== undefined,
    frame.width / frame.height,
    VIEWER_DP_EPSILON_M,
  );

  if (updatedAt !== undefined && !route.ready) return <RunUnavailable unsaved={false} />;
  if (!route.ready) return <View className="flex-1 bg-background" />;

  const distance = runRows[0]?.distanceM ? formatDistanceKm(runRows[0].distanceM) : null;

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
        camera={route.camera}
        interactive
        style={{ flex: 1 }}
      />
    </View>
  );
}
