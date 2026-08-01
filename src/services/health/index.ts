export type { HealthAdapter, HealthAuthorization } from './port';

// No composition wrapper (as in location-tracker): Health has no cross-platform policy seam — the
// gating that would live here is HealthKit's own authorization, which the adapter reports.
export { healthAdapter } from './adapter';
export { syncRunToHealth } from './sync';
export { withHealthSync } from './with-health-sync';
