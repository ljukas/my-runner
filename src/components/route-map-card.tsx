import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { PixelRatio, View } from 'react-native';

import { RouteMap } from '@/components/route-map';
import { RouteUnavailableCard } from '@/components/route-unavailable-card';
import { Card } from '@/components/ui/card';
import type { Run, RunSegment } from '@/db/schema';
import { formatDistanceKm } from '@/domain/format';
import { useRunRoute } from '@/hooks/use-run-route';
import { useTheme } from '@/hooks/use-theme';
import { useLocationPermission } from '@/services/location-tracker';

/** The card is a fixed 3:2 box, so its aspect ratio is known before layout (spec §4.2). */
const CARD_ASPECT_RATIO = 3 / 2;

const CHIP_SYMBOL_POINTS = 14;

/**
 * A finished run's route, camera-fitted and inert; tapping opens the full-screen viewer
 * (ADR 0013 domain component). Falls back to an explanatory card rather than rendering nothing.
 */
export function RouteMapCard({ run, segments }: { run: Run; segments: RunSegment[] }) {
  const router = useRouter();
  const colors = useTheme();
  const route = useRunRoute(run.id, segments, CARD_ASPECT_RATIO);
  // why: null until the first read resolves, and an unresolved answer must not offer a way out.
  const permission = useLocationPermission();

  if (!route.ready) {
    // why: save-run nulls summaryPolyline iff the run recorded no accepted fixes — the only per-run
    // record of the reason.
    return (
      <RouteUnavailableCard recordedFixes={run.summaryPolyline !== null} permission={permission} />
    );
  }

  const distance = run.distanceM ? formatDistanceKm(run.distanceM) : null;

  return (
    <Card surface="card" className="aspect-[3/2] overflow-hidden p-0">
      <RouteMap
        route={route.route}
        decorations={route.decorations}
        endpoints={route.endpoints}
        camera={route.camera}
        interactive={false}
        accessibilityLabel={distance ? `Map of your ${distance} route` : 'Map of your route'}
        onPress={() => router.push({ pathname: '/runs/[runId]/route', params: { runId: run.id } })}
        style={{ flex: 1 }}
      />
      {/* why: the map is inert by construction, which reads as a static image — the chip is the only
          visible cue that it opens, and the only content here at accessibility text sizes. */}
      <View
        className="absolute top-2 right-2 rounded-full bg-background-card/80 p-1.5"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <SymbolView
          name="arrow.up.left.and.arrow.down.right"
          size={Math.round(CHIP_SYMBOL_POINTS * Math.min(PixelRatio.getFontScale(), 1.6))}
          tintColor={colors.textSecondary}
        />
      </View>
    </Card>
  );
}
