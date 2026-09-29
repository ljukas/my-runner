import { describe, expect, test } from 'bun:test';

import { altitudePressureHpa } from './elevation';
import { DP_EPSILON_M, MIN_ROUTE_EXTENT_M, type SegmentedFix } from './geo';
import type { StoredAltitudeSample } from './run-altitude';
import { deriveRunRoute, deriveRunSummary, type RunSummaryInput } from './run-summary';

const DEG_PER_METRE = 1 / 111_320;
const START_MS = 1_780_000_000_000;

/** A straight northward track at 1 Hz. */
function track(seconds: number, mps: number): SegmentedFix[] {
  return Array.from({ length: seconds }, (_, i) => ({
    timestamp: START_MS + i * 1000,
    lat: 59.3 + i * mps * DEG_PER_METRE,
    lng: 18.06,
    altitude: 100,
    accuracy: 5,
    speed: mps,
    segmentSeq: 0,
  }));
}

/** Barometer samples over the same seconds, climbing `climbM` linearly. */
function climbing(seconds: number, climbM: number): StoredAltitudeSample[] {
  return Array.from({ length: seconds }, (_, i) => ({
    at: new Date(START_MS + i * 1000).toISOString(),
    pressureHpa: altitudePressureHpa(70 + (climbM * i) / (seconds - 1)),
  }));
}

type SummaryOverrides = Partial<
  Omit<RunSummaryInput, 'hasAltitudeSamples' | 'loadAltitudeSamples'>
> & {
  altitudeSamples?: StoredAltitudeSample[];
};

function summaryOf({ altitudeSamples = climbing(600, 20), ...overrides }: SummaryOverrides = {}) {
  return deriveRunSummary({
    fixes: track(600, 3),
    hasAltitudeSamples: altitudeSamples.length > 0,
    loadAltitudeSamples: () => altitudeSamples,
    pauses: [],
    distanceM: 1800,
    activeDurationS: 600,
    ...overrides,
  });
}

describe('deriveRunRoute', () => {
  test('a stationary run is rejected, a real route clears the gate', () => {
    expect(deriveRunRoute(track(60, 0), DP_EPSILON_M)).toBeNull();
    const route = deriveRunRoute(track(600, 3), DP_EPSILON_M)!;
    expect(route.chunks.length).toBeGreaterThan(0);
    expect(route.bbox.maxLat - route.bbox.minLat).toBeGreaterThan(
      MIN_ROUTE_EXTENT_M * DEG_PER_METRE,
    );
  });
});

describe('deriveRunSummary', () => {
  test('a measured run with barometer samples shows route, profile and an estimated climb', () => {
    const summary = summaryOf();
    expect(summary.route).not.toBeNull();
    expect(summary.profile!.some((point) => point.elevationM !== null)).toBe(true);
    expect(summary.elevation).toMatchObject({ status: 'estimated' });
    if (summary.elevation?.status !== 'estimated') throw new Error('unreachable');
    expect(summary.elevation.gainM).toBeGreaterThan(19);
  });

  test('no samples at all means no elevation, not "insufficient"', () => {
    const summary = summaryOf({ altitudeSamples: [] });
    expect(summary.elevation).toBeNull();
    expect(summary.profile!.every((point) => point.elevationM === null)).toBe(true);
  });

  test('samples without a route are insufficient, and so is the profile', () => {
    const summary = summaryOf({ fixes: track(60, 0), distanceM: 0 });
    expect(summary.route).toBeNull();
    expect(summary.profile).toBeNull();
    expect(summary.elevation).toEqual({ status: 'insufficient' });
  });

  test('a route with drift-slow distance withholds profile and elevation alike', () => {
    // 1800 m of track, but a stored distance under the 0.5 m/s speed floor.
    const summary = summaryOf({ distanceM: 200, activeDurationS: 600 });
    expect(summary.route).not.toBeNull();
    expect(summary.profile).toBeNull();
    expect(summary.elevation).toEqual({ status: 'insufficient' });
  });

  test('too few samples to fill the reducer window are insufficient', () => {
    const summary = summaryOf({ altitudeSamples: climbing(600, 20).slice(0, 3) });
    expect(summary.elevation).toEqual({ status: 'insufficient' });
  });

  test('an elevation fold that throws keeps the route and the pace line, and claims no shortfall', () => {
    const poisoned = climbing(600, 20);
    Object.defineProperty(poisoned[10], 'at', {
      get() {
        throw new Error('corrupt row');
      },
    });
    const summary = summaryOf({ altitudeSamples: poisoned });
    expect(summary.route).not.toBeNull();
    expect(summary.profile).not.toBeNull();
    expect(summary.elevation).toBeNull();
  });

  test('a route derivation that throws claims no shortfall either', () => {
    const fixes = track(600, 3);
    Object.defineProperty(fixes[10], 'lat', {
      get() {
        throw new Error('corrupt row');
      },
    });
    const summary = summaryOf({ fixes });
    expect(summary.route).toBeNull();
    expect(summary.elevation).toBeNull();
  });

  test('the samples are read only when there is a route and a measured distance to set them on', () => {
    let reads = 0;
    const summary = deriveRunSummary({
      fixes: track(60, 0),
      hasAltitudeSamples: true,
      loadAltitudeSamples: () => {
        reads += 1;
        return climbing(60, 0);
      },
      pauses: [],
      distanceM: 0,
      activeDurationS: 60,
    });
    expect(reads).toBe(0);
    expect(summary.elevation).toEqual({ status: 'insufficient' });
  });

  test('a climb made while paused is not Elevation Gain', () => {
    // The whole 20 m climb falls inside one pause.
    const summary = summaryOf({ pauses: [{ fromMs: START_MS, toMs: START_MS + 600_000 }] });
    expect(summary.elevation).toEqual({ status: 'insufficient' });
    const partial = summaryOf({
      pauses: [{ fromMs: START_MS + 100_000, toMs: START_MS + 500_000 }],
    });
    if (partial.elevation?.status !== 'estimated') throw new Error('expected an estimate');
    expect(partial.elevation.gainM).toBeLessThan(8);
  });
});
