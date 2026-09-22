// why a bare Set, not an event-emitter: one signal, no payload, and at most a handful of mounted
// rows — see the seam's `requestWriteAccess` in index.ts for why anything needs to be notified at all.
// why its own module: the Android adapter notifies too (its status is probed asynchronously), and it
// cannot import the hook module that imports it back.
const listeners = new Set<() => void>();

/** Registers a listener called on every `notifyAuthorizationChanged`; returns its unsubscribe.
 *  Exported separately from the hook so it's exercisable without a React renderer (`bun test`). */
export function subscribeAuthorizationChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tells every mounted `useHealthAuthorization` to re-read status now, rather than waiting on the
 *  AppState foreground signal that answering an in-app request doesn't reliably produce. */
export function notifyAuthorizationChanged(): void {
  for (const listener of listeners) listener();
}
