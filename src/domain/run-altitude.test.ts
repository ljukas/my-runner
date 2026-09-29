import { describe, expect, test } from 'bun:test';

import { BAROMETER_ELEVATION_CONFIG, pressureAltitudeM } from './elevation';
import { runElevation, type StoredAltitudeSample } from './run-altitude';

const START_MS = Date.parse('2026-08-05T18:32:10.000Z');
const BASE_ALTITUDE_M = 70;

/** Inverse of `pressureAltitudeM`, so fixtures are written in metres. */
function pressureAt(altitudeM: number): number {
  return 1013.25 * (1 - altitudeM / 44330) ** 5.255;
}

function samplesAt(relativeAltitudesM: readonly number[]): StoredAltitudeSample[] {
  return relativeAltitudesM.map((relative, i) => ({
    at: new Date(START_MS + i * 1000).toISOString(),
    pressureHpa: pressureAt(BASE_ALTITUDE_M + relative),
  }));
}

const flat = (seconds: number, altitudeM = 0) => Array.from({ length: seconds }, () => altitudeM);
const ramp = (seconds: number, fromM: number, toM: number) =>
  Array.from({ length: seconds }, (_, i) => fromM + ((toM - fromM) * i) / (seconds - 1));

describe('runElevation', () => {
  test('is null with no samples, and while the reducer window has not filled', () => {
    expect(runElevation([])).toBeNull();
    expect(runElevation(samplesAt(flat(BAROMETER_ELEVATION_CONFIG.medianWindow - 1)))).toBeNull();
  });

  test('banks a climb as gain and a descent as loss, from pressure alone', () => {
    const elevation = runElevation(
      samplesAt([
        ...flat(30),
        ...ramp(60, 0, 12),
        ...flat(30, 12),
        ...ramp(60, 12, 0),
        ...flat(30),
      ]),
    )!;
    // why "within one threshold": hysteresis leaves up to `hysteresisM` of each leg unbanked.
    const { hysteresisM } = BAROMETER_ELEVATION_CONFIG;
    expect(12 - elevation.gainM).toBeLessThan(hysteresisM);
    expect(12 - elevation.lossM).toBeLessThan(hysteresisM);
  });

  test('sub-threshold wobble banks nothing', () => {
    const wobble = Array.from({ length: 600 }, (_, i) => (i % 2 === 0 ? 0.3 : -0.3));
    expect(runElevation(samplesAt(wobble))!.gainM).toBe(0);
  });

  test('the series is relative to the first reported altitude and chronological', () => {
    const { series } = runElevation(samplesAt([...flat(10), ...ramp(20, 0, 5), ...flat(10, 5)]))!;
    expect(series[0].relativeM).toBe(0);
    expect(series.at(-1)!.relativeM).toBeCloseTo(5, 1);
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i].timestamp).toBeGreaterThan(series[i - 1].timestamp);
    }
  });

  test('folds across a sample gap: the net change banks, nothing is invented', () => {
    const before = samplesAt(flat(60));
    const after = samplesAt(flat(60, 4)).map((sample, i) => ({
      ...sample,
      at: new Date(START_MS + (60 + 600 + i) * 1000).toISOString(),
    }));
    const elevation = runElevation([...before, ...after])!;
    expect(elevation.gainM).toBeCloseTo(4, 1);
    expect(elevation.lossM).toBe(0);
  });

  test('skips unparseable times, non-finite pressure and a clock step backwards', () => {
    const clean = samplesAt(ramp(60, 0, 6));
    const dirty = [
      ...clean.slice(0, 20),
      { at: 'not a time', pressureHpa: pressureAt(500) },
      { at: clean[20].at, pressureHpa: Number.NaN },
      { at: new Date(START_MS - 60_000).toISOString(), pressureHpa: pressureAt(500) },
      ...clean.slice(20),
    ];
    expect(runElevation(dirty)).toEqual(runElevation(clean));
  });

  test('weather drift banks as elevation — accepted for now (ADR 0015, 2026-09-29)', () => {
    // ~5 m/hour, the measured indoor stationary rate, over a still hour.
    const drift = Array.from({ length: 3600 }, (_, i) => (-5 * i) / 3600);
    const elevation = runElevation(samplesAt(drift))!;
    expect(elevation.gainM).toBe(0);
    expect(elevation.lossM).toBeGreaterThan(3.5);
  });
});

describe('pressureAltitudeM', () => {
  test('is zero at standard sea-level pressure and ~111 m at 1000 hPa', () => {
    expect(pressureAltitudeM(1013.25)).toBe(0);
    expect(pressureAltitudeM(1000)).toBeCloseTo(110.9, 0);
  });

  test('about 0.12 hPa per metre near the ground', () => {
    expect(pressureAltitudeM(1000 - 0.12) - pressureAltitudeM(1000)).toBeCloseTo(1, 1);
  });
});
