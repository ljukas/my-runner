/** Epoch ms; `endMs` is later than `startMs`. */
export interface HealthKitWindow {
  startMs: number;
  endMs: number;
}

export type HealthKitSegmentKind = 'run' | 'walk' | 'rest';

export interface HealthKitRoutePoint {
  latitude: number;
  longitude: number;
  timestampMs: number;
  altitude: number;
  /** Negative means unknown, CoreLocation's own convention. */
  course: number;
  speed: number;
  horizontalAccuracy: number;
  verticalAccuracy: number;
}

/** What `saveWorkout` writes: one running workout, replaced on a re-save under the same ids. */
export interface HealthKitWorkout extends HealthKitWindow {
  syncIdentifier: string;
  /** Must rise on every save, or HealthKit keeps the stored copy. */
  syncVersion: number;
  /** One part per interval (per stretch between pauses without intervals); they sum to the total. */
  distances: (HealthKitWindow & { meters: number; syncIdentifier: string })[];
  pauses: HealthKitWindow[];
  segments: (HealthKitWindow & { kind: HealthKitSegmentKind })[];
  route: { syncIdentifier: string; points: HealthKitRoutePoint[] } | null;
}

export interface HealthKitSaveResult {
  /** True when HealthKit refused the pauses and segments and the workout was saved without them. */
  plain: boolean;
}

export type HealthKitAuthorization = 'authorized' | 'denied' | 'notDetermined';
