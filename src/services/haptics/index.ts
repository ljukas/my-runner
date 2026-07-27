export type { Haptics } from './port';

// No composition wrapper (as in location-tracker): UI haptics have no cross-platform policy seam.
export { haptics } from './adapter';
