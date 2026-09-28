import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { healthAdapter } from './adapter';
import { subscribeAuthorizationChange } from './authorization-events';
import type { HealthAuthorization } from './port';

export { notifyAuthorizationChanged, subscribeAuthorizationChange } from './authorization-events';

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
