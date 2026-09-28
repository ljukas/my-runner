import { useKeepAwake } from 'expo-keep-awake';

/** Lock-only, per ADR 0008 §5. */
export function runHoldsScreenAwake(locked: boolean): boolean {
  return locked;
}

/** useKeepAwake takes no enabled flag, so conditionality is expressed by mounting. */
export function KeepAwakeWhileMounted() {
  useKeepAwake();
  return null;
}
