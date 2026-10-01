import { healthAdapter } from './adapter';
import type { HealthAuthorization } from './port';
import { notifyAuthorizationChanged } from './use-health-authorization';

export type { HealthAuthorization } from './port';

export { isHealthSyncFailure, syncRunToHealth, type HealthSyncResult } from './sync';
export { useHealthAuthorization } from './use-health-authorization';
export { withHealthSync } from './with-health-sync';

/**
 * The platform-agnostic composition seam (as in cue-service): HealthKit never re-prompts once
 * answered, so an in-app `requestWriteAccess()` call is the only place that knows the answer just
 * landed — every caller goes through here instead of the adapter directly, so every mounted
 * `useHealthAuthorization` finds out too (finding 2).
 */
export async function requestWriteAccess(): Promise<HealthAuthorization> {
  try {
    const status = await healthAdapter.requestWriteAccess();
    notifyAuthorizationChanged();
    return status;
  } catch (error) {
    // why caught here, not left to callers: this is the one seam every caller goes through (see
    // above) — catching here instead of at each call site is what makes every caller safe by
    // construction, including ones with no catch of their own.
    console.warn('[health] requestWriteAccess failed', error);
    return 'notDetermined';
  }
}

/** Opens Health, or Health Connect's settings; logs rather than rejects. */
export async function openHealthApp(): Promise<void> {
  try {
    await healthAdapter.openSettings();
  } catch (error) {
    console.warn('[health] openHealthApp failed', error);
  }
}

/** Opens Health Connect's Play Store page, for `updateRequired`; logs rather than rejects. */
export async function openHealthStore(): Promise<void> {
  try {
    await healthAdapter.openStore();
  } catch (error) {
    console.warn('[health] openHealthStore failed', error);
  }
}

export function subscribeHealthRationale(listener: () => void): () => void {
  return healthAdapter.subscribeRationale(listener);
}
