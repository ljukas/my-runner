/** Pure Health Connect payload mapping — no React, Expo, native or DB imports (ADR 0003 §1). */

import type {
  DistanceRecord,
  ExerciseSessionRecord,
  Metadata,
  Permission,
  WriteExerciseRoutePermission,
} from 'react-native-health-connect';

import type { HealthWorkoutInput } from '@/domain/health';
import type { WorkoutActivity } from '@/domain/health-segments';
import type { HealthAuthorization } from './port';

export type WritePermission = Permission | WriteExerciseRoutePermission;
// The library declares `Location`, `Length` and `ExerciseSegment` without exporting them.
type Location = NonNullable<ExerciseSessionRecord['exerciseRoute']>['route'][number];
type Length = DistanceRecord['distance'];
type ExerciseSegment = NonNullable<ExerciseSessionRecord['segments']>[number];

// why not the library's runtime constants: its entry point requires `react-native`, which `bun test`
// cannot load, so the numeric values are restated from androidx's ExerciseSessionRecord,
// ExerciseSegment and Metadata (verified against react-native-health-connect 4.1.3 `constants.ts` /
// `metadata.types.ts`).
const EXERCISE_TYPE_RUNNING = 56;
const RECORDING_METHOD_ACTIVELY_RECORDED = 1;
const DEVICE_TYPE_PHONE = 2;
const SEGMENT_TYPE_PAUSE = 39;
// Each is allowed inside a running session: RUNNING and WALKING by the running type's own set, REST
// (and PAUSE) by androidx's universal set.
const SEGMENT_TYPE: Record<WorkoutActivity, number> = { running: 46, walking: 64, resting: 44 };

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

function segment(startedAt: number, endedAt: number, segmentType: number): ExerciseSegment {
  return {
    startTime: new Date(startedAt).toISOString(),
    endTime: new Date(endedAt).toISOString(),
    segmentType,
    repetitions: 0,
  };
}

/**
 * The workout's segments with each pause as a PAUSE segment, in time order — per AOSP, Health
 * Connect subtracts PAUSE and REST from a session's exercise duration (ADR 0026, 2026-09-30).
 */
export function toExerciseSegments(input: HealthWorkoutInput): ExerciseSegment[] {
  return [
    ...input.segments.map((s) => ({
      at: s.startedAt,
      value: segment(s.startedAt, s.endedAt, SEGMENT_TYPE[s.activity]),
    })),
    ...input.pauses.map((p) => ({
      at: p.startedAt,
      value: segment(p.startedAt, p.endedAt, SEGMENT_TYPE_PAUSE),
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.value);
}

export function toExerciseSessionRecord(
  input: HealthWorkoutInput,
  version: number,
): ExerciseSessionRecord {
  const route = toExerciseRouteLocations(input);
  const segments = toExerciseSegments(input);
  return {
    recordType: 'ExerciseSession',
    startTime: new Date(input.startedAt).toISOString(),
    endTime: new Date(input.endedAt).toISOString(),
    exerciseType: EXERCISE_TYPE_RUNNING,
    ...(route.length > 0 ? { exerciseRoute: { route } } : {}),
    ...(segments.length > 0 ? { segments } : {}),
    metadata: metadata(input.syncIdentifier, version),
  };
}

// The library's code for an IllegalArgumentException — what the session constructor throws for
// segments it will not accept (ExceptionsUtils.kt).
const ARGUMENT_VALIDATION_ERROR = 'ARGUMENT_VALIDATION_ERROR';

function isValidationError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === ARGUMENT_VALIDATION_ERROR;
}

/**
 * Inserts the session, and if Health Connect refuses it as invalid while it carries segments,
 * inserts it once more without them, in the same save rather than as a silent retry (ADR 0011,
 * Consequences). Any other failure is rethrown, so a transient one never costs valid segments.
 */
export async function insertExerciseSession(
  insert: (records: ExerciseSessionRecord[]) => Promise<unknown>,
  record: ExerciseSessionRecord,
): Promise<void> {
  try {
    await insert([record]);
  } catch (error) {
    if (!record.segments || !isValidationError(error)) throw error;
    console.warn(
      '[health] Health Connect refused the segments; saving the session without them',
      error,
    );
    const { segments: _rejected, ...bare } = record;
    await insert([bare]);
  }
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

// The two intents Health Connect's permission dialog fires from its privacy-policy link — Android
// ≤ 13 and 14+ respectively — both aimed at MainActivity by the library's config plugin.
const RATIONALE_ACTIONS = new Set([
  'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE',
  'android.intent.action.VIEW_PERMISSION_USAGE',
]);

export function isHealthRationaleAction(action: string | null): boolean {
  return action !== null && RATIONALE_ACTIONS.has(action);
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
