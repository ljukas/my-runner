import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { elevationSource } from './adapter';
import type { MotionPermissionStatus } from './port';

let cached: MotionPermissionStatus | null = null;

/** Motion & Fitness permission status; `null` until the first read resolves. */
export function useMotionPermission(): MotionPermissionStatus | null {
  const [status, setStatus] = useState<MotionPermissionStatus | null>(cached);

  useEffect(() => {
    let active = true;
    const read = () => {
      void elevationSource
        .getPermissionStatus()
        .then((next) => {
          if (active) {
            cached = next;
            setStatus(next);
          }
        })
        .catch((error) => console.warn('[elevation] status read failed', error));
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
