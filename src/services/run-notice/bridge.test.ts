import { describe, expect, test } from 'bun:test';

import type { RunNotice } from '@/domain/run-notice';
import { bridgeEngineNotices } from './bridge';

function fakeEngine() {
  const listeners = new Set<() => void>();
  let snapshot: { lastOutcome: RunNotice | null } = { lastOutcome: null };
  return {
    engine: {
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => void listeners.delete(l);
      },
      getSnapshot: () => snapshot,
    },
    emit: (next: { lastOutcome: RunNotice | null }) => {
      snapshot = next;
      listeners.forEach((l) => l());
    },
    emitSame: () => listeners.forEach((l) => l()),
  };
}

describe('bridgeEngineNotices', () => {
  test('posts an outcome once per idle snapshot that carries one', () => {
    const e = fakeEngine();
    const posted: RunNotice[] = [];
    bridgeEngineNotices(e.engine, { post: (n) => posted.push(n) });
    e.emit({ lastOutcome: 'discarded' });
    e.emitSame();
    e.emitSame();
    e.emit({ lastOutcome: null });
    e.emit({ lastOutcome: 'tooShort' });
    expect(posted).toEqual(['discarded', 'tooShort']);
  });
});
