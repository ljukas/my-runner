import { describe, expect, test } from 'bun:test';

import {
  accuracyFilter,
  boundingBox,
  cameraForBoundingBox,
  createSmootherState,
  DP_EPSILON_M,
  EARTH_RADIUS_M,
  encodePolyline,
  haversineMeters,
  MAX_GAP_S,
  MIN_SPAN_DEG,
  NEAR_STATIONARY_DEADBAND_M,
  SEED_FIXES,
  simplifyPolyline,
  smoothFix,
  smoothTrack,
  smoothTrackBySegment,
  smoothTrackForRender,
  toSegmentPolylines,
  type BoundingBox,
  type CameraFit,
  type LatLng,
  type LocationFix,
  type RenderPoint,
  type SegmentedFix,
} from './geo';

/** A fully-formed fix; override only the field under test. */
function makeFix(overrides: Partial<LocationFix> = {}): LocationFix {
  return { timestamp: 0, lat: 0, lng: 0, altitude: null, accuracy: 10, speed: null, ...overrides };
}

describe('accuracyFilter', () => {
  test('accepts a fix exactly at the 50 m limit', () => {
    expect(accuracyFilter(makeFix({ accuracy: 50 }))).toBe(true);
  });

  test('rejects a fix just beyond the limit', () => {
    expect(accuracyFilter(makeFix({ accuracy: 50.01 }))).toBe(false);
  });

  test('rejects a fix with unknown accuracy', () => {
    expect(accuracyFilter(makeFix({ accuracy: null }))).toBe(false);
  });

  test('rejects a fix reported invalid by a negative accuracy', () => {
    // iOS surfaces CLLocation.horizontalAccuracy < 0 to mean "lat/lng invalid".
    expect(accuracyFilter(makeFix({ accuracy: -1 }))).toBe(false);
  });

  test('rejects an implausible zero-radius fix', () => {
    expect(accuracyFilter(makeFix({ accuracy: 0 }))).toBe(false);
  });

  test('rejects a NaN accuracy', () => {
    expect(accuracyFilter(makeFix({ accuracy: NaN }))).toBe(false);
  });

  test('accepts a pristine fix', () => {
    expect(accuracyFilter(makeFix({ accuracy: 5 }))).toBe(true);
  });
});

