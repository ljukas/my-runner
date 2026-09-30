import { describe, expect, test } from 'bun:test';

import { FREE_RUN_KEY } from './free-run';
import { EARTH_RADIUS_M, type SegmentedFix } from './geo';
import { bandsFor, toProfileBands } from './profile-bands';
import { foldRunProfile, toRunProfile } from './run-profile';
import type { StoredSegmentKind } from './run-motion';

const span = (segmentSeq: number, fromM: number, toM: number) => ({ segmentSeq, fromM, toM });
const rows = (...kinds: StoredSegmentKind[]) => kinds.map((kind, seq) => ({ seq, kind }));

describe('toProfileBands', () => {
  test('merges consecutive buckets of one kind, and a stop leaves a marker, not a band', () => {
    const bands = toProfileBands(
      [span(0, 0, 400), span(1, 400, 402), span(2, 402, 900), span(3, 900, 1100)],
      rows('run', 'stopped', 'run', 'walk'),
    );
    expect(bands).toEqual({
      runWalk: [
        { kind: 'run', fromM: 0, toM: 900 },
        { kind: 'walk', fromM: 900, toM: 1100 },
      ],
      stopsAtM: [400],
    });
  });

  test('keeps stops at the very start and the very end', () => {
    const bands = toProfileBands(
      [span(0, 0, 1), span(1, 1, 500), span(2, 500, 501)],
      rows('stopped', 'walk', 'stopped'),
    );
    expect(bands.stopsAtM).toEqual([0, 500]);
    expect(bands.runWalk).toEqual([{ kind: 'walk', fromM: 1, toM: 500 }]);
  });

  test('places a stop the GPS never saw where the span before it ended', () => {
    const bands = toProfileBands(
      [span(0, 0, 600), span(2, 600, 1200)],
      rows('run', 'stopped', 'run'),
    );
    expect(bands.stopsAtM).toEqual([600]);
    expect(bands.runWalk).toEqual([{ kind: 'run', fromM: 0, toM: 1200 }]);
  });

  test('keeps every stop, even two at one distance', () => {
    const bands = toProfileBands(
      [span(0, 0, 300), span(1, 300, 300), span(2, 300, 301), span(3, 301, 301)],
      rows('run', 'stopped', 'walk', 'stopped'),
    );
    expect(bands.stopsAtM).toEqual([300, 301]);
  });

  test('draws a span with no segment row as walk', () => {
    expect(toProfileBands([span(0, 0, 500)], []).runWalk).toEqual([
      { kind: 'walk', fromM: 0, toM: 500 },
    ]);
  });
});

describe('bandsFor', () => {
  test('gives a plan run no bands, and a free run its bands', () => {
    const spans = [span(0, 0, 500)];
    expect(bandsFor('w1d1', spans, rows('run'))).toBeNull();
    expect(bandsFor(FREE_RUN_KEY, spans, rows('run'))?.runWalk).toHaveLength(1);
  });

  test('gives none when the chart itself was withheld, or folded no distance', () => {
    expect(bandsFor(FREE_RUN_KEY, null, rows('run'))).toBeNull();
    expect(bandsFor(FREE_RUN_KEY, [], rows('run'))).toBeNull();
  });
});

describe('foldRunProfile spans', () => {
  const DEG_PER_M = 180 / (Math.PI * EARTH_RADIUS_M);
  /** 1 Hz northward fixes, one `[seconds, m/s, segmentSeq]` leg at a time. */
  function track(legs: readonly [number, number, number][]): SegmentedFix[] {
    const fixes: SegmentedFix[] = [];
    let t = 0;
    let northM = 0;
    for (const [seconds, mps, segmentSeq] of legs) {
      for (let s = 0; s < seconds; s += 1) {
        t += 1000;
        northM += mps;
        fixes.push({
          timestamp: t,
          lat: 59 + northM * DEG_PER_M,
          lng: 18,
          altitude: null,
          accuracy: 5,
          speed: null,
          segmentSeq,
        });
      }
    }
    return fixes;
  }

  test('tile the chart axis from 0 to the same total its points cover', () => {
    const { points, spans } = foldRunProfile(
      track([
        [200, 2.6, 0],
        [30, 0, 1],
        [200, 1.4, 2],
      ]),
    );
    expect(spans.map((s) => s.segmentSeq)).toEqual([0, 1, 2]);
    expect(spans[0].fromM).toBe(0);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i].fromM).toBe(spans[i - 1].toM);
    const width = points[1].distanceM - points[0].distanceM;
    expect(spans.at(-1)!.toM).toBeCloseTo(points.at(-1)!.distanceM + width / 2, 6);
  });

  test('leave the points exactly as toRunProfile draws them', () => {
    const fixes = track([
      [300, 2.6, 0],
      [100, 1.3, 1],
    ]);
    expect(foldRunProfile(fixes).points).toEqual(toRunProfile(fixes));
    expect(foldRunProfile([])).toEqual({ points: [], spans: [] });
  });
});
