import { describe, expect, test } from 'bun:test';

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
    pressureHpa: 1013.25 * (1 - (70 + (climbM * i) / (seconds - 1)) / 44330) ** 5.255,
  }));
}

function summaryOf(overrides: Partial<RunSummaryInput> = {}) {
  const fixes = overrides.fixes ?? track(600, 3);
  return deriveRunSummary({
    fixes,
    altitudeSamples: climbing(600, 20),
    distanceM: 1800,
    activeDurationS: 600,
    epsilon: DP_EPSILON_M,
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

  test('an elevation fold that throws keeps the route and the pace line', () => {
    const poisoned = climbing(600, 20);
    Object.defineProperty(poisoned[10], 'at', {
      get() {
        throw new Error('corrupt row');
      },
    });
    const summary = summaryOf({ altitudeSamples: poisoned });
    expect(summary.route).not.toBeNull();
    expect(summary.profile).not.toBeNull();
    expect(summary.elevation).toEqual({ status: 'insufficient' });
  });
});
