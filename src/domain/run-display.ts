import type { LocationPermissionStatus } from '@/services/location-tracker/port';

/**
 * Without location there is no background heartbeat, so a sleeping screen would
 * silence the cues (ADR 0008 §5). An unresolved status (`null`) holds the
 * display awake too — an audible coach is the fail-safe direction.
 */
export function shouldHoldDisplayAwake(
  locked: boolean,
  locationStatus: LocationPermissionStatus | null,
): boolean {
  return locked || locationStatus !== 'granted';
}
