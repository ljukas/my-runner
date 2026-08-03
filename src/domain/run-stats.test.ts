import { describe, expect, test } from 'bun:test';

import { boundingBox, boundingBoxDiagonalM, MIN_ROUTE_EXTENT_M } from './geo';
import {
  bestRunSegment,
  hasMeasuredDistance,
  paceSecPerKm,
  runStats,
  segmentPaceSecPerKm,
  type PaceSegment,
} from './run-stats';

describe('runStats', () => {
  test('sums run segments only, across varying lengths', () => {
    expect(
      runStats([
        { kind: 'warmup', actualDurationS: 300 },
        { kind: 'run', actualDurationS: 60 },
        { kind: 'walk', actualDurationS: 90 },
        { kind: 'run', actualDurationS: 480 },
        { kind: 'cooldown', actualDurationS: 300 },
      ]),
    ).toEqual({ timeRunningS: 540 });
  });

  test('no run segments yields zero', () => {
    expect(
      runStats([
        { kind: 'warmup', actualDurationS: 300 },
        { kind: 'cooldown', actualDurationS: 120 },
      ]),
    ).toEqual({ timeRunningS: 0 });
  });
});

describe('paceSecPerKm', () => {
  test('derives seconds per kilometre from distance and duration', () => {
    expect(paceSecPerKm(1000, 300)).toBe(300);
    expect(paceSecPerKm(2000, 600)).toBe(300);
    expect(paceSecPerKm(500, 300)).toBe(600);
  });

  test('returns the unrounded float pace (rounding is a display concern)', () => {
    expect(paceSecPerKm(3000, 400)).toBeCloseTo((400 / 3000) * 1000, 10);
  });

  test('null when distance is zero or negative', () => {
    expect(paceSecPerKm(0, 300)).toBeNull();
    expect(paceSecPerKm(-5, 300)).toBeNull();
  });

  test('null when duration is zero or negative', () => {
    expect(paceSecPerKm(1000, 0)).toBeNull();
    expect(paceSecPerKm(1000, -10)).toBeNull();
  });
});

describe('segmentPaceSecPerKm', () => {
  test('derives pace from a segment distance and duration', () => {
    expect(segmentPaceSecPerKm({ kind: 'run', distanceM: 1000, actualDurationS: 300 })).toBe(300);
  });

  test('null when the segment has no recorded distance (GPS off)', () => {
    expect(segmentPaceSecPerKm({ kind: 'run', distanceM: null, actualDurationS: 300 })).toBeNull();
  });

  test('null when the recorded distance is zero', () => {
    expect(segmentPaceSecPerKm({ kind: 'run', distanceM: 0, actualDurationS: 300 })).toBeNull();
  });
});

describe('bestRunSegment', () => {
  test('picks the lowest-pace run segment, ignoring faster non-run segments', () => {
    const runA: PaceSegment = { kind: 'run', distanceM: 1000, actualDurationS: 300 }; // 300 s/km
    const segments: PaceSegment[] = [
      { kind: 'warmup', distanceM: 500, actualDurationS: 300 }, // 600 s/km, ignored (not a run)
      runA,
      { kind: 'walk', distanceM: 1000, actualDurationS: 240 }, // 240 s/km — faster, but not a run
      { kind: 'run', distanceM: 1000, actualDurationS: 360 }, // 360 s/km, slower run
      { kind: 'run', distanceM: null, actualDurationS: 200 }, // no recorded distance, ignored
    ];
    expect(bestRunSegment(segments)).toBe(runA);
  });

  test('skips a run segment that has a distance but no elapsed time', () => {
    const runA: PaceSegment = { kind: 'run', distanceM: 1000, actualDurationS: 300 };
    const segments: PaceSegment[] = [
      { kind: 'run', distanceM: 100, actualDurationS: 0 }, // distance but 0 s — no usable pace
      runA,
    ];
    expect(bestRunSegment(segments)).toBe(runA);
  });

  test('null when there are no run segments', () => {
    expect(
      bestRunSegment([
        { kind: 'warmup', distanceM: 500, actualDurationS: 300 },
        { kind: 'cooldown', distanceM: 500, actualDurationS: 300 },
      ]),
    ).toBeNull();
  });

  test('null when no run segment has a recorded distance', () => {
    expect(
      bestRunSegment([
        { kind: 'run', distanceM: null, actualDurationS: 300 },
        { kind: 'run', distanceM: 0, actualDurationS: 300 },
      ]),
    ).toBeNull();
  });

  test('null for an empty input', () => {
    expect(bestRunSegment([])).toBeNull();
  });

  test('ties keep the earlier segment', () => {
    const first: PaceSegment = { kind: 'run', distanceM: 1000, actualDurationS: 300 }; // 300 s/km
    const second: PaceSegment = { kind: 'run', distanceM: 2000, actualDurationS: 600 }; // 300 s/km
    expect(bestRunSegment([first, second])).toBe(first);
  });
});

describe('hasMeasuredDistance', () => {
  test('rejects a run with no recorded distance', () => {
    expect(hasMeasuredDistance(null, 1800)).toBe(false);
  });

  test('rejects the observed no-fix run: 1.2 m over 40 s', () => {
    // The case that rendered "0.00 km" beside a 556:54 /km pace.
    expect(hasMeasuredDistance(1.2, 40)).toBe(false);
  });

  test('rejects drift accumulated over a full 30-minute indoor session', () => {
    // The reason the floor is a speed, not a distance: 400 m of jitter over 30 min is more than a
    // short partial run covers, so any absolute floor rejecting this would also hide that.
    expect(hasMeasuredDistance(400, 1800)).toBe(false);
  });

  test('accepts a legitimately short partial run a distance floor would have hidden', () => {
    // 3 minutes of walking, ~1.4 m/s.
    expect(hasMeasuredDistance(250, 180)).toBe(true);
  });

  test('accepts a walk and a jog', () => {
    expect(hasMeasuredDistance(2500, 1800)).toBe(true); // ~1.4 m/s
    expect(hasMeasuredDistance(5000, 1800)).toBe(true); // ~2.8 m/s
  });

  test('accepts a short run interval, whose own distance is small but not slow', () => {
    expect(hasMeasuredDistance(4, 2)).toBe(true);
  });

  test('rejects a zero or negative duration rather than dividing by it', () => {
    expect(hasMeasuredDistance(100, 0)).toBe(false);
    expect(hasMeasuredDistance(100, -1)).toBe(false);
  });

  test('rejects a slow shuffle that the route-extent gate accepts', () => {
    // why both gates matter: the pace card renders only when the route is mappable AND the
    // distance is measured. This wander spans well over MIN_ROUTE_EXTENT_M yet averages 0.4 m/s,
    // so the extent gate alone charted a min/km line on a summary showing no pace anywhere else.
    const wander = boundingBox([
      { lat: 59.3293, lng: 18.0686 },
      { lat: 59.3293 + 240 / 111_320, lng: 18.0686 },
    ]);
    expect(boundingBoxDiagonalM(wander!)).toBeGreaterThan(MIN_ROUTE_EXTENT_M);
    expect(hasMeasuredDistance(240, 600)).toBe(false);
  });
});
