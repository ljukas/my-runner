import type { HealthWorkoutInput } from '@/domain/health';
import { AppleHealth } from '@/modules/apple-health';
import { toHealthKitWorkout } from './healthkit';
import type { HealthAdapter, HealthAuthorization } from './port';

function currentAuthorization(): HealthAuthorization {
  if (!AppleHealth.isAvailable()) return 'unavailable';
  return AppleHealth.authorizationStatus();
}

export const healthAdapter: HealthAdapter = {
  getAuthorization: currentAuthorization,

  async requestWriteAccess(): Promise<HealthAuthorization> {
    if (!AppleHealth.isAvailable()) return 'unavailable';
    await AppleHealth.requestWriteAccess();
    return currentAuthorization();
  },

  async saveRun(input: HealthWorkoutInput): Promise<void> {
    // why Date.now(): HealthKit replaces a stored object under a repeated sync identifier only when
    // the new HKSyncVersion is strictly greater (HKMetadata.h) — a per-save revision counter, so a
    // retry has to rise past every earlier save.
    const { plain } = await AppleHealth.saveWorkout(toHealthKitWorkout(input, Date.now()));
    if (plain)
      console.warn('[health] HealthKit refused the pauses and segments; saved without them');
  },
};
