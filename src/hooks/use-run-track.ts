import { useMemo } from 'react';

import type { RouteMapRoute } from '@/components/route-map/port';
import { loadRunFixes } from '@/db/run-points';
import type { RunSegment } from '@/db/schema';
import {
  boundingBox,
  boundingBoxDiagonalM,
  DP_EPSILON_M,
  MIN_ROUTE_EXTENT_M,
  smoothTrackForRender,
  toSegmentPolylines,
  type BoundingBox,
  type LatLng,
  type SegmentedFix,
  type SegmentPolyline,
} from '@/domain/geo';
import { toRouteLines } from '@/domain/route-render';
import { isDrawableProfile, toRunProfile, type ProfilePoint } from '@/domain/run-profile';
import { useSegmentColors } from '@/hooks/use-theme';

export type RunTrack =
  | { ready: false }
  | {
      ready: true;
      bbox: BoundingBox;
      route: RouteMapRoute;
      endpoints: { start: LatLng; finish: LatLng };
      /** The pace series, or null when it is present but cannot be stroked (spec §8). */
      profile: ProfilePoint[] | null;
    };

interface Geometry {
  bbox: BoundingBox;
  chunks: SegmentPolyline[];
  endpoints: { start: LatLng; finish: LatLng };
}

function routeGeometry(fixes: readonly SegmentedFix[], epsilon: number): Geometry | null {
  const chunks = toSegmentPolylines(smoothTrackForRender(fixes), epsilon);
  if (chunks.length === 0) return null;

  // why: over what is DRAWN, not every render point — a dropped chunk's outlier is off-screen and
  // must widen neither the readiness gate nor the camera.
  const bbox = boundingBox(chunks.flatMap((chunk) => chunk.points));
  // why: toSegmentPolylines drops chunks under 2 points, so bbox is never null here.
  if (boundingBoxDiagonalM(bbox!) < MIN_ROUTE_EXTENT_M) return null;

  return {
    bbox: bbox!,
    chunks,
    endpoints: { start: chunks[0].points[0], finish: chunks.at(-1)!.points.at(-1)! },
  };
}

function useTrack(
  runId: string,
  segments: readonly RunSegment[],
  loaded: boolean,
  epsilon: number,
  withProfile: boolean,
): RunTrack {
  // why: keyed on neither the viewport nor the palette, so a rotation, a keyboard, the modal
  // settling, or a light/dark switch never re-runs the ~1800-row read and refold.
  const derived = useMemo(() => {
    if (!loaded) return null;
    try {
      const fixes = loadRunFixes(runId);
      const geometry = routeGeometry(fixes, epsilon);
      if (!geometry) return null;
      if (!withProfile) return { geometry, profile: null };
      const points = toRunProfile(fixes);
      return { geometry, profile: isDrawableProfile(points) ? points : null };
    } catch (error) {
      // why: no ErrorBoundary wraps this route; a SQLite read failure must degrade to the
      // fallback card, not crash render.
      console.warn('[use-run-track] track load failed; showing the fallback', error);
      return null;
    }
  }, [runId, loaded, epsilon, withProfile]);

  const segmentColors = useSegmentColors();

  return useMemo(() => {
    if (!derived) return { ready: false };

    return {
      ready: true,
      bbox: derived.geometry.bbox,
      endpoints: derived.geometry.endpoints,
      route: { lines: toRouteLines(derived.geometry.chunks, segments, segmentColors) },
      profile: derived.profile,
    };
  }, [derived, segments, segmentColors]);
}

/**
 * A finished run's route AND pace series, from ONE `run_points` read — never via `useLiveQuery`
 * (ADR 0004 §3) — re-derived with the same smoother the stored distance used (ADR 0021 §3).
 * `segments` comes from the caller's live query; the hook only needs the segmentSeq → kind join.
 * `loaded` is the caller's `updatedAt !== undefined` — a run with zero `run_segments` rows is still
 * a real, routeable run (save-run skips the insert then), so readiness needs `loaded`, not
 * `segments.length`.
 *
 * One `ready` covers both, deliberately: the route-extent floor is the single predicate deciding
 * whether a run has GPS worth drawing, so a treadmill session can no longer be told it "didn't
 * cover enough ground to map" above a pace chart drawn from that same rejected drift (spec §8).
 */
export function useRunTrack(
  runId: string,
  segments: readonly RunSegment[],
  loaded: boolean,
): RunTrack {
  return useTrack(runId, segments, loaded, DP_EPSILON_M, true);
}

/** The same track for the full-screen viewer, which zooms further and needs no pace series. */
export function useRunRoute(
  runId: string,
  segments: readonly RunSegment[],
  loaded: boolean,
  epsilon = DP_EPSILON_M,
): RunTrack {
  return useTrack(runId, segments, loaded, epsilon, false);
}
