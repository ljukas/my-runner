import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';

import { runNotices } from './store';

/** The notice to show; its time starts once the calling screen is focused with it. */
export function useRunNotice() {
  const notice = useSyncExternalStore(runNotices.subscribe, runNotices.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      if (notice !== null) runNotices.shown();
    }, [notice]),
  );
  return notice;
}
