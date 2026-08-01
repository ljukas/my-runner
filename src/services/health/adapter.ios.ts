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

// Bump only if the shape of what gets synced under a given syncIdentifier changes meaningfully.
const SYNC_VERSION = 1;

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
  isAvailable: () => isHealthDataAvailable(),
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
    // duplicates the workout. WorkoutsModule.swift applies this same map to the workout AND every
    // per-segment sample (:133), so every segment below carries the identical identifier too.
    // Verified on-device (2026-08-01): this does not collapse the samples — all 17 survived
    // individually in Health's "Show All Data" list (design spec §3.1).
    const metadata: AnyMap = {
      [SYNC_IDENTIFIER_KEY]: input.syncIdentifier,
      [SYNC_VERSION_KEY]: SYNC_VERSION,
    };

    const workout = await saveWorkoutSample(
      WorkoutActivityType.running,
      input.segmentSamples.map((sample) => ({
        startDate: new Date(sample.startedAt),
        endDate: new Date(sample.endedAt),
        quantityType: DISTANCE_TYPE,
        quantity: sample.meters,
        unit: 'm',
      })),
      new Date(input.startedAt),
      new Date(input.endedAt),
      // why totals is never dropped while samples are passed: the library assigns totalDistance from
      // every metre-compatible sample in turn (WorkoutsModule.swift:116-117), so without this the
      // workout total silently becomes the LAST segment's distance. totals overrides it (:137-141).
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
