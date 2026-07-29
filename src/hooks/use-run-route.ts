import { useMemo } from 'react';

import { CHEVRON_STROKE_W } from '@/constants/theme';
import type { RunSegment } from '@/db/schema';
import { loadRunFixes } from '@/db/run-points';
import {
  boundingBox,
  boundingBoxDiagonalM,
  cameraForBoundingBox,
  chevronsAlongRoute,
  DP_EPSILON_M,
  MIN_ROUTE_EXTENT_M,
  smoothTrackForRender,
  toSegmentPolylines,
  type CameraFit,
  type LatLng,
} from '@/domain/geo';
import { toRouteLines } from '@/domain/route-render';
import type { RouteMapDecoration, RouteMapRoute } from '@/components/route-map';
import { useRouteDirectionColor, useSegmentColors } from '@/hooks/use-theme';

export type RunRoute =
  | { ready: false }
  | {
      ready: true;
      camera: CameraFit;
      route: RouteMapRoute;
      decorations: RouteMapDecoration[];
      endpoints: { start: LatLng; finish: LatLng };
    };

/**
 * A finished run's drawable route. Reads `run_points` ONCE, non-reactively — never via `useLiveQuery`
 * (ADR 0004 §3) — and re-derives geometry with the same smoother the distance used (ADR 0021 §3).
 * `segments` comes from the caller's live query; the hook only needs the segmentSeq → kind join.
 */
export function useRunRoute(
  runId: string,
  segments: readonly RunSegment[],
  aspectRatio: number,
  epsilon = DP_EPSILON_M,
): RunRoute {
  // why: split from colouring so a light/dark switch never re-runs the ~1800-row read.
  const geometry = useMemo(() => {
    if (segments.length === 0) return null;
    const points = smoothTrackForRender(loadRunFixes(runId));
    const chunks = toSegmentPolylines(points, epsilon);
    if (chunks.length === 0) return null;

    // why: over what is DRAWN, not every render point — a dropped chunk's outlier is off-screen and
    // must widen neither the readiness gate nor the camera.
    const bbox = boundingBox(chunks.flatMap((chunk) => chunk.points));
    if (!bbox) return null;
    if (boundingBoxDiagonalM(bbox) < MIN_ROUTE_EXTENT_M) return null;

    const camera = cameraForBoundingBox(bbox, aspectRatio);
    return {
      camera,
      chunks,
      chevrons: chevronsAlongRoute(chunks, camera.fittedSpanM),
      endpoints: {
        start: chunks[0].points[0],
        finish: chunks.at(-1)!.points.at(-1)!,
      },
    };
  }, [runId, segments, aspectRatio, epsilon]);

  const segmentColors = useSegmentColors();
  const directionColor = useRouteDirectionColor();

  return useMemo(() => {
    if (!geometry) return { ready: false };

    return {
      ready: true,
      camera: geometry.camera,
      endpoints: geometry.endpoints,
      route: { lines: toRouteLines(geometry.chunks, segments, segmentColors) },
      decorations: geometry.chevrons.map((chevron, index) => ({
        id: `arrow-${index}`,
        points: [...chevron.points],
        color: directionColor,
        width: CHEVRON_STROKE_W,
        closed: false,
      })),
    };
  }, [geometry, segments, segmentColors, directionColor]);
}
