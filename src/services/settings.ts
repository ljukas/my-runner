import type { StringStorage } from './storage';

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
    const raw = storage.getItemSync(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    let parsed: Partial<SettingsValues>;
    try {
      parsed = JSON.parse(raw) as Partial<SettingsValues>;
    } catch {
      return { ...DEFAULTS }; // corrupted storage must never crash startup
    }
    return {
      useCompressedPlan: parsed.useCompressedPlan ?? DEFAULTS.useCompressedPlan,
      keepScreenAwake: parsed.keepScreenAwake ?? DEFAULTS.keepScreenAwake,
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
