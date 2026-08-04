import { Barometer, Pedometer } from 'expo-sensors';

import type { AltitudeReading, ElevationSource, MotionPermissionStatus } from './port';

// why one module-scope subscription with a JS fan-out: expo-sensors starts the native altimeter in
// `OnStartObserving` (first listener added) and STOPS it in `OnStopObserving` (last removed). A
// per-consumer listener would let an ordinary React unmount stop the altimeter, and the next
// subscribe would rebase `relativeAltitude` to 0 — the silent cliff (spec §4.2). Mirrors
// `location-tracker/adapter.ios.ts`'s listeners Set.
let subscription: { remove: () => void } | null = null;
let epoch = 0;
const listeners = new Set<(reading: AltitudeReading) => void>();

function toStatus(granted: boolean, canAskAgain: boolean): MotionPermissionStatus {
  if (granted) return 'granted';
  return canAskAgain ? 'undetermined' : 'denied';
}

// why Pedometer and not Barometer: `BarometerModule.swift` declares no permission functions, so
// `DeviceSensor` falls through to a hardcoded `{ granted: true }` and never prompts. Pedometer
// registers `EXMotionPermissionRequester`, and CoreMotion has ONE Motion & Fitness authorization
// shared by CMAltimeter and CMPedometer (spec §6.3).
export const elevationSource: ElevationSource = {
  async isAvailable() {
    try {
      return await Barometer.isAvailableAsync();
    } catch {
      return false;
    }
  },

  async requestPermission() {
    const { granted, canAskAgain } = await Pedometer.requestPermissionsAsync();
    return toStatus(granted, canAskAgain);
  },

  async getPermissionStatus() {
    const { granted, canAskAgain } = await Pedometer.getPermissionsAsync();
    return toStatus(granted, canAskAgain);
  },

  async start() {
    if (subscription) return;
    epoch += 1;
    const readingEpoch = epoch;
    subscription = Barometer.addListener((measurement) => {
      if (!Number.isFinite(measurement.pressure)) return;
      const relative = measurement.relativeAltitude;
      listeners.forEach((listener) => {
        listener({
          at: Date.now(),
          sensorTimestampS: Number.isFinite(measurement.timestamp) ? measurement.timestamp : null,
          pressureHpa: measurement.pressure,
          relativeAltitudeM:
            typeof relative === 'number' && Number.isFinite(relative) ? relative : null,
          epoch: readingEpoch,
        });
      });
    });
  },

  async stop() {
    subscription?.remove();
    subscription = null;
  },

  onReading(cb) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
};
