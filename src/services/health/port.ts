import type { HealthWorkoutInput } from '@/domain/health';

/**
 * Write-access state for workouts. `unavailable`: no health store on this device; `updateRequired`:
 * Android 9–13 without a current Health Connect app, which `openStore()` fixes.
 */
export type HealthAuthorization =
  'authorized' | 'denied' | 'notDetermined' | 'unavailable' | 'updateRequired';

/**
 * Apple Health and Health Connect writes (ADR 0011). Write-only by construction: no member reads
 * health data, and callers never see a store's types. Denial degrades silently: getAuthorization
 * reports it and callers skip the write.
 */
export interface HealthAdapter {
  /** Synchronous; can trail a change made in the store's own UI until the app is foregrounded. */
  getAuthorization(): HealthAuthorization;
  /** Prompts when still undetermined, then reports the status the store actually recorded. */
  requestWriteAccess(): Promise<HealthAuthorization>;
  saveRun(input: HealthWorkoutInput): Promise<void>;
  /** Where the runner changes what the app may write. */
  openSettings(): Promise<void>;
  /** The store's install page; only Android has one. */
  openStore(): Promise<void>;
  /** Calls `listener` whenever the store asks for the privacy policy, at once if it already has. */
  subscribeRationale(listener: () => void): () => void;
}
