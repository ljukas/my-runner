import { Pedometer } from 'expo-sensors';

import { MotionSensors } from '@/modules/motion-sensors';
import type { ElevationSource } from './port';
import {
  relativeAltitudeFromPressure,
  toAltitudeReading,
  toMotionPermissionStatus,
} from './reading';
import { createReadingHub } from './reading-hub';

// One subscription with a JS fan-out, as in adapter.ios.ts; the native side is our own module, not
// expo-sensors' Barometer (ADR 0015's 2026-09-27 amendment).
let subscription: { remove: () => void } | null = null;
const hub = createReadingHub();

// why Pedometer: the barometer needs no permission, so the one that gates this capture's motion
// data is the step counter's ACTIVITY_RECOGNITION — the status the run record and export report.
export const elevationSource: ElevationSource = {
  async isAvailable() {
    try {
      return MotionSensors.hasBarometer();
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
    if (!(await elevationSource.isAvailable())) return;
    const readingEpoch = hub.nextEpoch();
    let basePressureHpa: number | null = null;
    const native = MotionSensors.addListener('onPressure', ({ pressureHpa, timestampS, atMs }) => {
      const reading = toAltitudeReading(
        {
          pressure: pressureHpa,
          timestamp: timestampS,
          relativeAltitude: relativeAltitudeFromPressure(
            pressureHpa,
            basePressureHpa ?? pressureHpa,
          ),
        },
        atMs,
        readingEpoch,
      );
      if (!reading) return;
      basePressureHpa ??= pressureHpa;
      hub.emit(reading);
    });
    let started = false;
    try {
      started = MotionSensors.startBarometer();
    } finally {
      if (started) subscription = native;
      else native.remove();
    }
  },

  async stop() {
    try {
      MotionSensors.stopBarometer();
    } finally {
      subscription?.remove();
      subscription = null;
    }
  },

  onReading: hub.onReading,
};
