import { requireNativeModule } from 'expo';

import type { HealthAuthorizationStatus, HealthSaveResult, HealthWorkout } from './types';

type Subscription = { remove(): void };

// per ADR 0011 (2026-10-01 amendments)
interface HealthModule {
  authorizationStatus(): HealthAuthorizationStatus;
  /**
   * Resolves once answered, or at once when already answered or unavailable. Android resolves
   * `notDetermined` when the runner left the dialog through its privacy-policy link.
   */
  requestWriteAccess(): Promise<HealthAuthorizationStatus>;
  /**
   * Writes at once, the phone locked or not. Skips the distance or route when the runner refused
   * that type. Rejects with `ERR_HEALTHKIT_<code>` or `ERR_HEALTH_CONNECT_*`.
   */
  saveWorkout(workout: HealthWorkout): Promise<HealthSaveResult>;
  /** Where the runner changes what the app may write: Health, or Health Connect's settings. */
  openSettings(): Promise<void>;
  /** Health Connect's Play Store page, for `updateRequired`; a no-op on iOS. */
  openStore(): Promise<void>;
  /** Whether a rationale request arrived before JS listened (a cold start); clears it. */
  consumeRationale(): boolean;
  addListener(
    event: 'onAuthorizationChange',
    listener: (event: { status: HealthAuthorizationStatus }) => void,
  ): Subscription;
  /** Health Connect asks the app to show its privacy policy; never fires on iOS. */
  addListener(event: 'onRationale', listener: () => void): Subscription;
}

export const Health = requireNativeModule<HealthModule>('Health');
