import { useSyncExternalStore } from 'react';

import { dbRunPersistence } from '@/db/save-run';
import { cueService } from '@/services/cue-service';
import { RunEngine } from './engine';

export const runEngine = new RunEngine({ persistence: dbRunPersistence, cue: cueService });

export function useRunEngine() {
  return useSyncExternalStore(runEngine.subscribe, runEngine.getSnapshot);
}