describe('haversineMeters', () => {
  test('one degree of latitude is ~111.19 km (pins the earth radius)', () => {
    // R * π/180 = 6_371_000 * 0.0174533 = 111194.93 m
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111194.93, 0);
  });

  test('London → Paris is ~343.6 km (real-world sanity vector)', () => {
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    const d = haversineMeters(london, paris);
    expect(d).toBeGreaterThan(343_000);
    expect(d).toBeLessThan(344_500);
  });

  test('identical points are exactly 0', () => {
    const p = { lat: 59.3293, lng: 18.0686 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  test('is symmetric', () => {
    const a = { lat: 10, lng: 20 };
    const b = { lat: -5, lng: 42 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  test('takes the short way across the antimeridian', () => {
    const wrap = haversineMeters({ lat: 0, lng: 179.999 }, { lat: 0, lng: -179.999 });
    const equivalent = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0.002 });
    // 0.002° apart the short way — ~222 m — NOT ~40 000 km the long way round.
    expect(wrap).toBeCloseTo(equivalent, 6);
    expect(wrap).toBeCloseTo(222.39, 0);
  });
});

describe('boundingBox', () => {
  test('spans the min/max lat/lng of the fixture', () => {
    expect(
      boundingBox([
        { lat: 40.7, lng: -120.95 },
        { lat: 38.5, lng: -120.2 },
        { lat: 43.252, lng: -126.453 },
      ]),
    ).toEqual({ minLat: 38.5, maxLat: 43.252, minLng: -126.453, maxLng: -120.2 });
  });

  test('a single point yields a degenerate zero-area box', () => {
    expect(boundingBox([{ lat: 1, lng: 2 }])).toEqual({
      minLat: 1,
      maxLat: 1,
      minLng: 2,
      maxLng: 2,
    });
  });

  test('is null for an empty set (no box to fit)', () => {
    expect(boundingBox([])).toBeNull();
  });

  test('is antimeridian-naive across the date line (documented limitation)', () => {
    // Straddling ±180° gives the long-way box; acceptable for the C25K footprint.
    expect(
      boundingBox([
        { lat: 0, lng: 179.9 },
        { lat: 0, lng: -179.9 },
      ]),
    ).toEqual({ minLat: 0, maxLat: 0, minLng: -179.9, maxLng: 179.9 });
  });
});

describe('encodePolyline', () => {
  test('matches the Google reference vector', () => {
    // Reference example + expected output from Google's polyline algorithm page:
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const points = [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ];
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  test('a single point encodes its absolute lat then lng', () => {
    expect(encodePolyline([{ lat: 38.5, lng: -120.2 }])).toBe('_p~iF~ps|U');
  });

  test('respects a non-default precision', () => {
    // 0.00001° scales to a delta of 1 at precision 5 ('A?') and 10 at precision 6 ('S?').
    expect(encodePolyline([{ lat: 0.00001, lng: 0 }], 5)).toBe('A?');
    expect(encodePolyline([{ lat: 0.00001, lng: 0 }], 6)).toBe('S?');
  });

  test('empty input yields an empty string', () => {
    expect(encodePolyline([])).toBe('');
  });
});

// ── GPS smoothing (ADR 0021) ────────────────────────────────────────────────

const M_PER_DEG = EARTH_RADIUS_M * (Math.PI / 180);
const BASE_LAT = 59;
const BASE_LNG = 18;
const COS_BASE = Math.cos(BASE_LAT * (Math.PI / 180));

/** A fix `northM` m north and `eastM` m east of the base point, at t = i s. */
function fixAt(i: number, northM: number, eastM = 0, accuracy = 5): LocationFix {
  return {
    timestamp: i * 1000,
    lat: BASE_LAT + northM / M_PER_DEG,
    lng: BASE_LNG + eastM / (M_PER_DEG * COS_BASE),
    altitude: null,
    accuracy,
    speed: null,
  };
}

const toLatLng = (f: LocationFix): LatLng => ({ lat: f.lat, lng: f.lng });

/** Plain Σ-haversine over the raw fixes — the un-smoothed baseline the smoother is compared against. */
function rawPathMeters(fixes: LocationFix[]): number {
  let d = 0;
  for (let i = 1; i < fixes.length; i++) {
    d += haversineMeters(toLatLng(fixes[i - 1]), toLatLng(fixes[i]));
  }
  return d;
}

describe('smoothTrack — distance fidelity', () => {
  test('a straight 1.4 m/s walker keeps its full distance (CV-exact, Q-independent)', () => {
    // 60 fixes, 1 Hz, exactly 1.4 m apart → 59 × 1.4 = 82.6 m of true travel.
    const walk = Array.from({ length: 60 }, (_, i) => fixAt(i, i * 1.4));
    const { distanceM, points } = smoothTrack(walk);
    expect(points).toHaveLength(60);
    expect(distanceM).toBeCloseTo(82.6, 1);
  });

  test('jitter is smoothed: inflated raw distance is pulled back toward the truth', () => {
    // True path: straight north at 2 m/s over 30 fixes = 58 m; ±2 m east zig-zag from i ≥ 2 (first two
    // clean so the two-point init is unbiased). North carries no noise, so the CV filter tracks it
    // exactly → distance ≥ the 58 m displacement. The `raw * 0.7` bound is a Q-dependent smoke test
    // (default KALMAN_PROCESS_NOISE), not a fidelity claim — Milestone-0 pins the real figure.
    const jitter = Array.from({ length: 30 }, (_, i) => {
      const eastM = i < 2 ? 0 : i % 2 === 0 ? 2 : -2;
      return fixAt(i, i * 2, eastM);
    });
    const raw = rawPathMeters(jitter);
    const { distanceM } = smoothTrack(jitter);

    expect(raw).toBeGreaterThan(85); // the fixture is genuinely inflated (raw ≈ 126 m)
    expect(distanceM).toBeLessThan(raw); // smoothing removes inflation …
    expect(distanceM).toBeGreaterThan(57); // … without collapsing below the 58 m true north displacement
    expect(distanceM).toBeLessThan(raw * 0.7); // and it removes most of the inflation
  });

  test('a sub-deadband crawl accrues via the carried residual (trailing < 1 deadband left uncommitted)', () => {
    // 0.3 m/s (below NEAR_STATIONARY_SPEED_MPS): a naive per-step deadband would drop every 0.3 m step
    // → ~0. The carried residual commits in ≥ 1.5 m chunks, so the counted total sits within one deadband
    // of the ~5.7 m truth. The trailing residual (< deadband) is intentionally not flushed at track end.
    const crawl = Array.from({ length: 20 }, (_, i) => fixAt(i, i * 0.3));
    const trueM = 19 * 0.3; // 5.7
    const { distanceM } = smoothTrack(crawl);
    expect(distanceM).toBeGreaterThan(trueM - NEAR_STATIONARY_DEADBAND_M);
    expect(distanceM).toBeLessThanOrEqual(trueM + 0.01);
  });

  test('a stationary GPS wander is NOT suppressed to ~0 (known limitation, ADR 0021 §2d)', () => {
    // The runner stands still (north = 0) while GPS drifts 8 m east and back — net displacement 0,
    // true human distance ~0. The speed/displacement commit clause re-anchors across the stop, so most
    // of the ~16 m raw wander is committed as PHANTOM distance. This characterizes the real behavior;
    // it is deliberately NOT an assertion that a stop nets ~0. Directional-consistency gating that would
    // suppress this is an ADR-level enhancement deferred to the Milestone-0 device gate.
    const eastPath = [
      0,
      0.8,
      1.6,
      2.4,
      3.2,
      4.0,
      4.8,
      5.6,
      6.4,
      7.2,
      8.0, // out
      7.2,
      6.4,
      5.6,
      4.8,
      4.0,
      3.2,
      2.4,
      1.6,
      0.8,
      0.0, // back to start
    ];
    const wander = eastPath.map((eastM, i) => fixAt(i, 0, eastM));
    const raw = rawPathMeters(wander); // ≈ 16 m
    const { distanceM } = smoothTrack(wander);
    expect(distanceM).toBeGreaterThan(raw * 0.7); // phantom distance is raw-scale, not ~0
    expect(distanceM).toBeLessThan(raw * 1.3); // … and bounded (no runaway / double-count)
  });
});

describe('smoothTrack — outlier & gap handling', () => {
  test('a single teleport spike is rejected and never inflates distance', () => {
    const track = [
      fixAt(0, 0),
      fixAt(1, 1.4),
      fixAt(2, 2.8),
      fixAt(3, 4.2, 200), // 200 m east spike at 1 Hz → ~100 m/s, far over the gate
      fixAt(4, 5.6),
      fixAt(5, 7.0),
    ];
    const { distanceM, points } = smoothTrack(track);
    expect(points).toHaveLength(5); // the spike produced no smoothed point
    expect(distanceM).toBeGreaterThan(5);
    expect(distanceM).toBeLessThan(20); // not the ~400 m a counted spike would add
  });

  test('a time gap resets the anchor so the across-gap chord is not counted', () => {
    const track = [
      fixAt(0, 0),
      fixAt(1, 1.4),
      fixAt(2, 2.8),
      fixAt(100, 0, 1000), // 98 s gap, 1000 m away
      fixAt(101, 1.4, 1000),
      fixAt(102, 2.8, 1000),
    ];
    const { distanceM, points } = smoothTrack(track);
    expect(points).toHaveLength(6); // the post-gap fix is a reset, not a rejection
    expect(distanceM).toBeGreaterThan(4); // both ~2.8 m clusters counted
    expect(distanceM).toBeLessThan(20); // the 1000 m chord is not
  });
});

describe('smoothTrack — determinism (live fold == batch re-fold)', () => {
  const jitter = Array.from({ length: 30 }, (_, i) => {
    const eastM = i < 2 ? 0 : i % 2 === 0 ? 2 : -2;
    return fixAt(i, i * 2, eastM);
  });

  test('summing acceptedDeltaMeters equals the batch total', () => {
    const batch = smoothTrack(jitter).distanceM;
    let state = createSmootherState();
    let live = 0;
    for (const fix of jitter) {
      const step = smoothFix(state, fix);
      state = step.state;
      live += step.acceptedDeltaMeters;
    }
    expect(live).toBeCloseTo(batch, 9);
  });

  test('carrying state across a mid-track boundary equals a from-scratch fold', () => {
    const batch = smoothTrack(jitter).distanceM;
    let state = createSmootherState();
    let total = 0;
    for (const fix of jitter.slice(0, 15)) {
      const step = smoothFix(state, fix);
      state = step.state;
      total += step.acceptedDeltaMeters;
    }
    for (const fix of jitter.slice(15)) {
      const step = smoothFix(state, fix);
      state = step.state;
      total += step.acceptedDeltaMeters;
    }
    expect(total).toBeCloseTo(batch, 9);
  });
});

describe('smoothTrackBySegment — per-segment attribution (ADR 0021 §4)', () => {
  const seg = (
    i: number,
    northM: number,
    segmentSeq: number,
    eastM = 0,
    accuracy = 5,
  ): SegmentedFix => ({ ...fixAt(i, northM, eastM, accuracy), segmentSeq });
  const bucketSum = (buckets: Map<number, number>) =>
    [...buckets.values()].reduce((a, b) => a + b, 0);

  test('empty input → zero distance, no points, no buckets', () => {
    const rollup = smoothTrackBySegment([]);
    expect(rollup.distanceM).toBe(0);
    expect(rollup.points).toHaveLength(0);
    expect(rollup.distanceBySegmentSeq.size).toBe(0);
  });

  test('a single fix commits nothing and opens no bucket', () => {
    const rollup = smoothTrackBySegment([seg(0, 0, 0)]);
    expect(rollup.distanceM).toBe(0);
    expect(rollup.points).toHaveLength(1);
    expect(rollup.distanceBySegmentSeq.size).toBe(0);
  });

  test('buckets partition the total exactly, and the total matches smoothTrack over the same stream', () => {
    // 60-fix straight 1.4 m/s walker; seg 0 = fixes 0–29, seg 1 = fixes 30–59.
    const fixes = Array.from({ length: 60 }, (_, i) => seg(i, i * 1.4, i < 30 ? 0 : 1));
    const rollup = smoothTrackBySegment(fixes);
    expect(rollup.distanceBySegmentSeq.size).toBe(2);
    expect(bucketSum(rollup.distanceBySegmentSeq)).toBeCloseTo(rollup.distanceM, 9);
    expect(rollup.distanceM).toBeCloseTo(smoothTrack(fixes).distanceM, 9);
  });

  test('the boundary delta is attributed to the segment its END fix falls in', () => {
    // The 29→30 delta belongs to seg 1 (fix 30 is its first fix): seg 1 holds 30 deltas, seg 0 holds 29.
    const fixes = Array.from({ length: 60 }, (_, i) => seg(i, i * 1.4, i < 30 ? 0 : 1));
    const rollup = smoothTrackBySegment(fixes);
    expect(rollup.distanceBySegmentSeq.get(0)!).toBeCloseTo(29 * 1.4, 0); // ≈ 40.6
    expect(rollup.distanceBySegmentSeq.get(1)!).toBeCloseTo(30 * 1.4, 0); // ≈ 42.0
  });

  test('a velocity-gated fix opens no bucket for a segment that holds only that fix', () => {
    // seg 1 is a lone 200 m east teleport at fix 3 → gate-rejected (Δ=0, no point): seg 1 accrues nothing.
    const fixes = [
      seg(0, 0, 0),
      seg(1, 1.4, 0),
      seg(2, 2.8, 0),
      seg(3, 2.8, 1, 200),
      seg(4, 4.2, 2),
      seg(5, 5.6, 2),
    ];
    const rollup = smoothTrackBySegment(fixes);
    expect(rollup.distanceBySegmentSeq.has(1)).toBe(false);
    expect(bucketSum(rollup.distanceBySegmentSeq)).toBeCloseTo(rollup.distanceM, 9);
    expect(rollup.distanceM).toBeCloseTo(smoothTrack(fixes).distanceM, 9);
  });

  test('a gap-reset fix commits nothing and never counts the across-gap chord', () => {
    // 98 s gap into seg 1; the post-gap fix resets the anchor (ADR 0021 §5) → Δ=0, 1000 m chord uncounted.
    const fixes = [
      seg(0, 0, 0),
      seg(1, 1.4, 0),
      seg(2, 2.8, 0),
      seg(100, 2.8, 1, 1000),
      seg(101, 4.2, 1, 1000),
      seg(102, 5.6, 1, 1000),
    ];
    const rollup = smoothTrackBySegment(fixes);
    expect(bucketSum(rollup.distanceBySegmentSeq)).toBeCloseTo(rollup.distanceM, 9);
    expect(rollup.distanceM).toBeCloseTo(smoothTrack(fixes).distanceM, 9);
    expect(rollup.distanceM).toBeLessThan(20);
  });

  test('a segment with no fixes contributes no bucket key (sparse map)', () => {
    // seg 1 is skipped and receives no fixes; the map holds only seqs that accrued distance.
    const fixes = [
      ...Array.from({ length: 5 }, (_, i) => seg(i, i * 1.4, 0)),
      ...Array.from({ length: 5 }, (_, i) => seg(5 + i, (5 + i) * 1.4, 2)),
    ];
    const rollup = smoothTrackBySegment(fixes);
    expect([...rollup.distanceBySegmentSeq.keys()].sort((a, b) => a - b)).toEqual([0, 2]);
    expect(bucketSum(rollup.distanceBySegmentSeq)).toBeCloseTo(rollup.distanceM, 9);
  });
});

/** A straight northbound 1 Hz walker; `segments` gives the segmentSeq per fix. */
function makeSegmentedTrack(segments: readonly number[], startMs = 0): SegmentedFix[] {
  return segments.map((segmentSeq, i) => ({
    timestamp: startMs + i * 1000,
    lat: i * 0.000012, // ~1.34 m/s
    lng: 0,
    altitude: null,
    accuracy: 5,
    speed: null,
    segmentSeq,
  }));
}

describe('simplifyPolyline', () => {
  const M = M_PER_DEG;
  const north = (m: number): LatLng => ({ lat: m / M, lng: 0 });
  const eastNorth = (eM: number, nM: number): LatLng => ({ lat: nM / M, lng: eM / M });

  test('drops a vertex whose perpendicular distance is below epsilon', () => {
    const line = [eastNorth(0, 0), eastNorth(50, 2), eastNorth(100, 0)]; // 2 m off the chord
    expect(simplifyPolyline(line, DP_EPSILON_M)).toEqual([eastNorth(0, 0), eastNorth(100, 0)]);
  });

  test('keeps a vertex whose perpendicular distance exceeds epsilon', () => {
    const bend = [eastNorth(0, 0), eastNorth(50, 10), eastNorth(100, 0)]; // 10 m off the chord
    expect(simplifyPolyline(bend, DP_EPSILON_M)).toHaveLength(3);
  });

  test('always keeps the endpoints and preserves order', () => {
    const pts = [north(0), north(1), north(2), north(3), north(100)];
    const simplified = simplifyPolyline(pts, DP_EPSILON_M);
    expect(simplified[0]).toEqual(pts[0]);
    expect(simplified[simplified.length - 1]).toEqual(pts[pts.length - 1]);
  });

  test('returns short inputs unchanged (new array)', () => {
    expect(simplifyPolyline([])).toEqual([]);
    expect(simplifyPolyline([north(0)])).toEqual([north(0)]);
    expect(simplifyPolyline([north(0), north(5)])).toEqual([north(0), north(5)]);
  });
});

describe('SmoothStep.restarted', () => {
  test('is true on the first fix', () => {
    const step = smoothFix(createSmootherState(), makeFix({ timestamp: 0 }));
    expect(step.restarted).toBe(true);
  });

  test('is false on an ordinary following fix', () => {
    const first = smoothFix(createSmootherState(), makeFix({ timestamp: 0 }));
    const second = smoothFix(first.state, makeFix({ timestamp: 1000, lat: 0.00001 }));
    expect(second.restarted).toBe(false);
  });

  test('is true past MAX_GAP_S but false exactly at it', () => {
    const start = smoothFix(createSmootherState(), makeFix({ timestamp: 0 }));
    const atLimit = smoothFix(start.state, makeFix({ timestamp: MAX_GAP_S * 1000 }));
    expect(atLimit.restarted).toBe(false);

    const pastLimit = smoothFix(start.state, makeFix({ timestamp: MAX_GAP_S * 1000 + 1 }));
    expect(pastLimit.restarted).toBe(true);
  });

  test('is false when the velocity gate rejects a fix', () => {
    let state = createSmootherState();
    for (let i = 0; i < 5; i++) {
      state = smoothFix(state, makeFix({ timestamp: i * 1000, lat: i * 0.00002 })).state;
    }
    // 0.05 deg latitude in 1 s ≈ 5.5 km/s — far above the gate ceiling.
    const gated = smoothFix(state, makeFix({ timestamp: 5000, lat: 0.05 }));
    expect(gated.smoothedPoint).toBeNull();
    expect(gated.restarted).toBe(false);
  });

  test('is false on a non-monotonic timestamp', () => {
    const start = smoothFix(createSmootherState(), makeFix({ timestamp: 5000 }));
    const backwards = smoothFix(start.state, makeFix({ timestamp: 4000 }));
    expect(backwards.smoothedPoint).toBeNull();
    expect(backwards.restarted).toBe(false);
  });
});

describe('smoothTrackForRender', () => {
  test('drops the raw seed fixes', () => {
    const fixes = makeSegmentedTrack([0, 0, 0, 0, 0]);
    const points = smoothTrackForRender(fixes);
    expect(points).toHaveLength(fixes.length - SEED_FIXES);
  });

  test('a legal but far cold-start fix never reaches the output', () => {
    const fixes = makeSegmentedTrack([0, 0, 0, 0, 0, 0, 0, 0]);
    // A 45 m eastward error on the first fix passes accuracyFilter (<= 50 m).
    fixes[0] = { ...fixes[0], lng: 45 / (111_320 * Math.cos(0)), accuracy: 45 };
    const points = smoothTrackForRender(fixes);
    const maxEastM = Math.max(...points.map((p) => Math.abs(p.point.lng) * 111_320));
    expect(maxEastM).toBeLessThan(7);
  });

  test('tags points with their segmentSeq', () => {
    const points = smoothTrackForRender(makeSegmentedTrack([0, 0, 0, 1, 1, 2, 2]));
    expect(points.map((p) => p.segmentSeq)).toEqual([0, 1, 1, 2, 2]);
  });

  test('no point is flagged gapBefore on a continuous track', () => {
    const points = smoothTrackForRender(makeSegmentedTrack([0, 0, 0, 0, 0]));
    expect(points.some((p) => p.gapBefore)).toBe(false);
  });

  test('carries the gap flag to the first point emitted after the gap', () => {
    const before = makeSegmentedTrack([0, 0, 0, 0, 0]);
    const afterStart = (MAX_GAP_S + 10) * 1000;
    const after = makeSegmentedTrack([1, 1, 1, 1, 1], afterStart).map((f) => ({
      ...f,
      lat: 0.001 + f.lat,
    }));
    const points = smoothTrackForRender([...before, ...after]);
    const flagged = points.filter((p) => p.gapBefore);
    expect(flagged).toHaveLength(1);
    // The gap's own restarted fix is a dropped seed, so the flag lands on the first KEPT point after it.
    expect(flagged[0].segmentSeq).toBe(1);
    expect(points.indexOf(flagged[0])).toBe(before.length - SEED_FIXES);
  });
});

/**
 * RenderPoints marching due north ~22 m apart, one per entry of `segments`; `gaps` holds the indices
 * flagged `gapBefore`. The points are deliberately collinear, so DP reduces every chunk to its two
 * endpoints — which is exactly what makes the boundary-sharing assertions meaningful.
 */
function makeRenderPoints(
  segments: readonly number[],
  gaps: readonly number[] = [],
): RenderPoint[] {
  return segments.map((segmentSeq, i) => ({
    point: { lat: i * 0.0002, lng: 0 },
    segmentSeq,
    gapBefore: gaps.includes(i),
  }));
}

describe('toSegmentPolylines', () => {
  test('adjacent chunks share a bit-identical boundary vertex', () => {
    const chunks = toSegmentPolylines(makeRenderPoints([0, 0, 0, 1, 1, 1]));
    expect(chunks).toHaveLength(2);
    const seam = chunks[0].points.at(-1)!;
    expect(chunks[1].points[0]).toBe(seam); // same object reference, not merely equal
  });

  test('every adjacent pair shares a vertex across many segments', () => {
    const segments = Array.from({ length: 17 }, (_, s) => [s, s, s]).flat();
    const chunks = toSegmentPolylines(makeRenderPoints(segments));
    expect(chunks).toHaveLength(17);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].points[0]).toBe(chunks[i - 1].points.at(-1)!);
    }
  });

  test('a real gap leaves the chunks disjoint and flags the second', () => {
    const chunks = toSegmentPolylines(makeRenderPoints([0, 0, 0, 1, 1, 1], [3]));
    expect(chunks).toHaveLength(2);
    expect(chunks[1].gapBefore).toBe(true);
    expect(chunks[1].points[0]).not.toBe(chunks[0].points.at(-1));
  });

  test('a mid-segment gap yields two chunks with the same segmentSeq', () => {
    const chunks = toSegmentPolylines(makeRenderPoints([0, 0, 0, 0, 0, 0], [3]));
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.segmentSeq)).toEqual([0, 0]);
  });

  test('a segment that emitted no points does not break continuity', () => {
    // segmentSeq 1 never appears in the render stream (all its fixes were gated).
    const chunks = toSegmentPolylines(makeRenderPoints([0, 0, 0, 2, 2, 2]));
    expect(chunks.map((c) => c.segmentSeq)).toEqual([0, 2]);
    expect(chunks[1].points[0]).toBe(chunks[0].points.at(-1)!);
  });

  test('a single-point segment survives via the prepend', () => {
    // The compressed-plan E2E case: most segments contribute one fix.
    const chunks = toSegmentPolylines(makeRenderPoints([0, 1, 2, 3]));
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) expect(chunk.points.length).toBeGreaterThanOrEqual(2);
  });

  test('drops a chunk that cannot form a line', () => {
    const chunks = toSegmentPolylines(makeRenderPoints([0], [0]));
    expect(chunks).toHaveLength(0); // one point, no prepend (gapBefore) → nothing to draw
  });
});

