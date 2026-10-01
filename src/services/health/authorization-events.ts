// why a bare Set, not an event-emitter: one signal, no payload, and at most a handful of mounted
// rows — see the seam's `requestWriteAccess` in index.ts for why anything needs to be notified at all.
// why its own module: the adapter notifies too (Android reports native status changes) and
// cannot import the hook module that imports it back; and `bun test` can load it without a React
// renderer.
const listeners = new Set<() => void>();

export function subscribeAuthorizationChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyAuthorizationChanged(): void {
  for (const listener of listeners) listener();
}
