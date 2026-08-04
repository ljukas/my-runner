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

interface ReadyRoute {
  ready: true;
  bbox: BoundingBox;
  route: RouteMapRoute;
  endpoints: { start: LatLng; finish: LatLng };
}

/** The viewer's track. No `profile`: it never folds one, so it must not advertise a null field. */
export type RunRoute = { ready: false } | ReadyRoute;

export type RunTrack =
  | { ready: false }
  | (ReadyRoute & {
      /** The pace series, or null when it is absent, unstrokable (spec §8), or failed to fold. */
      profile: ProfilePoint[] | null;
    });

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

// why its own try, inside the shared read: the profile fold is a passenger on the route's memo
// since the two share one `loadRunFixes`, and without this a throw here would take the route map
// down with it — a coupling the map did not have before the two hooks were merged.
function foldProfile(fixes: readonly SegmentedFix[]): ProfilePoint[] | null {
  try {
    const points = toRunProfile(fixes);
    return isDrawableProfile(points) ? points : null;
  } catch (error) {
    console.warn('[use-run-track] pace fold failed; keeping the route', error);
    return null;
  }
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
      return { geometry, profile: withProfile ? foldProfile(fixes) : null };
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
 * `loaded` is the caller's `updatedAt !== undefined`, not `segments.length`: a run with zero
 * `run_segments` rows is still a real, routeable run (save-run skips the insert then).
 *
 * One `ready` covers both deliberately, so a treadmill session cannot be told it "didn't cover
 * enough ground to map" above a chart drawn from that same rejected drift (spec §8).
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
): RunRoute {
  return useTrack(runId, segments, loaded, epsilon, false);
}
