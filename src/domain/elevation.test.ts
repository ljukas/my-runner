import { describe, expect, test } from 'bun:test';

import {
  createElevationState,
  elevationRollup,
  elevationStep,
  GPS_ELEVATION_CONFIG,
  type AltitudeSample,
} from './elevation';

function samples(altitudes: (number | null)[]): AltitudeSample[] {
  return altitudes.map((altitudeM, i) => ({ timestamp: 1_000_000 + i * 1000, altitudeM }));
}

/** Seeded PRNG so a failure reproduces exactly. NEVER use a sinusoid for noise here:
 *  a median filter annihilates a coherent sinusoid, so a sinusoidal fixture passes
 *  while the reducer banks hundreds of phantom metres against real noise. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 30 minutes at 1 Hz on flat ground with +-`amplitude` m of vertical noise. */
function flatWithNoise(amplitude: number, seed: number): AltitudeSample[] {
  const random = mulberry32(seed);
  return samples(Array.from({ length: 1800 }, () => 100 + (random() * 2 - 1) * amplitude));
}

function meanPhantomGain(amplitude: number): number {
  let total = 0;
  for (let seed = 1; seed <= 5; seed += 1) {
    total += elevationRollup(flatWithNoise(amplitude, seed)).gainM;
  }
  return total / 5;
}

const RAMP = 300;
const flat = (count: number, value: number) => Array.from({ length: count }, () => value);
const rampUp = Array.from({ length: RAMP }, (_, i) => 100 + (i * 40) / RAMP);
const rampDown = Array.from({ length: RAMP }, (_, i) => 140 - (i * 40) / RAMP);

describe('elevationRollup noise rejection', () => {
  test('realistic +-10 m noise on flat ground banks essentially nothing', () => {
    // why this matters: raw per-sample summing inflates a flat run's gain into the
    // hundreds of metres (ADR 0015). This is the reason the module exists.
    // Do NOT loosen this bound — retune GPS_ELEVATION_CONFIG instead.
    expect(meanPhantomGain(10)).toBeLessThan(5);
  });

  test('+-25 m noise defeats the GPS config — the reason totals are not displayed', () => {
    // why assert the bad outcome: spec §3.5 cut the displayed gain/loss totals because
    // GPS cannot support them in poor conditions. This pins that finding so the totals
    // cannot quietly return. If this ever FAILS, that is good news — noise rejection
    // improved, and spec §3.5's conclusion should be revisited deliberately.
    expect(meanPhantomGain(25)).toBeGreaterThan(20);
  });
});

describe('elevationRollup real terrain', () => {
  test('a clean 40 m climb banks its full height and no loss', () => {
    // why padded: the trailing median warms up at the start but lags at the end, and an
    // unpadded fixture bakes that boundary artifact into the assertion (spec §3.5).
    const result = elevationRollup(samples([...flat(40, 100), ...rampUp, ...flat(40, 140)]));
    expect(result.gainM).toBeGreaterThan(35);
    expect(result.gainM).toBeLessThanOrEqual(40);
    expect(result.lossM).toBe(0);
  });

  test('a symmetric climb and descent banks the two equally', () => {
    const result = elevationRollup(
      samples([...flat(40, 100), ...rampUp, ...rampDown, ...flat(40, 100)]),
    );
    // why not the full 40: a final partial move below the hysteresis threshold never banks.
    expect(result.gainM).toBeGreaterThan(25);
    expect(result.lossM).toBeGreaterThan(25);
    expect(Math.abs(result.gainM - result.lossM)).toBeLessThan(2);
  });

  test('a sub-threshold bump that reverses banks nothing', () => {
    const result = elevationRollup(samples([...flat(40, 100), 102, 104, 102, ...flat(40, 100)]));
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
  });
});

describe('elevationRollup series', () => {
  test('is rebased so the first known altitude reads 0', () => {
    const result = elevationRollup(samples(flat(40, 850)));
    expect(result.seriesM[0]).toBe(0);
    expect(result.seriesM.at(-1)).toBe(0);
  });

  test('preserves nulls and never banks movement from them', () => {
    const result = elevationRollup(samples([null, 100, null, 100, null]));
    expect(result.seriesM[0]).toBeNull();
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
  });

  test('an all-null run yields an all-null series and no movement', () => {
    const result = elevationRollup(samples([null, null, null]));
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
    expect(result.seriesM.every((value) => value === null)).toBe(true);
  });

  test('empty and single-sample inputs are safe', () => {
    expect(elevationRollup([])).toEqual({ gainM: 0, lossM: 0, seriesM: [] });
    expect(elevationRollup(samples([100])).gainM).toBe(0);
  });

  test('equals a manual fold of elevationStep', () => {
    // why: the live path and the re-derived path must agree by construction
    // (the ADR 0021 §3 property, applied to elevation).
    const input = samples([...flat(40, 100), ...rampUp]);
    let state = createElevationState();
    for (const sample of input) state = elevationStep(state, sample).state;

    const result = elevationRollup(input);
    expect(result.gainM).toBe(state.gainM);
    expect(result.lossM).toBe(state.lossM);
  });
});

describe('ElevationConfig', () => {
  test('a gentle config resolves terrain the GPS config smooths away', () => {
    // why this test exists: it is the whole argument for tuning being a parameter.
    // The same clean 30 m climb, at barometer precision, banks its full height under a
    // gentle config and only two thirds of it under the noise-rejecting GPS one.
    const climb = samples([
      ...flat(10, 100),
      ...Array.from({ length: 60 }, (_, i) => 100 + i * 0.5),
      ...flat(10, 130),
    ]);
    const gentle = elevationRollup(climb, { medianWindow: 5, hysteresisM: 2 });
    const gps = elevationRollup(climb, GPS_ELEVATION_CONFIG);

    expect(gentle.gainM).toBeGreaterThan(gps.gainM);
    expect(gentle.gainM).toBeGreaterThan(25);
  });

  test('defaults to the GPS config', () => {
    expect(createElevationState().config).toEqual(GPS_ELEVATION_CONFIG);
  });
});

describe('elevationStep trend', () => {
  test('starts flat', () => {
    expect(createElevationState().trend).toBe('flat');
  });

  test('becomes climbing once a rise clears the threshold, and stays climbing', () => {
    let state = createElevationState();
    for (const sample of samples([...flat(40, 100), ...rampUp])) {
      state = elevationStep(state, sample).state;
    }
    expect(state.trend).toBe('climbing');

    // why sticky: a banked move resets the anchor to the current altitude, so a
    // non-sticky trend would flicker to flat between every banked step of one climb.
    for (const sample of samples(flat(5, 140))) state = elevationStep(state, sample).state;
    expect(state.trend).toBe('climbing');
  });

  test('flips to descending only after a threshold-clearing reversal', () => {
    let state = createElevationState();
    for (const sample of samples([...flat(40, 100), ...rampUp])) {
      state = elevationStep(state, sample).state;
    }
    expect(state.trend).toBe('climbing');
    for (const sample of samples(rampDown)) state = elevationStep(state, sample).state;
    expect(state.trend).toBe('descending');
  });

  test('state stays JSON-serialisable', () => {
    // why: the engine snapshots this for crash recovery (ADR 0007) when the live
    // readout lands — a Map or a class would silently break that.
    let state = createElevationState();
    for (const sample of samples([...flat(40, 100), ...rampUp])) {
      state = elevationStep(state, sample).state;
    }
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
