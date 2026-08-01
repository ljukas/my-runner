import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { healthAdapter } from './adapter';
import type { HealthAuthorization } from './port';

// why a bare Set, not an event-emitter: one signal, no payload, and at most a handful of mounted
// rows — see the seam's `requestWriteAccess` in index.ts for why anything needs to be notified at all.
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

/** Write-access status, re-read whenever the app returns to the foreground or the seam requests it. */
export function useHealthAuthorization(): HealthAuthorization {
  const [status, setStatus] = useState<HealthAuthorization>(() => healthAdapter.getAuthorization());

  useEffect(() => {
    const unsubscribe = subscribeAuthorizationChange(() =>
      setStatus(healthAdapter.getAuthorization()),
    );
    // why AppState too: this is also changed from the Health app, which suspends us rather than
    // remounting the screen — foregrounding is the only signal that answer may differ (as in
    // useLocationPermission).
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setStatus(healthAdapter.getAuthorization());
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);

  return status;
}
