import { describe, expect, test } from 'bun:test';

import { ROUTE_STROKE_W, ROUTE_STROKE_W_RUN } from '@/constants/theme';

import type { SegmentPolyline } from './geo';
import type { SegmentKind } from './plan';
import { toRouteLines } from './route-render';

const COLORS: Record<SegmentKind, string> = {
  warmup: '#warmup',
  run: '#run',
  walk: '#walk',
  cooldown: '#cooldown',
};

function chunk(segmentSeq: number): SegmentPolyline {
  return {
    segmentSeq,
    points: [
      { lat: 59.33, lng: 18.07 },
      { lat: 59.331, lng: 18.071 },
    ],
    gapBefore: false,
  };
}

const SEGMENTS: { seq: number; kind: SegmentKind }[] = [
  { seq: 0, kind: 'warmup' },
  { seq: 1, kind: 'run' },
  { seq: 2, kind: 'walk' },
  { seq: 3, kind: 'cooldown' },
];

describe('toRouteLines', () => {
  test('colours each chunk from its segment kind', () => {
    const lines = toRouteLines([chunk(0), chunk(1), chunk(2), chunk(3)], SEGMENTS, COLORS);
    expect(lines.map((line) => line.color)).toEqual(['#warmup', '#run', '#walk', '#cooldown']);
  });

  test('draws a chunk whose segmentSeq has no segment row as walk', () => {
    // The fallback is load-bearing: save-run.ts warns about this misalignment in __DEV__.
    const [line] = toRouteLines([chunk(99)], SEGMENTS, COLORS);
    expect(line.color).toBe('#walk');
    expect(line.width).toBe(ROUTE_STROKE_W);
  });

  test('falls back to walk when the segments have not loaded at all', () => {
    expect(toRouteLines([chunk(1)], [], COLORS)[0].color).toBe('#walk');
  });

  test('only run intervals get the thick stroke', () => {
    const lines = toRouteLines([chunk(0), chunk(1), chunk(2), chunk(3)], SEGMENTS, COLORS);
    expect(lines.map((line) => line.width)).toEqual([
      ROUTE_STROKE_W,
      ROUTE_STROKE_W_RUN,
      ROUTE_STROKE_W,
      ROUTE_STROKE_W,
    ]);
  });

  test('ids are deterministic and follow drawing order', () => {
    const lines = toRouteLines([chunk(2), chunk(2), chunk(1)], SEGMENTS, COLORS);
    expect(lines.map((line) => line.id)).toEqual(['seg-0', 'seg-1', 'seg-2']);
  });

  test('passes the chunk points through by reference', () => {
    // Adjacent chunks share their boundary vertex by object identity; copying here would not break
    // rendering, but it would silently end the guarantee the seam tests in geo.test.ts pin.
    const chunks = [chunk(0)];
    expect(toRouteLines(chunks, SEGMENTS, COLORS)[0].points).toBe(chunks[0].points);
  });

  test('no chunks, no lines', () => {
    expect(toRouteLines([], SEGMENTS, COLORS)).toEqual([]);
  });
});
