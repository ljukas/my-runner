import type { LocationFix } from '@/domain/geo';

/**
 * Location permission collapsed to the three states the app acts on (ADR 0008 §2):
 * prompt on `'undetermined'`, deep-link to Settings on `'denied'`. Named distinctly
 * from expo-location's own `PermissionStatus` to avoid an import collision in the
 * adapter. When-In-Use only — no "always"/background state by design.
 */
export type LocationPermissionStatus = 'granted' | 'denied' | 'undetermined';

/**
 * Location tracking port (ADR 0003, 0008). When-In-Use only. Denial degrades, never
 * blocks (ADR 0008 §5): with permission not granted no fixes are delivered, yet the
 * run still starts and its wall-clock timing is unaffected.
 */
export interface LocationTracker {
  /**
   * Prompt for When-In-Use permission (if the OS still allows) and resolve to the
   * result. `'denied'` means route the user to system Settings, not expect a re-prompt.
   */
  requestPermission(): Promise<LocationPermissionStatus>;
  /** Read the current When-In-Use permission status without prompting. */
  getPermissionStatus(): Promise<LocationPermissionStatus>;
  /**
   * Begin location updates (ADR 0008 §3). Idempotent. Starts even when permission is
   * not granted — no fixes arrive, but wall-clock timing is unaffected (ADR 0008 §5).
   */
  start(): Promise<void>;
  /** Stop location updates. Idempotent — safe to call when not started. */
  stop(): Promise<void>;
  /**
   * Subscribe to accepted fixes; multiple listeners each receive every fix. Returns an
   * idempotent unsubscribe that detaches only its own listener.
   */
  onFix(cb: (fix: LocationFix) => void): () => void;
}
