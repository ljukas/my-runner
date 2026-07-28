import { useKeepAwake } from 'expo-keep-awake';

/** useKeepAwake takes no enabled flag, so conditionality is expressed by mounting. */
export function KeepAwakeWhileMounted() {
  useKeepAwake();
  return null;
}
