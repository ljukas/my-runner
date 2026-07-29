import { useMemo } from 'react';

import {
  CHEVRON_STROKE_W,
  ROUTE_STROKE_W,
  ROUTE_STROKE_W_RUN,
  ROUTE_DIRECTION_COLOR,
} from '@/constants/theme';
import type { RunSegment } from '@/db/schema';
import { loadRunFixes } from '@/db/run-points';
import {
  boundingBox,
  cameraForBoundingBox,
  chevronsAlongRoute,
  DP_EPSILON_M,
  MIN_ROUTE_EXTENT_M,
  smoothTrackForRender,
  toSegmentPolylines,
  type CameraFit,
  type LatLng,
} from '@/domain/geo';
import type { RouteMapDecoration, RouteMapRoute } from '@/components/route-map';
import { useSegmentColors } from '@/hooks/use-theme';

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

    const bbox = boundingBox(points.map((p) => p.point));
    if (!bbox) return null;
    const camera = cameraForBoundingBox(bbox, aspectRatio);
    if (camera.fittedSpanM < MIN_ROUTE_EXTENT_M) return null;

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

  return useMemo(() => {
    if (!geometry) return { ready: false };
    const kindBySeq = new Map(segments.map((segment) => [segment.seq, segment.kind]));

    return {
      ready: true,
      camera: geometry.camera,
      endpoints: geometry.endpoints,
      route: {
        lines: geometry.chunks.map((chunk, index) => {
          const kind = kindBySeq.get(chunk.segmentSeq) ?? 'walk';
          return {
            id: `seg-${index}`,
            points: chunk.points,
            color: segmentColors[kind],
            width: kind === 'run' ? ROUTE_STROKE_W_RUN : ROUTE_STROKE_W,
          };
        }),
      },
      decorations: geometry.chevrons.map((chevron, index) => ({
        id: `arrow-${index}`,
        points: [...chevron.points],
        color: ROUTE_DIRECTION_COLOR,
        width: CHEVRON_STROKE_W,
        closed: false,
      })),
    };
  }, [geometry, segments, segmentColors]);
}
