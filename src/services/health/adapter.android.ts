import type { HealthAdapter } from './port';

// Health Connect is a later Android stage (ADR 0025); until then the device reports no health store,
// which every consumer already renders as "not available" (ADR 0011).
export const healthAdapter: HealthAdapter = {
  getAuthorization() {
    return 'unavailable';
  },
  async requestWriteAccess() {
    return 'unavailable';
  },
  async saveRun() {},
};
