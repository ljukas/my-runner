import { useMemo } from 'react';

import type { RunSegment } from '@/db/schema';
import { loadRunFixes } from '@/db/run-points';
import {
  boundingBox,
  boundingBoxDiagonalM,
  DP_EPSILON_M,
  MIN_ROUTE_EXTENT_M,
  smoothTrackForRender,
  toSegmentPolylines,
  type BoundingBox,
  type LatLng,
} from '@/domain/geo';
import { toRouteLines } from '@/domain/route-render';
import type { RouteMapRoute } from '@/components/route-map/port';
import { useSegmentColors } from '@/hooks/use-theme';

export type RunRoute =
  | { ready: false }
  | {
      ready: true;
      bbox: BoundingBox;
      route: RouteMapRoute;
      endpoints: { start: LatLng; finish: LatLng };
    };

/**
 * A finished run's drawable route. Reads `run_points` ONCE, non-reactively — never via `useLiveQuery`
 * (ADR 0004 §3) — and re-derives geometry with the same smoother the distance used (ADR 0021 §3).
 * `segments` comes from the caller's live query; the hook only needs the segmentSeq → kind join.
 * `loaded` is the caller's `updatedAt !== undefined` — a run with zero `run_segments` rows is still
 * a real, routeable run (save-run skips the insert then), so readiness needs `loaded`, not `segments.length`.
 */
export function useRunRoute(
  runId: string,
  segments: readonly RunSegment[],
  loaded: boolean,
  epsilon = DP_EPSILON_M,
): RunRoute {
  // why: keyed on neither the viewport nor the palette, so a rotation, a keyboard, the modal
  // settling, or a light/dark switch never re-runs the ~1800-row read and refold.
  const geometry = useMemo(() => {
    if (!loaded) return null;
    try {
      const points = smoothTrackForRender(loadRunFixes(runId));
      const chunks = toSegmentPolylines(points, epsilon);
      if (chunks.length === 0) return null;

      // why: over what is DRAWN, not every render point — a dropped chunk's outlier is off-screen and
      // must widen neither the readiness gate nor the camera.
      const bbox = boundingBox(chunks.flatMap((chunk) => chunk.points));
      // why: toSegmentPolylines drops chunks under 2 points, so bbox is never null here.
      if (boundingBoxDiagonalM(bbox!) < MIN_ROUTE_EXTENT_M) return null;

      return {
        bbox: bbox!,
        chunks,
        endpoints: {
          start: chunks[0].points[0],
          finish: chunks.at(-1)!.points.at(-1)!,
        },
      };
    } catch (error) {
      // why: no ErrorBoundary wraps this route; a SQLite read failure must degrade to the
      // fallback card, not crash render.
      console.warn('[use-run-route] geometry load failed; showing the fallback', error);
      return null;
    }
  }, [runId, loaded, epsilon]);

  const segmentColors = useSegmentColors();

  return useMemo(() => {
    if (!geometry) return { ready: false };

    return {
      ready: true,
      bbox: geometry.bbox,
      endpoints: geometry.endpoints,
      route: { lines: toRouteLines(geometry.chunks, segments, segmentColors) },
    };
  }, [geometry, segments, segmentColors]);
}
