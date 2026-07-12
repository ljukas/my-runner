import type { StringStorage } from './storage';

/** In-memory StringStorage for service tests. */
export function fakeStorage(initial: Record<string, string> = {}): StringStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItemSync: (key) => map.get(key) ?? null,
    setItemSync: (key, value) => void map.set(key, value),
  };
}
