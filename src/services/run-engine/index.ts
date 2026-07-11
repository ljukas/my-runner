import { useSyncExternalStore } from 'react';

import { dbRunPersistence } from '@/db/save-run';
import { RunEngine } from './engine';

export const runEngine = new RunEngine({ persistence: dbRunPersistence });

export function useRunEngine() {
  return useSyncExternalStore(runEngine.subscribe, runEngine.getSnapshot);
}

export type { CompletedRunRecord, EngineStatus, RunSnapshot } from './types';
