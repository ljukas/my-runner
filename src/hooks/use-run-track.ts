import { useMemo } from 'react';

import type { RouteMapRoute } from '@/components/route-map/port';
import { loadAltitudeSamples } from '@/db/run-log';
import { loadRunFixes } from '@/db/run-points';
import type { Run, RunSegment } from '@/db/schema';
import { DP_EPSILON_M, type BoundingBox, type LatLng } from '@/domain/geo';
import { toRouteLines } from '@/domain/route-render';
import type { ProfilePoint } from '@/domain/run-profile';
import {
  deriveRunRoute,
  deriveRunSummary,
  type RunRouteGeometry,
  type SummaryElevation,
} from '@/domain/run-summary';
import { useSegmentColors } from '@/hooks/use-theme';

interface ReadyRoute {
  ready: true;
  bbox: BoundingBox;
  route: RouteMapRoute;
  endpoints: { start: LatLng; finish: LatLng };
}

/** The viewer's track. No `profile`: it never folds one, so it must not advertise a null field. */
export type RunRoute = { ready: false } | ReadyRoute;

export type RunTrack = (
  | { ready: false }
  | (ReadyRoute & {
      /** The chart's series, or null when `deriveRunSummary` withholds it. */
      profile: ProfilePoint[] | null;
    })
) & {
  /** Independent of `ready`: a run can carry samples that are too few to place. */
  elevation: SummaryElevation | null;
};

type RunTotals = Pick<Run, 'distanceM' | 'activeDurationS'>;

function useStyledRoute(geometry: RunRouteGeometry | null, segments: readonly RunSegment[]) {
  const segmentColors = useSegmentColors();
  return useMemo(
    () =>
      geometry
        ? {
            ready: true as const,
            bbox: geometry.bbox,
            endpoints: geometry.endpoints,
            route: { lines: toRouteLines(geometry.chunks, segments, segmentColors) },
          }
        : { ready: false as const },
    [geometry, segments, segmentColors],
  );
}

/**
 * A finished run's summary data from ONE read of each per-run stream — never via `useLiveQuery`
 * (ADR 0004 §3) — folded by `deriveRunSummary`. `loaded` is the caller's `updatedAt !== undefined`,
 * not `segments.length`: a run with zero `run_segments` rows is still a real, routeable run
 * (save-run skips the insert then).
 */
export function useRunTrack(
  runId: string,
  run: RunTotals | undefined,
  segments: readonly RunSegment[],
  loaded: boolean,
): RunTrack {
  const distanceM = run?.distanceM ?? null;
  const activeDurationS = run?.activeDurationS ?? 0;
  // why: keyed on neither the viewport nor the palette, so a rotation, a keyboard, the modal
  // settling, or a light/dark switch never re-runs the ~1800-fix and ~1800-sample read and refold.
  const summary = useMemo(() => {
    if (!loaded) return null;
    try {
      return deriveRunSummary({
        fixes: loadRunFixes(runId),
        altitudeSamples: loadAltitudeSamples(runId),
        distanceM,
        activeDurationS,
        epsilon: DP_EPSILON_M,
      });
    } catch (error) {
      // why: no ErrorBoundary wraps this route; a SQLite read failure must degrade to the
      // fallback card, not crash render.
      console.warn('[use-run-track] track load failed; showing the fallback', error);
      return null;
    }
  }, [runId, loaded, distanceM, activeDurationS]);

  const route = useStyledRoute(summary?.route ?? null, segments);
  const profile = summary?.profile ?? null;
  const elevation = summary?.elevation ?? null;

  return useMemo(
    () => (route.ready ? { ...route, profile, elevation } : { ready: false, elevation }),
    [route, profile, elevation],
  );
}

/** The same route for the full-screen viewer, which zooms further and reads no series. */
export function useRunRoute(
  runId: string,
  segments: readonly RunSegment[],
  loaded: boolean,
  epsilon = DP_EPSILON_M,
): RunRoute {
  const geometry = useMemo(() => {
    if (!loaded) return null;
    try {
      return deriveRunRoute(loadRunFixes(runId), epsilon);
    } catch (error) {
      console.warn('[use-run-track] route load failed; showing the fallback', error);
      return null;
    }
  }, [runId, loaded, epsilon]);

  return useStyledRoute(geometry, segments);
}
