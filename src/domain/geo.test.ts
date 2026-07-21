import { describe, expect, test } from 'bun:test';

import {
  accuracyFilter,
  boundingBox,
  createSmootherState,
  DP_EPSILON_M,
  EARTH_RADIUS_M,
  encodePolyline,
  haversineMeters,
  NEAR_STATIONARY_DEADBAND_M,
  simplifyPolyline,
  smoothFix,
  smoothTrack,
  smoothTrackBySegment,
  type LatLng,
  type LocationFix,
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
