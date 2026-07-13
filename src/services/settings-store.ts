import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { createSettingsStore, type SettingsValues } from './settings';

export const settingsStore = createSettingsStore(Storage);

export function useSetting<K extends keyof SettingsValues>(key: K): SettingsValues[K] {
  return useSyncExternalStore(settingsStore.subscribe, () => settingsStore.getSnapshot()[key]);
}
