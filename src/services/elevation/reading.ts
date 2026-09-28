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

const ISA_SEA_LEVEL_HPA = 1013.25;

// SensorManager.getAltitude's standard-atmosphere formula. Only differences are ever taken, and the
// real day's sea-level pressure would move a climb by well under 1 %, so the standard one stands in.
function pressureAltitudeM(pressureHpa: number): number {
  return 44330 * (1 - (pressureHpa / ISA_SEA_LEVEL_HPA) ** (1 / 5.255));
}

/**
 * Metres above the epoch's first reading, derived from pressure where the platform reports none
 * (Android's TYPE_PRESSURE). Zero for the first reading, matching CMAltimeter's rebase.
 */
export function relativeAltitudeFromPressure(pressureHpa: number, basePressureHpa: number): number {
  return pressureAltitudeM(pressureHpa) - pressureAltitudeM(basePressureHpa);
}
