import { useSyncExternalStore } from 'react';

import { runNotices } from './store';

export function useRunNotice() {
  return useSyncExternalStore(runNotices.subscribe, runNotices.getSnapshot);
}
