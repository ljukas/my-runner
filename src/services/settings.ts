import { readJson, type StringStorage } from './storage';

export interface SettingsValues {
  /** Dev/E2E only: swap the NHS plan for the seconds-long compressed plan. */
  useCompressedPlan: boolean;
  /** Keep the display on for the whole run (spec decisions log). */
  keepScreenAwake: boolean;
}

const DEFAULTS: SettingsValues = { useCompressedPlan: false, keepScreenAwake: true };
const STORAGE_KEY = 'settings';

export function createSettingsStore(storage: StringStorage) {
  let snapshot = load();
  const listeners = new Set<() => void>();

  function load(): SettingsValues {
    const parsed = readJson(storage, STORAGE_KEY);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULTS }; // non-object JSON is corruption too
    }
    const values = parsed as Partial<SettingsValues>;
    return {
      useCompressedPlan: values.useCompressedPlan ?? DEFAULTS.useCompressedPlan,
      keepScreenAwake: values.keepScreenAwake ?? DEFAULTS.keepScreenAwake,
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
