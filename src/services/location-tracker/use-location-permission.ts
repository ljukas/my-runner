import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { locationTracker } from './adapter';
import type { LocationPermissionStatus } from './port';

let cached: LocationPermissionStatus | null = null;

/** When-In-Use permission status; `null` until the first read resolves. */
export function useLocationPermission(): LocationPermissionStatus | null {
  const [status, setStatus] = useState<LocationPermissionStatus | null>(cached);

  useEffect(() => {
    let active = true;
    const read = () => {
      void locationTracker
        .getPermissionStatus()
        .then((next) => {
          if (active) {
            cached = next;
            setStatus(next);
          }
        })
        .catch((error) => console.warn('[location] status read failed', error));
    };
    read();
    // why AppState: changing the permission happens in system Settings, which suspends the app
    // rather than remounting the screen — foregrounding is the only signal the answer may differ.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return status;
}
