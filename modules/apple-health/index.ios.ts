import { requireNativeModule } from 'expo';

import type { HealthKitAuthorization, HealthKitSaveResult, HealthKitWorkout } from './types';

interface AppleHealthModule {
  isAvailable(): boolean;
  /** The workout type's share status — the one the app reports. */
  authorizationStatus(): HealthKitAuthorization;
  /** Resolves when the sheet is answered, or at once when already answered; read the status after. */
  requestWriteAccess(): Promise<void>;
  /**
   * Writes at once, the phone locked or not (HealthKit merges a locked write at unlock). Skips the
   * distance or route when the runner refused that type. Rejects with `ERR_HEALTHKIT_<code>`.
   */
  saveWorkout(workout: HealthKitWorkout): Promise<HealthKitSaveResult>;
}

export const AppleHealth = requireNativeModule<AppleHealthModule>('AppleHealth');
