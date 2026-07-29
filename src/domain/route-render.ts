/** Presentation mapping for the drawn route — the styling stage of the geo.ts render pipeline. */

import { ROUTE_STROKE_W, ROUTE_STROKE_W_RUN } from '@/constants/theme';

import type { LatLng, SegmentPolyline } from './geo';
import type { SegmentKind } from './plan';

export interface RouteLine {
  id: string;
  points: LatLng[];
  color: string;
  width: number;
}

/**
 * One styled line per chunk, in drawing order. A chunk whose `segmentSeq` matches no segment row is
 * drawn as `walk`: misalignment is a real possibility (ADR 0021 §4, and save-run's own `__DEV__`
 * invariant warning), and walk is the reading that cannot invent an interval the runner never ran.
 */
export function toRouteLines(
  chunks: readonly SegmentPolyline[],
  segments: readonly { seq: number; kind: SegmentKind }[],
  colors: Record<SegmentKind, string>,
): RouteLine[] {
  const kindBySeq = new Map(segments.map((segment) => [segment.seq, segment.kind]));

  return chunks.map((chunk, index) => {
    const kind = kindBySeq.get(chunk.segmentSeq) ?? 'walk';
    return {
      id: `seg-${index}`,
      points: chunk.points,
      color: colors[kind],
      // why: width double-encodes phase, so it never rests on hue alone (spec §7.3).
      width: kind === 'run' ? ROUTE_STROKE_W_RUN : ROUTE_STROKE_W,
    };
  });
}
