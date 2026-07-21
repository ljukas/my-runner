import type { LocationFix } from '@/domain/geo';

/**
 * Permission state for location, collapsed to the three states the app acts on
 * (ADR 0008 §2): the caller prompts on `'undetermined'` and routes `'denied'`
 * to the system Settings deep-link. The adapter maps its platform permission
 * API onto these literals so no expo type leaks across the port — deliberately
 * named distinctly from expo-location's own `PermissionStatus` export to avoid
 * an import collision in the adapter. When-In-Use only — there is no
 * "always"/background-authorization state here by design.
 */
export type LocationPermissionStatus = 'granted' | 'denied' | 'undetermined';

/**
 * Location tracking port (ADR 0003, ADR 0008). The engine and UI drive GPS
 * through this contract only; the iOS adapter owns expo-location, the
 * module-scope `expo-task-manager` background task, and the ADR 0008 §3
 * tracking config — none of which surface here. The background task is what
 * keeps JS alive to deliver fixes while the phone is locked (ADR 0008); callers
 * never see or register it.
 *
 * Permission posture is When-In-Use only (never Always). Denial degrades, never
 * blocks (ADR 0008 §5): with permission not granted no fixes are delivered, yet
 * the run still starts and its wall-clock timing is unaffected.
 */
export interface LocationTracker {
  /**
   * Prompt for When-In-Use permission if the OS still allows a prompt
   * (primer-before-prompt is the caller's responsibility, ADR 0008 §2), and
   * resolve to the resulting status. A `'denied'` result means the caller
   * should route the user to the system Settings deep-link rather than expect a
   * further prompt.
   */
  requestPermission(): Promise<LocationPermissionStatus>;
  /** Read the current When-In-Use permission status without prompting. */
  getPermissionStatus(): Promise<LocationPermissionStatus>;
  /**
   * Begin location updates (ADR 0008 §3 config). The adapter gates on foreground
   * permission: when permission is not granted no fixes are delivered, so a
   * denied run still starts and keeps correct wall-clock timing (ADR 0008 §5).
   * Callers drive the denied-UX from `getPermissionStatus()`, not from this
   * call's result. Idempotent — safe to call when already started.
   */
  start(): Promise<void>;
  /** Stop location updates. Idempotent — safe to call when not started. */
  stop(): Promise<void>;
  /**
   * Subscribe to accepted location fixes. Multiple concurrent listeners are
   * supported and each receives every fix. Returns an unsubscribe function; it
   * is idempotent (safe to call more than once) and detaches only its own
   * listener. The composition root wires this to `runEngine.heartbeat` in
   * module scope so delivery survives screen lock (ADR 0008).
   */
  onFix(cb: (fix: LocationFix) => void): () => void;
}
