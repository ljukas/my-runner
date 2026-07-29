import { describe, expect, test } from 'bun:test';

import {
  accuracyFilter,
  boundingBox,
  CAMERA_PADDING_RATIO,
  cameraForBoundingBox,
  CHEVRON_DEDUPE_MULTIPLIER,
  CHEVRON_MAX_SIZE_M,
  CHEVRON_MIN_RUN_LENGTH_M,
  CHEVRON_MIN_SIZE_M,
  CHEVRON_SIZE_RATIO,
  CHEVRON_TARGET_COUNT,
  CHEVRON_WING_DEG,
  chevronsAlongRoute,
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
  type Chevron,
  type LatLng,
  type LocationFix,
  type RenderPoint,
  type SegmentedFix,
  type SegmentPolyline,
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

  test('a legal but far cold-start fix decays out of the drawn line', () => {
    const fixes = makeSegmentedTrack(Array.from({ length: 25 }, () => 0));
    // A 45 m eastward error on the first fix passes accuracyFilter (<= 50 m).
    fixes[0] = { ...fixes[0], lng: 45 / M_PER_DEG, accuracy: 45 };
    const eastM = smoothTrackForRender(fixes).map((p) => Math.abs(p.point.lng) * M_PER_DEG);
    // The residual transient is inherent (the filter seeds velocity from two points), so bound it
    // by a fraction of the injected error rather than by its fitted peak …
    expect(Math.max(...eastM)).toBeLessThan(45 / 4);
    // … and require the tail to converge well inside DP_EPSILON_M, where no spur can survive.
    for (const m of eastM.slice(-5)) expect(m).toBeLessThan(2);
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

  test('carries the gap flag past a dropped single-point chunk', () => {
    // The post-gap segment contributes one point, so its chunk is dropped after simplification. If
    // the flag dies with it, everything downstream reads the break as continuous line.
    const chunks = toSegmentPolylines(makeRenderPoints([0, 0, 1, 2, 2], [2]));
    expect(chunks).toHaveLength(2);
    expect(chunks[1].gapBefore).toBe(true);
    expect(chunks[1].points[0]).not.toBe(chunks[0].points.at(-1));
  });
});

/** Inverse of the library's conversion: what span (in degrees) a zoom asks for. */
function spanDegForZoom(zoom: number): number {
  return 360 / 2 ** zoom;
}

/** Degrees MapKit will actually show on each axis. Mirrors the expand-only fit in projected units. */
function shownSpanDeg(fit: CameraFit, aspectRatio: number): { lng: number; lat: number } {
  const f = 1 / Math.cos(fit.center.lat * (Math.PI / 180));
  const s = spanDegForZoom(fit.zoom);
  return { lng: s * Math.max(1, aspectRatio * f), lat: (s * Math.max(1 / aspectRatio, f)) / f };
}

function containsBbox(bbox: BoundingBox, fit: CameraFit, aspectRatio: number): boolean {
  const shown = shownSpanDeg(fit, aspectRatio);
  return (
    shown.lng >= bbox.maxLng - bbox.minLng - 1e-12 && shown.lat >= bbox.maxLat - bbox.minLat - 1e-12
  );
}

describe('cameraForBoundingBox', () => {
  const stockholm: BoundingBox = { minLat: 59.32, maxLat: 59.34, minLng: 18.06, maxLng: 18.08 };
  const wide: BoundingBox = { minLat: 59.3275, maxLat: 59.3325, minLng: 18.045, maxLng: 18.095 };
  const tall: BoundingBox = { minLat: 59.305, maxLat: 59.355, minLng: 18.0675, maxLng: 18.0725 };
  const point: BoundingBox = { minLat: 59.33, maxLat: 59.33, minLng: 18.07, maxLng: 18.07 };
  const aspects = [393 / 852, 1, 1.5];

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

  test('frames a non-square bbox tightly on its binding axis', () => {
    // Containment alone is satisfied by any wider frame; the binding axis must carry the padding
    // and nothing more, or the fit is not the minimum the spec §4.2 derivation claims.
    for (const box of [wide, tall]) {
      for (const aspect of aspects) {
        const shown = shownSpanDeg(cameraForBoundingBox(box, aspect), aspect);
        const tightest = Math.min(
          shown.lng / (box.maxLng - box.minLng),
          shown.lat / (box.maxLat - box.minLat),
        );
        expect(tightest).toBeCloseTo(1 + 2 * CAMERA_PADDING_RATIO, 9);
      }
    }
  });

  test('fittedSpanM is exactly the vertical extent the zoom will show', () => {
    // Flooring the zoom in degrees and fittedSpanM in metres let the two disagree by up to 5x.
    for (const box of [stockholm, wide, tall, point]) {
      for (const aspect of aspects) {
        const fit = cameraForBoundingBox(box, aspect);
        expect(fit.fittedSpanM / (shownSpanDeg(fit, aspect).lat * M_PER_DEG)).toBeCloseTo(1, 9);
      }
    }
  });

  test('fittedSpanM widens as the viewport narrows, for one bbox', () => {
    const portrait = cameraForBoundingBox(stockholm, 393 / 852).fittedSpanM;
    const landscape = cameraForBoundingBox(stockholm, 1.5).fittedSpanM;
    expect(portrait).toBeGreaterThan(landscape);
  });

  test('falls back to a square viewport for a degenerate aspect ratio', () => {
    const square = cameraForBoundingBox(stockholm, 1);
    for (const aspect of [NaN, 0, -1.5]) {
      expect(cameraForBoundingBox(stockholm, aspect)).toEqual(square);
    }
  });

  test('floors a degenerate bbox instead of returning an infinite zoom', () => {
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

function chunkFrom(points: LatLng[], segmentSeq = 0, gapBefore = false): SegmentPolyline {
  return { segmentSeq, points, gapBefore };
}

/** Straight leg from `origin` along `bearingDeg` for `lengthM`, as a 2-point chunk. */
function leg(origin: LatLng, bearingDeg: number, lengthM: number): SegmentPolyline {
  const rad = bearingDeg * (Math.PI / 180);
  const cosLat = Math.cos(origin.lat * (Math.PI / 180));
  return chunkFrom([
    origin,
    {
      lat: origin.lat + (Math.cos(rad) * lengthM) / M_PER_DEG,
      lng: origin.lng + (Math.sin(rad) * lengthM) / (M_PER_DEG * cosLat),
    },
  ]);
}

/** Metre offsets of `p` from `origin`, east and north. */
function offsetM(origin: LatLng, p: LatLng) {
  const cosLat = Math.cos(origin.lat * (Math.PI / 180));
  return {
    east: (p.lng - origin.lng) * M_PER_DEG * cosLat,
    north: (p.lat - origin.lat) * M_PER_DEG,
  };
}

const northOf = (origin: LatLng, m: number): LatLng => ({
  lat: origin.lat + m / M_PER_DEG,
  lng: origin.lng,
});

const gapped = (chunk: SegmentPolyline, segmentSeq: number): SegmentPolyline => ({
  ...chunk,
  segmentSeq,
  gapBefore: true,
});

/** Bearing from `from` to `p`, degrees clockwise from north, measured in metres (not degrees). */
function bearingDegFrom(from: LatLng, p: LatLng): number {
  const { east, north } = offsetM(from, p);
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

/** `b - a` wrapped into (-180, 180]. */
function angleDiffDeg(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

const tipOf = (chevron: Chevron): LatLng => chevron.points[1];

/** Tip-to-wing length, in the same flat metre frame the chevron was built in. */
function sizeOf(chevron: Chevron): number {
  const { east, north } = offsetM(tipOf(chevron), chevron.points[0]);
  return Math.hypot(east, north);
}

/** Closest pair of tips in metres; Infinity for fewer than two arrows. */
function minTipSeparationM(chevrons: readonly Chevron[]): number {
  let min = Infinity;
  for (let i = 0; i < chevrons.length; i++) {
    for (let j = i + 1; j < chevrons.length; j++) {
      min = Math.min(min, haversineMeters(tipOf(chevrons[i]), tipOf(chevrons[j])));
    }
  }
  return min;
}

/** Shortest distance from `p` to any segment of any of `polylines`, in metres. */
function distanceToPolylinesM(p: LatLng, polylines: readonly LatLng[][]): number {
  let min = Infinity;
  for (const line of polylines) {
    for (let i = 1; i < line.length; i++) {
      const a = offsetM(p, line[i - 1]);
      const b = offsetM(p, line[i]);
      const dx = b.east - a.east;
      const dy = b.north - a.north;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, -(a.east * dx + a.north * dy) / lenSq));
      min = Math.min(min, Math.hypot(a.east + t * dx, a.north + t * dy));
    }
  }
  return min;
}

/** Closed ring of `vertices` points `radiusM` from `center`, the first coordinate repeated last. */
function closedLoop(center: LatLng, radiusM: number, vertices: number): LatLng[] {
  const cosLat = Math.cos(center.lat * (Math.PI / 180));
  const ring = Array.from({ length: vertices }, (_, i) => {
    const angle = (2 * Math.PI * i) / vertices;
    return {
      lat: center.lat + (Math.cos(angle) * radiusM) / M_PER_DEG,
      lng: center.lng + (Math.sin(angle) * radiusM) / (M_PER_DEG * cosLat),
    };
  });
  return [...ring, ring[0]];
}

describe('chevronsAlongRoute', () => {
  test('emits nothing for a run below the minimum length', () => {
    const short = leg({ lat: 59.33, lng: 18.07 }, 0, CHEVRON_MIN_RUN_LENGTH_M - 5);
    expect(chevronsAlongRoute([short], 500)).toHaveLength(0);
  });

  test('gates a run at the minimum-length boundary, to within a micrometre', () => {
    const origin = { lat: 59.33, lng: 18.07 };
    // A 200 m fitted span keeps sizeM (10 m) under the absolute floor, so the constant is what binds.
    const under = leg(origin, 0, CHEVRON_MIN_RUN_LENGTH_M - 1e-6);
    const atLimit = leg(origin, 0, CHEVRON_MIN_RUN_LENGTH_M + 1e-6);
    expect(chevronsAlongRoute([under], 200)).toHaveLength(0);
    expect(chevronsAlongRoute([atLimit], 200)).toHaveLength(1);
  });

  test('a fragment shorter than the arrow it would carry gets none', () => {
    // 45 m of drawn line cannot legibly show the 100 m arrow a 2 km fitted span asks for. The global
    // grid lands a target exactly at the fragment's start, so only the length gate keeps it clear.
    const origin = { lat: 59.33, lng: 18.07 };
    const main = leg(origin, 0, 3000);
    const fragment = gapped(leg(northOf(origin, 6000), 0, 45), 1);
    const chevrons = chevronsAlongRoute([main, fragment], 2000);
    expect(chevrons.length).toBeGreaterThan(0);
    for (const chevron of chevrons) {
      expect(distanceToPolylinesM(tipOf(chevron), [fragment.points])).toBeGreaterThan(45);
    }
  });

  test('the tip interpolates along the leg — equal metre offsets north-east', () => {
    const origin = { lat: 59.33, lng: 18.07 };
    const chevrons = chevronsAlongRoute([leg(origin, 45, 800)], 800);
    expect(chevrons.length).toBeGreaterThan(0);
    const { east, north } = offsetM(origin, chevrons[0].points[1]);
    expect(east).toBeGreaterThan(0);
    expect(north).toBeGreaterThan(0);
    expect(east / north).toBeCloseTo(1, 1); // equal METRE offsets, not equal degrees
  });

  test('the same north-east geometry holds at the equator and at 60 degrees', () => {
    for (const lat of [0, 60]) {
      const origin = { lat, lng: 10 };
      const chevrons = chevronsAlongRoute([leg(origin, 45, 800)], 800);
      const { east, north } = offsetM(origin, chevrons[0].points[1]);
      expect(east / north).toBeCloseTo(1, 1);
    }
  });

  test('the wings follow the metre-frame bearing at three latitudes', () => {
    // why the wings: the tip is plain lat/lng interpolation along the leg and never sees the bearing,
    // so a missing cos(latitude) term is only visible here. why 45 deg: due-N and due-E are the two
    // bearings at which that term produces ZERO error (spec §10).
    for (const lat of [0, 59.33, 60]) {
      const [chevron] = chevronsAlongRoute([leg({ lat, lng: 18.07 }, 45, 800)], 800);
      const tip = tipOf(chevron);
      expect(bearingDegFrom(tip, chevron.points[0])).toBeCloseTo(45 + 180 + CHEVRON_WING_DEG, 1);
      expect(bearingDegFrom(tip, chevron.points[2])).toBeCloseTo(45 + 180 - CHEVRON_WING_DEG, 1);
    }
  });

  test('each wing sits CHEVRON_WING_DEG off the reverse bearing', () => {
    const origin = { lat: 59.33, lng: 18.07 };
    for (const bearing of [0, 90, 137, 250, 359]) {
      const [chevron] = chevronsAlongRoute([leg(origin, bearing, 800)], 800);
      const tip = tipOf(chevron);
      const reverse = bearing + 180;
      expect(angleDiffDeg(reverse, bearingDegFrom(tip, chevron.points[0]))).toBeCloseTo(
        CHEVRON_WING_DEG,
        1,
      );
      expect(angleDiffDeg(reverse, bearingDegFrom(tip, chevron.points[2]))).toBeCloseTo(
        -CHEVRON_WING_DEG,
        1,
      );
    }
  });

  test('the mark measures 1.15 x sizeM wide and 0.82 x sizeM deep (spec §5)', () => {
    // Pins the wing angle's magnitude against the dimensions §5 commits to, not against the constant
    // it is computed from: at 2 deg the arrows would collapse to spikes and still be "on bearing".
    const [chevron] = chevronsAlongRoute([leg({ lat: 59.33, lng: 18.07 }, 0, 800)], 800);
    const size = sizeOf(chevron);
    const wingSpan = offsetM(chevron.points[0], chevron.points[2]);
    expect(Math.hypot(wingSpan.east, wingSpan.north) / size).toBeCloseTo(1.15, 2);
    expect(-offsetM(tipOf(chevron), chevron.points[0]).north / size).toBeCloseTo(0.82, 2);
  });

  test('the size rail does not bind inside the C25K range', () => {
    // §5's goal state: a 5 km point-to-point, portrait (fits ~14 km, so it wants a ~705 m arrow). A
    // rail that binds here shrinks the arrow on screen exactly as the diagonal-sizing bug did.
    const origin = { lat: 59.33, lng: 18.07 };
    const route = [origin, leg(origin, 90, 5000).points[1]];
    const fit = cameraForBoundingBox(boundingBox(route)!, 393 / 852);
    const [chevron] = chevronsAlongRoute([chunkFrom(route)], fit.fittedSpanM);
    expect(sizeOf(chevron)).toBeCloseTo(fit.fittedSpanM * CHEVRON_SIZE_RATIO, 6);
  });

  test('wings sit behind the tip', () => {
    const origin = { lat: 0, lng: 0 };
    const [chevron] = chevronsAlongRoute([leg(origin, 0, 800)], 800); // due north
    const tip = offsetM(origin, chevron.points[1]);
    for (const wing of [chevron.points[0], chevron.points[2]]) {
      expect(offsetM(origin, wing).north).toBeLessThan(tip.north);
    }
    // ...and on opposite sides of the line
    expect(offsetM(origin, chevron.points[0]).east).toBeLessThan(0);
    expect(offsetM(origin, chevron.points[2]).east).toBeGreaterThan(0);
  });

  test('no two arrows point at each other on an out-and-back', () => {
    const origin = { lat: 59.33, lng: 18.07 };
    const out = leg(origin, 0, 700);
    const backOrigin = { ...out.points[1], lng: out.points[1].lng + 0.00007 }; // 4 m lateral offset
    const back = chunkFrom([backOrigin, { ...origin, lng: origin.lng + 0.00007 }], 1);
    const chevrons = chevronsAlongRoute([out, back], 1400);
    const size = 1400 * CHEVRON_SIZE_RATIO;

    for (let i = 0; i < chevrons.length; i++) {
      for (let j = i + 1; j < chevrons.length; j++) {
        const near =
          haversineMeters(chevrons[i].points[1], chevrons[j].points[1]) <
          size * CHEVRON_DEDUPE_MULTIPLIER;
        expect(near).toBe(false);
      }
    }
  });

  test('an out-and-back 30 m apart keeps arrows on both legs', () => {
    // At 30 m the two lines are visually distinct (~28 pt on an 852 pt viewport); suppressing the
    // return leg there reads as "I only went one way". Only a true retrace should collapse.
    const origin = { lat: 59.33, lng: 18.07 };
    const out = leg(origin, 90, 400);
    const shifted = leg(northOf(origin, 30), 90, 400);
    const back = gapped(chunkFrom([shifted.points[1], shifted.points[0]]), 1);
    const chevrons = chevronsAlongRoute([out, back], 1000); // sizeM 50 m, dedupe radius 25 m
    expect(chevrons).toHaveLength(4);
    for (const line of [out.points, back.points]) {
      const onLine = chevrons.filter((c) => distanceToPolylinesM(tipOf(c), [line]) < 0.1);
      expect(onLine).toHaveLength(2);
    }
  });

  test('drops a candidate inside the dedupe radius and keeps one just outside', () => {
    const origin = { lat: 59.33, lng: 18.07 };
    const radius = 1000 * CHEVRON_SIZE_RATIO * CHEVRON_DEDUPE_MULTIPLIER; // 25 m
    // Global spacing lands the second leg's arrows at the same two east offsets as the first's, so
    // each pair is exactly `separationM` apart and only the radius decides.
    const parallelLegs = (separationM: number) => [
      leg(origin, 90, 400),
      gapped(leg(northOf(origin, separationM), 90, 400), 1),
    ];
    expect(chevronsAlongRoute(parallelLegs(radius - 1), 1000)).toHaveLength(2);
    expect(chevronsAlongRoute(parallelLegs(radius + 1), 1000)).toHaveLength(4);
  });

  test('arrow count stays near the target however many gaps split the track', () => {
    const origin = { lat: 59.33, lng: 18.07 };
    for (const gaps of [0, 2, 5]) {
      const chunks: SegmentPolyline[] = [];
      const legLength = 2400 / (gaps + 1);
      for (let i = 0; i <= gaps; i++) {
        const start = { lat: origin.lat + i * 0.05, lng: origin.lng };
        chunks.push({ ...leg(start, 0, legLength), gapBefore: i > 0, segmentSeq: i });
      }
      const count = chevronsAlongRoute(chunks, 2400).length;
      expect(count).toBeLessThanOrEqual(CHEVRON_TARGET_COUNT + 1);
      expect(count).toBeGreaterThan(0);
    }
  });

  test('spacing is global: a long gapped route still gets ~CHEVRON_TARGET_COUNT arrows', () => {
    // 20 km at a 4 km fitted span leaves the minimum-spacing floor behind (totalM/8 = 2500 m vs
    // 4·sizeM = 800 m), which the 2400 m fixture above never does — under per-run spacing the floor
    // hides the bug. Legs sit 55 km apart so nothing is deduplicated.
    const origin = { lat: 59.33, lng: 18.07 };
    for (const gaps of [0, 2, 5, 10]) {
      const legLength = 20_000 / (gaps + 1);
      const chunks = Array.from({ length: gaps + 1 }, (_, i) => {
        const start = { lat: origin.lat + i * 0.5, lng: origin.lng };
        return { ...leg(start, 0, legLength), gapBefore: i > 0, segmentSeq: i };
      });
      expect(chevronsAlongRoute(chunks, 4000)).toHaveLength(CHEVRON_TARGET_COUNT);
    }
  });

  test('no arrow bridges a gap — every tip sits on a drawn run', () => {
    // Spec §10: chevrons must never interpolate across a dropout. The two runs are 4.7 km apart, so
    // treating them as one would plant most arrows in the void between them.
    const origin = { lat: 59.33, lng: 18.07 };
    const before = leg(origin, 0, 300);
    const after = gapped(leg(northOf(origin, 5000), 0, 300), 1);
    const chevrons = chevronsAlongRoute([before, after], 600);
    expect(chevrons.length).toBeGreaterThan(0);
    for (const chevron of chevrons) {
      expect(distanceToPolylinesM(tipOf(chevron), [before.points, after.points])).toBeLessThan(
        0.01,
      );
    }
  });

  test('on-screen size stays in a narrow band across route archetypes', () => {
    const origin = { lat: 59.33, lng: 18.07 };
    const fractions = [200, 800, 2400, 9000].map((span) => {
      const chevrons = chevronsAlongRoute([leg(origin, 0, span)], span);
      const size = haversineMeters(chevrons[0].points[1], chevrons[0].points[0]);
      return size / span; // fraction of the fitted span == fraction of the screen
    });
    const spread = Math.max(...fractions) / Math.min(...fractions);
    expect(spread).toBeLessThan(1.2);
  });

  test('clamps arrow size at both rails', () => {
    const origin = { lat: 59.33, lng: 18.07 };
    const sizeAt = (spanM: number, legM: number) =>
      sizeOf(chevronsAlongRoute([leg(origin, 0, legM)], spanM)[0]);
    expect(sizeAt(40, 200)).toBeCloseTo(CHEVRON_MIN_SIZE_M, 6); // 40 · 0.05 = 2 m, floored to 3
    expect(sizeAt(40_000, 20_000)).toBeCloseTo(CHEVRON_MAX_SIZE_M, 6); // 2 km, capped to 800
    expect(sizeAt(4000, 20_000)).toBeCloseTo(4000 * CHEVRON_SIZE_RATIO, 6); // between the rails
  });

  test('a duplicated boundary vertex still yields well-formed arrows', () => {
    // The guard for this is defensive: the placement scan's strict `<` cannot select a zero-length
    // segment, so this asserts the arrows are sound rather than that the guard fired.
    const origin = { lat: 59.33, lng: 18.07 };
    const east = leg(origin, 90, 900);
    const seam = east.points[1];
    // The shared-vertex rule means the seam appears at the end of one chunk and the start of the next.
    const next = chunkFrom([seam, { lat: seam.lat, lng: seam.lng + 0.02 }], 1);
    const chevrons = chevronsAlongRoute([east, next], 1800);
    expect(chevrons.length).toBeGreaterThan(0);
    for (const chevron of chevrons) {
      for (const p of chevron.points) {
        expect(Number.isFinite(p.lat) && Number.isFinite(p.lng)).toBe(true);
      }
      for (const wing of [chevron.points[0], chevron.points[2]]) {
        const { east: e, north: n } = offsetM(tipOf(chevron), wing);
        expect(e).toBeLessThan(0); // eastbound throughout: wings trail west …
        expect(Math.abs(n)).toBeLessThan(Math.abs(e)); // … not north or south
      }
    }
  });

  test('spreads arrows around a genuine closed loop, camera fit included', () => {
    // The only test piping a real cameraForBoundingBox output into the arrows, which is how the hook
    // wires them. 32-gon, radius 127 m → 797 m round; portrait fits 716 m, so the 4·sizeM floor sets
    // spacing at 143 m → 6 arrows, the closure pair 79 m apart.
    const loop = closedLoop({ lat: 59.33, lng: 18.07 }, 127, 32);
    const fit = cameraForBoundingBox(boundingBox(loop)!, 393 / 852);
    const chevrons = chevronsAlongRoute([chunkFrom(loop)], fit.fittedSpanM);
    expect(chevrons).toHaveLength(6);
    expect(sizeOf(chevrons[0])).toBeCloseTo(fit.fittedSpanM * CHEVRON_SIZE_RATIO, 6);
    expect(minTipSeparationM(chevrons)).toBeGreaterThan(
      fit.fittedSpanM * CHEVRON_SIZE_RATIO * CHEVRON_DEDUPE_MULTIPLIER,
    );
    for (const chevron of chevrons) {
      expect(distanceToPolylinesM(tipOf(chevron), [loop])).toBeLessThan(0.01);
    }
  });

  test('eight laps of one loop never stack arrows on the same spot', () => {
    // 8 laps of a 400 m circuit is the C25K graduation distance, and spacing = totalM/8 is then
    // exactly one lap, so every arrow targets the same physical point. Only one survives: the
    // trade-off is fewer arrows on a multi-lap route, never a cluster of overlapping ones.
    const ring = closedLoop({ lat: 59.33, lng: 18.07 }, 64, 32).slice(0, -1);
    const laps = Array.from({ length: 8 }, () => ring).flat();
    const fit = cameraForBoundingBox(boundingBox(laps)!, 393 / 852);
    const chevrons = chevronsAlongRoute([chunkFrom([...laps, ring[0]])], fit.fittedSpanM);
    expect(chevrons).toHaveLength(1);
    expect(minTipSeparationM(chevrons)).toBeGreaterThan(
      fit.fittedSpanM * CHEVRON_SIZE_RATIO * CHEVRON_DEDUPE_MULTIPLIER,
    );
  });

  test('a non-finite fitted span returns nothing instead of hanging', () => {
    // A pre-layout 0/0 aspect ratio used to reach the placement loop, whose only exits are
    // comparisons — both false for NaN.
    expect(chevronsAlongRoute([leg({ lat: 59.33, lng: 18.07 }, 0, 800)], NaN)).toEqual([]);
  });
});
