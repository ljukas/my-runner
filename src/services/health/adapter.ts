import type { HealthWorkoutInput } from '@/domain/health';
import { Health } from '@/modules/health';
import { notifyAuthorizationChanged } from './authorization-events';
import { toHealthPayload } from './health-payload';
import type { HealthAdapter } from './port';

// Android re-probes natively on every return to the foreground and reports a change here.
Health.addListener('onAuthorizationChange', notifyAuthorizationChanged);

export const healthAdapter: HealthAdapter = {
  getAuthorization: () => Health.authorizationStatus(),
  requestWriteAccess: () => Health.requestWriteAccess(),

  async saveRun(input: HealthWorkoutInput): Promise<void> {
    // why Date.now(): both stores replace a record under a repeated id only when the new version is
    // strictly greater, so a retry has to rise past every earlier save.
    const { plain } = await Health.saveWorkout(toHealthPayload(input, Date.now()));
    if (plain)
      console.warn('[health] the store refused the pauses and segments; saved without them');
  },

  openSettings: () => Health.openSettings(),
  openStore: () => Health.openStore(),

  subscribeRationale(listener) {
    // why listen first: a request landing between the two calls would otherwise be held for a
    // consume that already ran.
    const subscription = Health.addListener('onRationale', listener);
    if (Health.consumeRationale()) listener();
    return () => subscription.remove();
  },
};
