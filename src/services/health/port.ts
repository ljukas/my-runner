import type { HealthWorkoutInput } from '@/domain/health';

/** Write-access state for the workout type. `unavailable` means the device has no HealthKit. */
export type HealthAuthorization = 'authorized' | 'denied' | 'notDetermined' | 'unavailable';

/**
 * Apple Health writes (ADR 0011). Write-only by construction: no member reads health data, and
 * callers never see HealthKit types. Denial degrades silently — nothing is written, nothing throws.
 */
export interface HealthAdapter {
  /** Synchronous, because the underlying HealthKit call is. */
  getAuthorization(): HealthAuthorization;
  /** Prompts when still undetermined, then reports the status iOS actually recorded. */
  requestWriteAccess(): Promise<HealthAuthorization>;
  saveRun(input: HealthWorkoutInput): Promise<void>;
}
