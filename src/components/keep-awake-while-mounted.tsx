import { useKeepAwake } from 'expo-keep-awake';
import { Platform } from 'react-native';

/**
 * iOS holds the display only while the run lock is on (ADR 0008 §5); Android stage 1 has no
 * background heartbeat at all, so the whole run does (ADR 0025) — a sleeping screen there would
 * silently drop every cue.
 */
export function runHoldsScreenAwake(locked: boolean): boolean {
  return locked || Platform.OS === 'android';
}

/** useKeepAwake takes no enabled flag, so conditionality is expressed by mounting. */
export function KeepAwakeWhileMounted() {
  useKeepAwake();
  return null;
}
