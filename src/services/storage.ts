/** The synchronous subset of expo-sqlite/kv-store that services persist through. */
export type StringStorage = {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
};

/**
 * Read and parse a stored JSON value; `null` when missing or corrupt —
 * corrupted storage must never crash startup. Callers validate the shape.
 */
export function readJson(storage: StringStorage, key: string): unknown {
  const raw = storage.getItemSync(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
