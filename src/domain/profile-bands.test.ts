import { describe, expect, test } from 'bun:test';

import { FREE_RUN_KEY } from './free-run';
import { EARTH_RADIUS_M, type SegmentedFix } from './geo';
import { bandsFor, bandsLabel, toProfileBands } from './profile-bands';
import { foldRunProfile, toRunProfile } from './run-profile';
import type { StoredSegmentKind } from './run-motion';

// why 60 s each: every span fully measured, every row as long, unless a test says otherwise
const span = (segmentSeq: number, fromM: number, toM: number, measuredS = 60) => ({
  segmentSeq,
  fromM,
  toM,
  measuredS,
});
const rows = (...kinds: StoredSegmentKind[]) =>
  kinds.map((kind, seq) => ({ seq, kind, actualDurationS: 60 }));

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
      silencesAtM: [],
    });
  });

  test('bridges a stop between two kinds, so the strip has no gap', () => {
    const bands = toProfileBands(
      [span(0, 0, 839), span(1, 839, 846), span(2, 846, 1200)],
      rows('run', 'stopped', 'walk'),
    );
    expect(bands.runWalk).toEqual([
      { kind: 'run', fromM: 0, toM: 846 },
      { kind: 'walk', fromM: 846, toM: 1200 },
    ]);
  });

  test('keeps stops at the very start and the very end', () => {
    const bands = toProfileBands(
      [span(0, 0, 1), span(1, 1, 500), span(2, 500, 501)],
      rows('stopped', 'walk', 'stopped'),
    );
    expect(bands.stopsAtM).toEqual([0, 500]);
    expect(bands.runWalk).toEqual([{ kind: 'walk', fromM: 1, toM: 500 }]);
  });

  test('marks a stop the GPS never saw as a silence, where the span before it ended', () => {
    const bands = toProfileBands(
      [span(0, 0, 600), span(2, 600, 1200)],
      rows('run', 'stopped', 'run'),
    );
    expect(bands.stopsAtM).toEqual([]);
    expect(bands.silencesAtM).toEqual([600]);
    expect(bands.runWalk).toEqual([{ kind: 'run', fromM: 0, toM: 1200 }]);
  });

  test('tells a silence from a stop by what the GPS measured; a bucket with both gets both', () => {
    const spans = [
      span(0, 0, 500),
      span(1, 500, 502, 1), // a tunnel: only the leg that closed the silence
      span(2, 502, 900),
      span(3, 900, 903, 44), // stood 44 s, then the signal dropped for 61 s
      span(4, 903, 1200),
      span(5, 1200, 1201, 10), // a crossing
    ];
    const durations = [60, 62, 60, 105, 60, 10];
    const segments = rows('run', 'stopped', 'run', 'stopped', 'run', 'stopped').map((row) => ({
      ...row,
      actualDurationS: durations[row.seq],
    }));
    const bands = toProfileBands(spans, segments);
    expect(bands.stopsAtM).toEqual([900, 1200]);
    expect(bands.silencesAtM).toEqual([500, 900]);
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

describe('bandsLabel', () => {
  test('reads the strip as distances and counts the stops', () => {
    const bands = toProfileBands(
      [span(0, 0, 400), span(1, 400, 401), span(2, 401, 700), span(3, 700, 1000)],
      rows('run', 'stopped', 'walk', 'run'),
    );
    expect(bandsLabel(bands)).toBe('Running 0.70 km, walking 0.30 km, stopped 1 time.');
  });

  test('leaves out what did not happen, and counts silences apart', () => {
    const bands = toProfileBands([span(0, 0, 670), span(2, 670, 670)], rows('run', 'stopped'));
    expect(bandsLabel(bands)).toBe('Running 0.67 km. GPS lost 1 time.');
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

  test('count only the seconds the GPS measured: a silence adds none', () => {
    const fixes = track([
      [100, 2.6, 0],
      [100, 2.6, 1],
    ]).filter((fix) => fix.timestamp <= 120_000 || fix.timestamp > 180_000);
    const { spans } = foldRunProfile(fixes);
    expect(spans[0].measuredS).toBe(99);
    expect(spans[1].measuredS).toBe(100 - 61); // its 100 s less the 61 s leg across the gap
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
