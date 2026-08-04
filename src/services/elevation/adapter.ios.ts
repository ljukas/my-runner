import { Barometer, Pedometer } from 'expo-sensors';

import type { AltitudeReading, ElevationSource } from './port';
import { toAltitudeReading, toMotionPermissionStatus } from './reading';

// why one module-scope subscription with a JS fan-out: expo-sensors starts the native altimeter in
// `OnStartObserving` (first listener added) and STOPS it in `OnStopObserving` (last removed). A
// per-consumer listener would let an ordinary React unmount stop the altimeter, and the next
// subscribe would rebase `relativeAltitude` to 0 — the silent cliff (spec §4.2). Mirrors
// `location-tracker/adapter.ios.ts`'s listeners Set.
let subscription: { remove: () => void } | null = null;
let epoch = 0;
const listeners = new Set<(reading: AltitudeReading) => void>();

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
    return toMotionPermissionStatus(granted, canAskAgain);
  },

  async getPermissionStatus() {
    const { granted, canAskAgain } = await Pedometer.getPermissionsAsync();
    return toMotionPermissionStatus(granted, canAskAgain);
  },

  async start() {
    if (subscription) return;
    // why the availability gate lives here, not at the call site (ADR 0015 item 2's feature
    // detection): subscribing on hardware without a barometer yields no readings AND still raises
    // the Motion & Fitness prompt, because expo-sensors' `OnStartObserving` runs a
    // `CMSensorRecorder` workaround whenever authorization is undetermined. Every simulator is such
    // hardware, so an ungated subscribe asks for a permission the device cannot serve — and strands
    // the E2E suite behind a system alert `clearState` does not dismiss.
    if (!(await elevationSource.isAvailable())) return;
    epoch += 1;
    const readingEpoch = epoch;
    subscription = Barometer.addListener((measurement) => {
      const reading = toAltitudeReading(measurement, Date.now(), readingEpoch);
      if (!reading) return;
      // why a snapshot: a listener added from inside another listener's callback must not be
      // visited in this same delivery — iterating the live Set would do exactly that.
      Array.from(listeners).forEach((listener) => listener(reading));
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
