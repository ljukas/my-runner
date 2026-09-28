import type { ElevationSource } from './port';

// No barometer capture on Android yet (ADR 0025); `isAvailable()` false is what keeps the
// composition root from touching the pedometer or logging sensor rows.
export const elevationSource: ElevationSource = {
  async isAvailable() {
    return false;
  },
  async requestPermission() {
    return 'undetermined';
  },
  async getPermissionStatus() {
    return 'undetermined';
  },
  async start() {},
  async stop() {},
  onReading() {
    return () => {};
  },
};
