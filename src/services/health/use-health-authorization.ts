import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { healthAdapter } from './adapter';
import type { HealthAuthorization } from './port';

/** Write-access status, re-read whenever the app returns to the foreground. */
export function useHealthAuthorization(): HealthAuthorization {
  const [status, setStatus] = useState<HealthAuthorization>(() => healthAdapter.getAuthorization());

  useEffect(() => {
    // why AppState: this is changed in the Health app, which suspends us rather than remounting the
    // screen — foregrounding is the only signal the answer may differ (as in useLocationPermission).
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setStatus(healthAdapter.getAuthorization());
    });
    return () => subscription.remove();
  }, []);

  return status;
}