/** Inverse of the library's conversion: what span (in degrees) a zoom asks for. */
function spanDegForZoom(zoom: number): number {
  return 360 / 2 ** zoom;
}

/** Does the region MapKit will show contain the bbox? Mirrors the expand-only fit in projected units. */
function containsBbox(bbox: BoundingBox, fit: CameraFit, aspectRatio: number): boolean {
  const f = 1 / Math.cos(fit.center.lat * (Math.PI / 180));
  const s = spanDegForZoom(fit.zoom);
  const shownLng = s * Math.max(1, aspectRatio * f);
  const shownLat = (s * Math.max(1 / aspectRatio, f)) / f;
  return (
    shownLng >= bbox.maxLng - bbox.minLng - 1e-12 && shownLat >= bbox.maxLat - bbox.minLat - 1e-12
  );
}

describe('cameraForBoundingBox', () => {
  const stockholm: BoundingBox = { minLat: 59.32, maxLat: 59.34, minLng: 18.06, maxLng: 18.08 };

  test('centres on the bbox midpoint', () => {
    const fit = cameraForBoundingBox(stockholm, 1.5);
    expect(fit.center.lat).toBeCloseTo(59.33, 10);
    expect(fit.center.lng).toBeCloseTo(18.07, 10);
  });

  test('contains the bbox for a square aspect', () => {
    expect(containsBbox(stockholm, cameraForBoundingBox(stockholm, 1), 1)).toBe(true);
  });

  test('contains the bbox when A·f > 1 (the card)', () => {
    const aspect = 1.5; // f ≈ 1.96 at 59.33°N → A·f ≈ 2.9
    expect(containsBbox(stockholm, cameraForBoundingBox(stockholm, aspect), aspect)).toBe(true);
  });

  test('contains the bbox when A·f < 1 (the real full-screen regime)', () => {
    const aspect = 393 / 852; // iPhone 15 Pro portrait → A·f ≈ 0.90, the second max() branch
    expect(aspect * (1 / Math.cos(59.33 * (Math.PI / 180)))).toBeLessThan(1);
    expect(containsBbox(stockholm, cameraForBoundingBox(stockholm, aspect), aspect)).toBe(true);
  });

  test('contains a pure east-west and a pure north-south line', () => {
    const ew: BoundingBox = { minLat: 59.33, maxLat: 59.33, minLng: 18.06, maxLng: 18.09 };
    const ns: BoundingBox = { minLat: 59.32, maxLat: 59.35, minLng: 18.07, maxLng: 18.07 };
    for (const aspect of [0.46, 1, 1.5]) {
      expect(containsBbox(ew, cameraForBoundingBox(ew, aspect), aspect)).toBe(true);
      expect(containsBbox(ns, cameraForBoundingBox(ns, aspect), aspect)).toBe(true);
    }
  });

  test('padding adds p/(1+2p) slack per side', () => {
    const tight = cameraForBoundingBox(stockholm, 1, 0);
    const padded = cameraForBoundingBox(stockholm, 1, 0.15);
    const ratio = spanDegForZoom(padded.zoom) / spanDegForZoom(tight.zoom);
    expect(ratio).toBeCloseTo(1.3, 6); // 1 + 2·0.15
  });

  test('floors a degenerate bbox instead of returning an infinite zoom', () => {
    const point: BoundingBox = { minLat: 59.33, maxLat: 59.33, minLng: 18.07, maxLng: 18.07 };
    const fit = cameraForBoundingBox(point, 1.5);
    expect(Number.isFinite(fit.zoom)).toBe(true);
    expect(spanDegForZoom(fit.zoom)).toBeCloseTo(MIN_SPAN_DEG * 1.3, 8);
  });

  test('zoom decreases monotonically as the bbox grows', () => {
    let previous = Infinity;
    for (const size of [0.002, 0.02, 0.2, 2]) {
      const box: BoundingBox = {
        minLat: 59.33,
        maxLat: 59.33 + size,
        minLng: 18.07,
        maxLng: 18.07 + size,
      };
      const { zoom } = cameraForBoundingBox(box, 1.5);
      expect(zoom).toBeLessThan(previous);
      previous = zoom;
    }
  });

  test('fittedSpanM grows with the route and is at least the floor', () => {
    const small = cameraForBoundingBox(stockholm, 1.5).fittedSpanM;
    const big = cameraForBoundingBox(
      { minLat: 59.3, maxLat: 59.4, minLng: 18.0, maxLng: 18.2 },
      1.5,
    ).fittedSpanM;
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(0);
  });
});
