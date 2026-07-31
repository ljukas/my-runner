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
  // why: the caller (runs/[runId]/index) only mounts this card once its own live query has loaded.
  const route = useRunRoute(run.id, segments, true);
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

  const openViewer = () =>
    router.push({ pathname: '/runs/[runId]/route', params: { runId: run.id } });

  // why min-h: an ExpoSwiftUI host that mounts at height 0 renders blank and never re-measures, and
  // `aspect-[3/2]` was the sole height source — the narrowed cause of the card missing on a fresh
  // iOS 17.5 process's first views. A floor removes the whole zero-height class.
  return (
    <Card surface="card" className="aspect-[3/2] min-h-[100px] overflow-hidden p-0">
      <RouteMap
        route={route.route}
        endpoints={route.endpoints}
        bbox={route.bbox}
        aspectRatio={CARD_ASPECT_RATIO}
        interactive={false}
        accessibilityLabel={distance ? `Map of your ${distance} route` : 'Map of your route'}
        onPress={openViewer}
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
