import { ROUTE_STROKE_W, ROUTE_STROKE_W_RUN } from '@/constants/theme';

import type { LatLng, SegmentPolyline } from './geo';
import type { SegmentKind } from './plan';

export interface RouteLine {
  id: string;
  points: LatLng[];
  color: string;
  width: number;
}

/** One styled line per chunk, in drawing order; a chunk matching no segment row draws as `walk`
 * (ADR 0021 §4). */
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
      width: kind === 'run' ? ROUTE_STROKE_W_RUN : ROUTE_STROKE_W,
    };
  });
}
