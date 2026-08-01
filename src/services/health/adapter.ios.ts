import {
  AuthorizationStatus,
  authorizationStatusFor,
  isHealthDataAvailable,
  requestAuthorization,
  saveWorkoutSample,
  WorkoutActivityType,
} from '@kingstinct/react-native-healthkit';
import type { AnyMap } from 'react-native-nitro-modules';

import type { HealthWorkoutInput } from '@/domain/health';
import type { HealthAdapter, HealthAuthorization } from './port';

const WORKOUT_TYPE = 'HKWorkoutTypeIdentifier';
const ROUTE_TYPE = 'HKWorkoutRouteTypeIdentifier';
const DISTANCE_TYPE = 'HKQuantityTypeIdentifierDistanceWalkingRunning';

// why: these are the library's *serialized* metadata keys, not the Apple constant names
// (HKMetadataKeySyncIdentifier/HKMetadataKeySyncVersion) — per its README, HealthKit metadata key
// constants and their raw string values differ, and the raw value is what has to go in this map.
// Confirmed against KnownObjectMetadata in
// @kingstinct/react-native-healthkit/src/generated/healthkit.generated.ts.
const SYNC_IDENTIFIER_KEY = 'HKSyncIdentifier';
const SYNC_VERSION_KEY = 'HKSyncVersion';

function currentAuthorization(): HealthAuthorization {
  if (!isHealthDataAvailable()) return 'unavailable';
  switch (authorizationStatusFor(WORKOUT_TYPE)) {
    case AuthorizationStatus.sharingAuthorized:
      return 'authorized';
    case AuthorizationStatus.sharingDenied:
      return 'denied';
    default:
      return 'notDetermined';
  }
}

export const healthAdapter: HealthAdapter = {
  getAuthorization: currentAuthorization,

  async requestWriteAccess(): Promise<HealthAuthorization> {
    if (!isHealthDataAvailable()) return 'unavailable';
    // why re-read instead of using the resolved boolean: it reports that the prompt completed, not
    // that the user granted — only authorizationStatusFor carries the answer for share types.
    await requestAuthorization({ toShare: [WORKOUT_TYPE, ROUTE_TYPE, DISTANCE_TYPE] });
    return currentAuthorization();
  },

  async saveRun(input: HealthWorkoutInput): Promise<void> {
    // why: the run id doubles as HealthKit's sync identifier so a retry after a partial failure
    // (store.save(workout) commits before saveWorkoutRoute/store.add run) replaces rather than
    // duplicates the workout. WorkoutsModule.swift applies this same map to the workout and its
    // one distance sample alike (:133).
    // why Date.now(): HealthKit only replaces a stored object under a repeated sync identifier
    // when the new save's HKSyncVersion is strictly GREATER than what's stored (HKMetadata.h) — it's
    // a per-save revision counter, not a payload-schema tag, so a version fixed across releases can
    // never satisfy a same-release retry. Date.now() always exceeds any previously written value.
    const metadata: AnyMap = {
      [SYNC_IDENTIFIER_KEY]: input.syncIdentifier,
      [SYNC_VERSION_KEY]: Date.now(),
    };

    const workout = await saveWorkoutSample(
      WorkoutActivityType.running,
      input.distanceSample
        ? [
            {
              startDate: new Date(input.distanceSample.startedAt),
              endDate: new Date(input.distanceSample.endedAt),
              quantityType: DISTANCE_TYPE,
              quantity: input.distanceSample.meters,
              unit: 'm',
            },
          ]
        : [],
      new Date(input.startedAt),
      new Date(input.endedAt),
      // why totals is passed regardless of the sample above: the library assigns totalDistance from
      // whatever metre-compatible sample it was given (WorkoutsModule.swift:116-117) — with a single
      // whole-session sample that already matches, but totals stays the explicit source of truth
      // rather than relying on that incidentally lining up. totals overrides it (:137-141).
      input.totalDistanceM != null ? { distance: input.totalDistanceM } : undefined,
      metadata,
    );

    if (input.route.length > 0) {
      await workout.saveWorkoutRoute(
        input.route.map((point) => ({
          latitude: point.latitude,
          longitude: point.longitude,
          date: new Date(point.timestamp),
          altitude: point.altitude,
          course: point.course,
          speed: point.speed,
          horizontalAccuracy: point.horizontalAccuracy,
          verticalAccuracy: point.verticalAccuracy,
        })),
      );
    }
  },
};
