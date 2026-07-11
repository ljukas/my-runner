/** The synchronous subset of expo-sqlite/kv-store that services persist through. */
export type StringStorage = {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
};
