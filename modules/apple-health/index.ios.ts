import { requireNativeModule } from 'expo';

import type { HealthKitAuthorization, HealthKitSaveResult, HealthKitWorkout } from './types';

interface AppleHealthModule {
  isAvailable(): boolean;
  /** The workout type's share status — the one the app reports. */
  authorizationStatus(): HealthKitAuthorization;
  /** Resolves when the sheet is answered, or at once when already answered; read the status after. */
  requestWriteAccess(): Promise<void>;
  /**
   * Waits while the phone is locked — until the next unlock or foreground, unbounded — then writes.
   * Skips the distance or route when the runner refused that type.
   */
  saveWorkout(workout: HealthKitWorkout): Promise<HealthKitSaveResult>;
}

export const AppleHealth = requireNativeModule<AppleHealthModule>('AppleHealth');
