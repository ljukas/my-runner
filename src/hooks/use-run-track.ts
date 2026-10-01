import { useMemo } from 'react';

import type { RouteMapRoute } from '@/components/route-map/port';
import { hasAltitudeSamples, loadSummaryAltitudeSamples } from '@/db/run-log';
import { loadRunFixes } from '@/db/run-points';
import type { Run, RunSegment } from '@/db/schema';
import { runPolicy } from '@/domain/free-run';
import { DP_EPSILON_M, type BoundingBox, type LatLng } from '@/domain/geo';
import { bandsFor, type ProfileBands } from '@/domain/profile-bands';
import { parseEventLog, pausedIntervals } from '@/domain/run-altitude';
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
      /** A free run's buckets on the chart; null for a plan run or a withheld chart. */
      bands: ProfileBands | null;
    })
) & {
  /** Independent of `ready`: a run can carry samples that are too few to place. */
  elevation: SummaryElevation | null;
};

type RunTotals = Pick<Run, 'sessionKey' | 'distanceM' | 'activeDurationS' | 'eventLogJson'>;

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
  const eventLogJson = run?.eventLogJson ?? null;
  const sessionKey = run?.sessionKey ?? '';
  // why: keyed on neither the viewport nor the palette, so a rotation, a keyboard, the modal
  // settling, or a light/dark switch never re-runs the ~1800-fix and ~1800-sample read and refold.
  const summary = useMemo(() => {
    if (!loaded) return null;
    try {
      const pauses = pausedIntervals(parseEventLog(eventLogJson));
      return deriveRunSummary({
        fixes: loadRunFixes(runId),
        hasAltitudeSamples: hasAltitudeSamples(runId),
        loadAltitudeSamples: () => loadSummaryAltitudeSamples(runId),
        pauses,
        distanceM,
        activeDurationS,
        policy: runPolicy(sessionKey, pauses),
      });
    } catch (error) {
      // why: no ErrorBoundary wraps this route; a SQLite read failure must degrade to the
      // fallback card, not crash render.
      console.warn('[use-run-track] track load failed; showing the fallback', error);
      return null;
    }
  }, [runId, loaded, distanceM, activeDurationS, eventLogJson, sessionKey]);

  const route = useStyledRoute(summary?.route ?? null, segments);
  const profile = summary?.profile ?? null;
  const profileSpans = summary?.profileSpans ?? null;
  const elevation = summary?.elevation ?? null;
  // why apart from the summary: segment rows arrive live, and must not re-run the fold
  const bands = useMemo(
    () => bandsFor(sessionKey, profileSpans, segments),
    [sessionKey, profileSpans, segments],
  );

  return useMemo(
    () => (route.ready ? { ...route, profile, bands, elevation } : { ready: false, elevation }),
    [route, profile, bands, elevation],
  );
}

/** The same route for the full-screen viewer, which zooms further and reads no series. */
export function useRunRoute(
  runId: string,
  run: Pick<Run, 'sessionKey' | 'eventLogJson'> | undefined,
  segments: readonly RunSegment[],
  loaded: boolean,
  epsilon = DP_EPSILON_M,
): RunRoute {
  const sessionKey = run?.sessionKey ?? '';
  const eventLogJson = run?.eventLogJson ?? null;
  const geometry = useMemo(() => {
    if (!loaded) return null;
    try {
      const policy = runPolicy(sessionKey, pausedIntervals(parseEventLog(eventLogJson)));
      return deriveRunRoute(loadRunFixes(runId), epsilon, policy);
    } catch (error) {
      console.warn('[use-run-track] route load failed; showing the fallback', error);
      return null;
    }
  }, [runId, loaded, epsilon, sessionKey, eventLogJson]);

  return useStyledRoute(geometry, segments);
}
