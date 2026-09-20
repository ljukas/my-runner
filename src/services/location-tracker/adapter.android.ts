import type { LocationTracker } from './port';

// Android stage 1 ships without location (ADR 0025): no permission is ever requested, and the run
// keeps its wall-clock timing without fixes (ADR 0008 §5).
export const locationTracker: LocationTracker = {
  async requestPermission() {
    return 'unsupported';
  },
  async getPermissionStatus() {
    return 'unsupported';
  },
  async start() {},
  async stop() {},
  onFix() {
    return () => {};
  },
};
