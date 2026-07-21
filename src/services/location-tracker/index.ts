export type { LocationPermissionStatus, LocationTracker } from './port';

// No composition wrapper (unlike cue-service): location has no cross-platform gating seam.
export { locationTracker } from './adapter';
