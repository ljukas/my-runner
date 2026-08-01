import {
  AuthorizationStatus,
  authorizationStatusFor,
  isHealthDataAvailable,
  requestAuthorization,
  saveWorkoutSample,
  WorkoutActivityType,
} from '@kingstinct/react-native-healthkit';

import type { HealthWorkoutInput } from '@/domain/health';
import type { HealthAdapter, HealthAuthorization } from './port';

const WORKOUT_TYPE = 'HKWorkoutTypeIdentifier';
const ROUTE_TYPE = 'HKWorkoutRouteTypeIdentifier';
const DISTANCE_TYPE = 'HKQuantityTypeIdentifierDistanceWalkingRunning';

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
