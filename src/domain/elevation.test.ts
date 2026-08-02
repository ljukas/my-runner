import { describe, expect, test } from 'bun:test';

import {
  createElevationState,
  elevationRollup,
  elevationStep,
  ELEVATION_HYSTERESIS_M,
  type AltitudeSample,
} from './elevation';

function samples(altitudes: (number | null)[]): AltitudeSample[] {
  return altitudes.map((altitudeM, i) => ({ timestamp: 1_000_000 + i * 1000, altitudeM }));
}

/** Deterministic pseudo-noise, so a failure is reproducible. */
function noisyFlat(count: number, amplitudeM: number): AltitudeSample[] {
  return samples(
    Array.from({ length: count }, (_, i) => 100 + Math.sin(i * 2.399963) * amplitudeM),
  );
}

describe('elevationRollup', () => {
  test('noisy flat ground accumulates almost no gain', () => {
    // why this matters: raw per-sample summing of ±10 m jitter over 600 samples
    // inflates gain into the thousands (ADR 0015). Hysteresis is what stops it.
    const result = elevationRollup(noisyFlat(600, 10));
    expect(result.gainM).toBeLessThan(4 * ELEVATION_HYSTERESIS_M);
    expect(result.lossM).toBeLessThan(4 * ELEVATION_HYSTERESIS_M);
  });

  test('a clean monotonic climb banks its full height', () => {
    const climb = samples(Array.from({ length: 51 }, (_, i) => 100 + i));
    const result = elevationRollup(climb);
    expect(result.gainM).toBeGreaterThan(45);
    expect(result.gainM).toBeLessThanOrEqual(50);
    expect(result.lossM).toBe(0);
  });

  test('climb then descend banks both', () => {
    const up = Array.from({ length: 41 }, (_, i) => 100 + i);
    const down = Array.from({ length: 41 }, (_, i) => 140 - i);
    const result = elevationRollup(samples([...up, ...down]));
    expect(result.gainM).toBeGreaterThan(35);
    expect(result.lossM).toBeGreaterThan(35);
  });

  test('a sub-threshold bump that reverses banks nothing', () => {
    const result = elevationRollup(samples([100, 100, 100, 101, 102, 101, 100, 100, 100]));
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
  });

  test('series is rebased so the first known altitude reads 0', () => {
    const result = elevationRollup(samples([850, 850, 850, 850, 850, 850, 850]));
    expect(result.seriesM[0]).toBe(0);
    expect(result.seriesM.at(-1)).toBe(0);
  });

  test('null altitudes are preserved as null and never bank movement', () => {
    const result = elevationRollup(samples([null, 100, null, 100, null]));
    expect(result.seriesM[0]).toBeNull();
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
  });

  test('an all-null run produces no movement and an all-null series', () => {
    const result = elevationRollup(samples([null, null, null]));
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
    expect(result.seriesM.every((v) => v === null)).toBe(true);
  });

  test('empty and single-sample inputs are safe', () => {
    expect(elevationRollup([])).toEqual({ gainM: 0, lossM: 0, seriesM: [] });
    expect(elevationRollup(samples([100])).gainM).toBe(0);
  });

  test('the rollup equals a manual fold of elevationStep', () => {
    // why: the live path and the re-derived path must agree by construction
    // (the ADR 0021 §3 property, applied to elevation).
    const input = samples([100, 102, 106, 110, 108, 103, 99, 95, 99, 104]);
    let state = createElevationState();
    for (const sample of input) state = elevationStep(state, sample).state;

    const rollup = elevationRollup(input);
    expect(rollup.gainM).toBe(state.gainM);
    expect(rollup.lossM).toBe(state.lossM);
  });
});

describe('elevationStep trend', () => {
  test('starts flat', () => {
    expect(createElevationState().trend).toBe('flat');
  });

  test('becomes climbing once a rise clears the threshold, and stays climbing', () => {
    let state = createElevationState();
    for (const sample of samples([100, 101, 103, 106, 110, 115, 120])) {
      state = elevationStep(state, sample).state;
    }
    expect(state.trend).toBe('climbing');

    // why sticky: a banked move resets the anchor to the current altitude, so a
    // non-sticky trend would flicker to flat between every banked step of one climb.
    for (const sample of samples([121, 121.5])) state = elevationStep(state, sample).state;
    expect(state.trend).toBe('climbing');
  });

  test('flips to descending only after a threshold-clearing reversal', () => {
    let state = createElevationState();
    for (const sample of samples([100, 105, 110, 115, 120])) {
      state = elevationStep(state, sample).state;
    }
    expect(state.trend).toBe('climbing');
    for (const sample of samples([115, 110, 105, 100, 95])) {
      state = elevationStep(state, sample).state;
    }
    expect(state.trend).toBe('descending');
  });

  test('state stays JSON-serialisable', () => {
    // why: the engine snapshots this for crash recovery (ADR 0007) when the live
    // readout lands — a Map or a class would silently break that.
    let state = createElevationState();
    for (const sample of samples([100, 104, 108])) state = elevationStep(state, sample).state;
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
