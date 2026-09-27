import { MotionSensors } from '@/modules/motion-sensors';
import type { AltitudeReading, ElevationSource } from './port';
import { relativeAltitudeFromPressure, toAltitudeReading } from './reading';

// One subscription with a JS fan-out, as in adapter.ios.ts. The native side is our own module, not
// expo-sensors' Barometer: that one unregisters whenever the Activity pauses (ADR 0015's Android
// amendment), which is every screen-off run.
let subscription: { remove: () => void } | null = null;
let epoch = 0;
const listeners = new Set<(reading: AltitudeReading) => void>();

export const elevationSource: ElevationSource = {
  async isAvailable() {
    try {
      return MotionSensors.hasBarometer();
    } catch {
      return false;
    }
  },

  // why granted: Android guards the pressure sensor with no permission at all.
  async requestPermission() {
    return 'granted';
  },

  async getPermissionStatus() {
    return 'granted';
  },

  async start() {
    if (subscription) return;
    if (!(await elevationSource.isAvailable())) return;
    epoch += 1;
    const readingEpoch = epoch;
    let basePressureHpa: number | null = null;
    const native = MotionSensors.addListener('onPressure', ({ pressureHpa, timestampS }) => {
      const reading = toAltitudeReading(
        {
          pressure: pressureHpa,
          timestamp: timestampS,
          relativeAltitude: relativeAltitudeFromPressure(
            pressureHpa,
            basePressureHpa ?? pressureHpa,
          ),
        },
        Date.now(),
        readingEpoch,
      );
      if (!reading) return;
      basePressureHpa ??= pressureHpa;
      Array.from(listeners).forEach((listener) => listener(reading));
    });
    if (MotionSensors.startBarometer()) subscription = native;
    else native.remove();
  },

  async stop() {
    MotionSensors.stopBarometer();
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
