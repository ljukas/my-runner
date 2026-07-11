import { describe, expect, test } from 'bun:test';

import { createSettingsStore } from './settings';
import type { StringStorage } from './storage';

function fakeStorage(initial: Record<string, string> = {}): StringStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItemSync: (key) => map.get(key) ?? null,
    setItemSync: (key, value) => void map.set(key, value),
  };
}

describe('createSettingsStore', () => {
  test('starts from defaults', () => {
    const store = createSettingsStore(fakeStorage());
    expect(store.getSnapshot()).toEqual({ useCompressedPlan: false, keepScreenAwake: true });
  });

  test('set persists, replaces the snapshot object, and notifies subscribers', () => {
    const storage = fakeStorage();
    const store = createSettingsStore(storage);
    const before = store.getSnapshot();
    let notified = 0;
    store.subscribe(() => notified++);

    store.set('useCompressedPlan', true);

    expect(store.getSnapshot().useCompressedPlan).toBe(true);
    expect(store.getSnapshot()).not.toBe(before);
    expect(notified).toBe(1);
    // persisted: a second store over the same storage sees the value
    expect(createSettingsStore(storage).getSnapshot().useCompressedPlan).toBe(true);
  });

  test('unknown persisted keys are ignored, missing ones defaulted', () => {
    const storage = fakeStorage({ settings: JSON.stringify({ keepScreenAwake: false, junk: 1 }) });
    const store = createSettingsStore(storage);
    expect(store.getSnapshot()).toEqual({ useCompressedPlan: false, keepScreenAwake: false });
  });

  test('unsubscribe stops notifications', () => {
    const store = createSettingsStore(fakeStorage());
    let notified = 0;
    const unsubscribe = store.subscribe(() => notified++);
    unsubscribe();
    store.set('keepScreenAwake', false);
    expect(notified).toBe(0);
  });
});
