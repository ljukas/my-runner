import { isE2EBuild } from './e2e';
import { readJson, type StringStorage } from './storage';

export interface SettingsValues {
  /** Dev/E2E only: swap the NHS plan for the seconds-long compressed plan. */
  useCompressedPlan: boolean;
  /** Keep the display on for the whole run (spec decisions log). */
  keepScreenAwake: boolean;
}

const STORAGE_KEY = 'settings';

export function createSettingsStore(storage: StringStorage) {
  // Compressed plan is default-on in the E2E build so flows need no toggle;
  // dev and production default it off. Evaluated per store creation so tests can
  // vary EXPO_PUBLIC_E2E.
  const defaults: SettingsValues = { useCompressedPlan: isE2EBuild(), keepScreenAwake: true };
  let snapshot = load();
  const listeners = new Set<() => void>();

  function load(): SettingsValues {
    const parsed = readJson(storage, STORAGE_KEY);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...defaults }; // non-object JSON is corruption too
    }
    const values = parsed as Partial<SettingsValues>;
    return {
      useCompressedPlan: values.useCompressedPlan ?? defaults.useCompressedPlan,
      keepScreenAwake: values.keepScreenAwake ?? defaults.keepScreenAwake,
    };
  }

  return {
    getSnapshot: (): SettingsValues => snapshot,
    set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void {
      snapshot = { ...snapshot, [key]: value };
      storage.setItemSync(STORAGE_KEY, JSON.stringify(snapshot));
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
