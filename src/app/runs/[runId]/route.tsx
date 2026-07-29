import { asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { RouteMap } from '@/components/route-map';
import { RunUnavailable } from '@/components/run-unavailable';
import { db } from '@/db/client';
import { runs, runSegments } from '@/db/schema';
import { formatDistanceKm } from '@/domain/format';
import { VIEWER_DP_EPSILON_M } from '@/domain/geo';
import { useRunRoute } from '@/hooks/use-run-route';

/** Header chrome the map does not fill; the fit only ever loosens, so an estimate is safe (spec §4.2). */
const HEADER_H = 56;

/** The full-screen, pannable/zoomable route (modal registered in `_layout`, dismissed by `router.back()`). */
export default function RunRouteScreen() {
  const { runId } = useLocalSearchParams<'/runs/[runId]/route'>();
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();

  const { data: segments, updatedAt } = useLiveQuery(
    db.select().from(runSegments).where(eq(runSegments.runId, runId)).orderBy(asc(runSegments.seq)),
    [runId],
  );
  const { data: runRows } = useLiveQuery(db.select().from(runs).where(eq(runs.id, runId)), [runId]);

  const mapHeight = frame.height - insets.top - insets.bottom - HEADER_H;
  const route = useRunRoute(runId, segments, frame.width / mapHeight, VIEWER_DP_EPSILON_M);

  if (updatedAt !== undefined && !route.ready) return <RunUnavailable unsaved={false} />;
  if (!route.ready) return <View className="flex-1 bg-background" />;

  const distance = runRows[0]?.distanceM ? formatDistanceKm(runRows[0].distanceM) : null;

  return (
    <View className="flex-1">
      {/* why: a sibling node, not an `accessible` wrapper — the wrapper would flatten MapKit's own
          elements (spec §7.1); the wording differs from the card's so that two labels live in the
          hierarchy at once without an ambiguous target (cf. §7.4's two-"Close" hazard). */}
      <View
        accessible
        accessibilityLabel={distance ? `Your ${distance} route` : 'Your route'}
        className="absolute h-px w-px"
        pointerEvents="none"
      />

      <RouteMap
        route={route.route}
        decorations={route.decorations}
        endpoints={route.endpoints}
        camera={route.camera}
        interactive
        style={{ flex: 1 }}
      />
    </View>
  );
}
