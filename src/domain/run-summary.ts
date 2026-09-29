/** Pure Run summary derivation — no React/Expo/native imports (ADR 0003). */

import {
  boundingBox,
  boundingBoxDiagonalM,
  MIN_ROUTE_EXTENT_M,
  smoothTrackForRender,
  toSegmentPolylines,
  type BoundingBox,
  type LatLng,
  type SegmentedFix,
  type SegmentPolyline,
} from './geo';
import { runElevation, type PausedInterval, type StoredAltitudeSample } from './run-altitude';
import { isDrawableProfile, toRunProfile, type ProfilePoint } from './run-profile';
import { hasMeasuredDistance } from './run-stats';

export interface RunRouteGeometry {
  bbox: BoundingBox;
  chunks: SegmentPolyline[];
  endpoints: { start: LatLng; finish: LatLng };
}

export type SummaryElevation =
  | { status: 'estimated'; gainM: number; lossM: number }
  /** The run carries barometer samples, but not a route and a measured distance to set them on. */
  | { status: 'insufficient' };

export interface RunSummary {
  /** Null when the drawn track spans less than `MIN_ROUTE_EXTENT_M`. */
  route: RunRouteGeometry | null;
  /** Null unless there is a route, a measured distance and a strokable pace line. */
  profile: ProfilePoint[] | null;
  /** Null when the run recorded no barometer samples at all (no sensor, or motion access denied), and
   *  when deriving the route or the elevation threw — a defect is not the runner's lack of data. */
  elevation: SummaryElevation | null;
}

export interface RunSummaryInput {
  fixes: readonly SegmentedFix[];
  hasAltitudeSamples: boolean;
  /** Called only when the run has a route and a measured distance to set the samples on. */
  loadAltitudeSamples: () => readonly StoredAltitudeSample[];
  pauses: readonly PausedInterval[];
  distanceM: number | null;
  activeDurationS: number;
  epsilon: number;
}

/** The drawn route, or null when it spans less than `MIN_ROUTE_EXTENT_M`. Throws on bad input. */
export function deriveRunRoute(
  fixes: readonly SegmentedFix[],
  epsilon: number,
): RunRouteGeometry | null {
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

// why each part is caught on its own: a throw in the pace or elevation fold must not take the
// route map down with it, nor the route take the others. Undefined, not null, so a caller can tell
// a throw from a derivation's own "nothing to show".
function isolated<T>(part: string, derive: () => T): T | undefined {
  try {
    return derive();
  } catch (error) {
    console.warn(`[run-summary] ${part} failed; omitting it`, error);
    return undefined;
  }
}

/**
 * What a finished Run's summary may show. One route gate covers the chart and the elevation
 * deliberately, so a treadmill session is never told it "didn't cover enough ground to map" above
 * a chart or a climb drawn from that same rejected drift (spec §8).
 */
export function deriveRunSummary(input: RunSummaryInput): RunSummary {
  const route = isolated('route', () => deriveRunRoute(input.fixes, input.epsilon));
  // why a second gate beside the route: it is spatial (a 100 m bbox diagonal) while the stat grid
  // and splits gate on a 0.5 m/s speed floor, and a slow shuffle clears the first but not the second.
  const measured = hasMeasuredDistance(input.distanceM, input.activeDurationS);
  const placed = route != null && measured;

  const derived =
    placed && input.hasAltitudeSamples
      ? isolated('elevation', () => runElevation(input.loadAltitudeSamples(), input.pauses))
      : null;

  const profile = placed
    ? (isolated('profile', () => {
        const points = toRunProfile(input.fixes, undefined, derived?.series);
        return isDrawableProfile(points) ? points : null;
      }) ?? null)
    : null;

  let elevation: SummaryElevation | null = null;
  if (derived) elevation = { status: 'estimated', gainM: derived.gainM, lossM: derived.lossM };
  else if (input.hasAltitudeSamples && route !== undefined && derived !== undefined) {
    elevation = { status: 'insufficient' };
  }

  return { route: route ?? null, profile, elevation };
}
