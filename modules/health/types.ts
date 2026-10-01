/** Epoch ms; `endMs` is later than `startMs`. */
export interface HealthWindow {
  startMs: number;
  endMs: number;
}

export type HealthSegmentKind = 'run' | 'walk' | 'rest';

export interface HealthRoutePoint {
  latitude: number;
  longitude: number;
  timestampMs: number;
  altitude: number;
  /** Negative means unknown, CoreLocation's own convention; Health Connect stores neither. */
  course: number;
  speed: number;
  horizontalAccuracy: number;
  verticalAccuracy: number;
}

/** What `saveWorkout` writes: one running workout, replaced on a re-save under the same ids. */
export interface HealthWorkout extends HealthWindow {
  /** Health Connect's session title; HealthKit has no field Health shows, so iOS drops it. */
  title: string;
  syncIdentifier: string;
  /** Must rise on every save, or the store keeps its copy. */
  syncVersion: number;
  /** One part per interval (per stretch between pauses without intervals); they sum to the total. */
  distances: (HealthWindow & { meters: number; syncIdentifier: string })[];
  pauses: HealthWindow[];
  segments: (HealthWindow & { kind: HealthSegmentKind })[];
  route: { syncIdentifier: string; points: HealthRoutePoint[] } | null;
}

export interface HealthSaveResult {
  /** True when the store refused the pauses and segments and the workout was saved without them. */
  plain: boolean;
}

/** Write access for workouts; iOS never reports `updateRequired`. */
export type HealthAuthorizationStatus =
  'authorized' | 'denied' | 'notDetermined' | 'unavailable' | 'updateRequired';
