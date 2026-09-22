/** Pure Health Connect payload mapping — no React, Expo, native or DB imports (ADR 0003 §1). */

import type {
  DistanceRecord,
  ExerciseSessionRecord,
  Metadata,
  Permission,
  WriteExerciseRoutePermission,
} from 'react-native-health-connect';

import type { HealthWorkoutInput } from '@/domain/health';
import type { HealthAuthorization } from './port';

export type WritePermission = Permission | WriteExerciseRoutePermission;
// The library declares `Location` and `Length` without exporting them.
type Location = NonNullable<ExerciseSessionRecord['exerciseRoute']>['route'][number];
type Length = DistanceRecord['distance'];

// why not the library's runtime constants: its entry point requires `react-native`, which `bun test`
// cannot load, so the three numeric values are restated from androidx's ExerciseSessionRecord and
// Metadata (verified against react-native-health-connect 4.1.3 `constants.ts` / `metadata.types.ts`).
const EXERCISE_TYPE_RUNNING = 56;
const RECORDING_METHOD_ACTIVELY_RECORDED = 1;
const DEVICE_TYPE_PHONE = 2;

/** The write-only set the app asks for; a session without its route or distance is not "authorized". */
export const WRITE_PERMISSIONS: readonly WritePermission[] = [
  { accessType: 'write', recordType: 'ExerciseSession' },
  { accessType: 'write', recordType: 'ExerciseRoute' },
  { accessType: 'write', recordType: 'Distance' },
];

function meters(value: number): Length {
  return { value, unit: 'meters' };
}

// why 0, not the CoreLocation sentinel: Health Connect rejects a negative accuracy, and 0 is what
// Android's own Location API reports when an accuracy is unavailable.
function accuracyMeters(value: number): Length {
  return meters(value > 0 ? value : 0);
}

/**
 * Route points Health Connect will accept: strictly increasing times inside `[startedAt, endedAt)`
 * (the session constructor rejects anything else), every length present (the library's writer
 * throws on an absent one despite the optional type).
 */
export function toExerciseRouteLocations(input: HealthWorkoutInput): Location[] {
  const locations: Location[] = [];
  let lastTimestamp = Number.NEGATIVE_INFINITY;
  for (const point of input.route) {
    if (point.timestamp < input.startedAt || point.timestamp >= input.endedAt) continue;
    if (point.timestamp <= lastTimestamp) continue;
    lastTimestamp = point.timestamp;
    locations.push({
      time: new Date(point.timestamp).toISOString(),
      latitude: point.latitude,
      longitude: point.longitude,
      horizontalAccuracy: accuracyMeters(point.horizontalAccuracy),
      verticalAccuracy: accuracyMeters(point.verticalAccuracy),
      altitude: meters(point.altitude),
    });
  }
  return locations;
}

// per ADR 0011 amendment (item 6), Android half: clientRecordId + a rising clientRecordVersion is
// what makes a retry replace rather than duplicate.
function metadata(clientRecordId: string, version: number): Metadata {
  return {
    clientRecordId,
    clientRecordVersion: version,
    recordingMethod: RECORDING_METHOD_ACTIVELY_RECORDED,
    device: { type: DEVICE_TYPE_PHONE },
  };
}

export function toExerciseSessionRecord(
  input: HealthWorkoutInput,
  version: number,
): ExerciseSessionRecord {
  const route = toExerciseRouteLocations(input);
  return {
    recordType: 'ExerciseSession',
    startTime: new Date(input.startedAt).toISOString(),
    endTime: new Date(input.endedAt).toISOString(),
    exerciseType: EXERCISE_TYPE_RUNNING,
    ...(route.length > 0 ? { exerciseRoute: { route } } : {}),
    metadata: metadata(input.syncIdentifier, version),
  };
}

/** One whole-session distance beside the session (ADR 0011 amendment item 7); `null` without GPS. */
export function toDistanceRecord(
  input: HealthWorkoutInput,
  version: number,
): DistanceRecord | null {
  if (!input.distanceSample) return null;
  return {
    recordType: 'Distance',
    startTime: new Date(input.distanceSample.startedAt).toISOString(),
    endTime: new Date(input.distanceSample.endedAt).toISOString(),
    distance: meters(input.distanceSample.meters),
    metadata: metadata(`${input.syncIdentifier}:distance`, version),
  };
}

/**
 * Health Connect exposes only "granted" — there is no "denied" to read back — so a grant that is
 * missing reads as not determined until the app has asked once, and as denied after that.
 */
export function resolveAuthorization({
  sdkAvailable,
  granted,
  requested,
}: {
  sdkAvailable: boolean;
  granted: readonly { accessType: string; recordType: string }[];
  requested: boolean;
}): HealthAuthorization {
  if (!sdkAvailable) return 'unavailable';
  const hasAll = WRITE_PERMISSIONS.every((needed) =>
    granted.some((g) => g.accessType === needed.accessType && g.recordType === needed.recordType),
  );
  if (hasAll) return 'authorized';
  return requested ? 'denied' : 'notDetermined';
}
