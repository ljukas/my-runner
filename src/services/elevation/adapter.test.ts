import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { AltitudeReading, ElevationSource } from './port';

type MockMeasurement = { pressure: number; relativeAltitude?: number; timestamp: number };

let addListenerCalls = 0;
let removeCalls = 0;
let nativeListeners: ((measurement: MockMeasurement) => void)[] = [];
let permissionResponse = { granted: true, canAskAgain: true };

function emit(measurement: MockMeasurement): void {
  nativeListeners.forEach((listener) => listener(measurement));
}

// why mock.module, not a Metro build: expo-sensors' native module (BarometerModule /
// PedometerModule) is unreachable from `bun test`'s plain Node-style resolution — same reasoning
// as location-tracker's and health's adapter tests. mock.module is process-global for the whole
// `bun test` run, not scoped to this file (run-export.test.ts hit this), so this mock stays a
// superset covering every Barometer/Pedometer export the adapter uses.
void mock.module('expo-sensors', () => ({
  Barometer: {
    isAvailableAsync: async () => false,
    addListener: (listener: (measurement: MockMeasurement) => void) => {
      addListenerCalls += 1;
      nativeListeners.push(listener);
      return {
        remove: () => {
          removeCalls += 1;
          nativeListeners = nativeListeners.filter((l) => l !== listener);
        },
      };
    },
  },
  Pedometer: {
    getPermissionsAsync: async () => permissionResponse,
    requestPermissionsAsync: async () => permissionResponse,
  },
}));

let elevationSource: ElevationSource;

// Real filename, not the `./adapter` moduleSuffixes resolution — that's a TypeScript-only
// feature; Bun resolves module specifiers itself and needs `adapter.ios` to exist literally.
beforeAll(async () => {
  ({ elevationSource } = await import('./adapter.ios'));
});

beforeEach(async () => {
  await elevationSource.stop();
  nativeListeners = [];
  addListenerCalls = 0;
  removeCalls = 0;
  permissionResponse = { granted: true, canAskAgain: true };
});

describe('start', () => {
  test('is idempotent — a second call adds no native listener and does not bump epoch', async () => {
    await elevationSource.start();
    const readings: AltitudeReading[] = [];
    const unsubscribe = elevationSource.onReading((reading) => readings.push(reading));

    await elevationSource.start(); // second call while already running
    expect(addListenerCalls).toBe(1);

    emit({ pressure: 1000, relativeAltitude: 5, timestamp: 1 });
    emit({ pressure: 1000.5, relativeAltitude: 5.1, timestamp: 2 });
    unsubscribe();

    expect(readings).toHaveLength(2);
    expect(readings[0]?.epoch).toBe(readings[1]?.epoch);
  });

  test('epoch increments across a stop-then-start cycle; every reading in a cycle shares it', async () => {
    await elevationSource.start();
    const firstCycle: AltitudeReading[] = [];
    const unsubscribeFirst = elevationSource.onReading((reading) => firstCycle.push(reading));
    emit({ pressure: 1000, relativeAltitude: 1, timestamp: 1 });
    emit({ pressure: 1001, relativeAltitude: 2, timestamp: 2 });
    unsubscribeFirst();

    await elevationSource.stop();
    await elevationSource.start();

    const secondCycle: AltitudeReading[] = [];
    const unsubscribeSecond = elevationSource.onReading((reading) => secondCycle.push(reading));
    emit({ pressure: 1002, relativeAltitude: 3, timestamp: 3 });
    unsubscribeSecond();

    expect(firstCycle[0]?.epoch).toBe(firstCycle[1]?.epoch);
    expect(secondCycle[0]?.epoch).toBe((firstCycle[0]?.epoch ?? 0) + 1);
  });
});

describe('readings', () => {
  test('a reading whose pressure is not finite is dropped and never reaches subscribers', async () => {
    await elevationSource.start();
    const readings: AltitudeReading[] = [];
    const unsubscribe = elevationSource.onReading((reading) => readings.push(reading));

    emit({ pressure: NaN, relativeAltitude: 5, timestamp: 1 });
    emit({ pressure: Infinity, relativeAltitude: 5, timestamp: 2 });
    emit({ pressure: 1000, relativeAltitude: 5, timestamp: 3 });
    unsubscribe();

    expect(readings).toHaveLength(1);
    expect(readings[0]?.pressureHpa).toBe(1000);
  });

  test('relativeAltitude absent or non-finite yields relativeAltitudeM: null; pressureHpa still arrives', async () => {
    await elevationSource.start();
    const readings: AltitudeReading[] = [];
    const unsubscribe = elevationSource.onReading((reading) => readings.push(reading));

    emit({ pressure: 1000, timestamp: 1 }); // relativeAltitude absent
    emit({ pressure: 1001, relativeAltitude: NaN, timestamp: 2 });
    unsubscribe();

    expect(readings).toHaveLength(2);
    expect(readings[0]?.relativeAltitudeM).toBeNull();
    expect(readings[0]?.pressureHpa).toBe(1000);
    expect(readings[1]?.relativeAltitudeM).toBeNull();
    expect(readings[1]?.pressureHpa).toBe(1001);
  });
});

describe('onReading', () => {
  test('the returned unsubscribe detaches only its own callback and never stops the native subscription', async () => {
    await elevationSource.start();
    const a: AltitudeReading[] = [];
    const b: AltitudeReading[] = [];
    const unsubscribeA = elevationSource.onReading((reading) => a.push(reading));
    const unsubscribeB = elevationSource.onReading((reading) => b.push(reading));

    unsubscribeA();
    emit({ pressure: 1000, relativeAltitude: 1, timestamp: 1 });
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);

    unsubscribeB(); // last JS subscriber gone
    expect(removeCalls).toBe(0); // native subscription must stay up (spec §4.2's cliff)

    emit({ pressure: 1001, relativeAltitude: 2, timestamp: 2 });
    expect(b).toHaveLength(1); // unsubscribed — no further deliveries
  });
});

describe('permission mapping', () => {
  test('granted maps to "granted"', async () => {
    permissionResponse = { granted: true, canAskAgain: true };
    expect(await elevationSource.getPermissionStatus()).toBe('granted');
  });

  test('not granted with canAskAgain: true maps to "undetermined"', async () => {
    permissionResponse = { granted: false, canAskAgain: true };
    expect(await elevationSource.getPermissionStatus()).toBe('undetermined');
  });

  test('not granted with canAskAgain: false maps to "denied"', async () => {
    permissionResponse = { granted: false, canAskAgain: false };
    expect(await elevationSource.getPermissionStatus()).toBe('denied');
    expect(await elevationSource.requestPermission()).toBe('denied');
  });
});
