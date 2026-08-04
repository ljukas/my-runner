import type { AltitudeReading, MotionPermissionStatus } from './port';

// Pure and Expo-free by design (ADR 0003 item 7: adapters get device verification, not
// SDK-mocked unit tests) — `adapter.ios.ts` calls these two mappers and unit tests target
// them directly. Structural, not `BarometerMeasurement` from expo-sensors: importing that
// type would pull the SDK into this otherwise import-free module.
export interface RawBarometerMeasurement {
  pressure: number;
  relativeAltitude?: number;
  timestamp: number;
}

// why: drops a non-finite pressure sample outright (spec §4.2) rather than let garbage reach
// subscribers; normalises an absent/non-finite relativeAltitude to null while pressure survives.
export function toAltitudeReading(
  measurement: RawBarometerMeasurement,
  at: number,
  epoch: number,
): AltitudeReading | null {
  if (!Number.isFinite(measurement.pressure)) return null;
  const relative = measurement.relativeAltitude;
  return {
    at,
    sensorTimestampS: Number.isFinite(measurement.timestamp) ? measurement.timestamp : null,
    pressureHpa: measurement.pressure,
    relativeAltitudeM: typeof relative === 'number' && Number.isFinite(relative) ? relative : null,
    epoch,
  };
}

export function toMotionPermissionStatus(
  granted: boolean,
  canAskAgain: boolean,
): MotionPermissionStatus {
  if (granted) return 'granted';
  return canAskAgain ? 'undetermined' : 'denied';
}
