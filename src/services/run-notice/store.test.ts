import { describe, expect, test } from 'bun:test';

import { createRunNotices } from './store';

function fakeTimers() {
  let pending: { fn: () => void; id: number } | null = null;
  let next = 1;
  return {
    timers: {
      set: (fn: () => void) => {
        pending = { fn, id: next++ };
        return pending.id;
      },
      clear: (id: number) => {
        if (pending?.id === id) pending = null;
      },
    },
    fire: () => pending?.fn(),
    armed: () => pending !== null,
  };
}

describe('the run notice', () => {
  test('shows what was posted, then expires on its own', () => {
    const t = fakeTimers();
    const notices = createRunNotices(6000, t.timers);
    notices.post('discarded');
    expect(notices.getSnapshot()).toBe('discarded');
    t.fire();
    expect(notices.getSnapshot()).toBeNull();
  });

  test('a new post replaces the notice and restarts its time', () => {
    const t = fakeTimers();
    const notices = createRunNotices(6000, t.timers);
    notices.post('discarded');
    notices.post('tooShort');
    expect(notices.getSnapshot()).toBe('tooShort');
    t.fire();
    expect(notices.getSnapshot()).toBeNull();
  });

  test('dismiss clears it at once and cancels its timer', () => {
    const t = fakeTimers();
    const notices = createRunNotices(6000, t.timers);
    notices.post('tooShort');
    notices.dismiss();
    expect(notices.getSnapshot()).toBeNull();
    expect(t.armed()).toBe(false);
  });

  test('subscribers hear each change once', () => {
    const t = fakeTimers();
    const notices = createRunNotices(6000, t.timers);
    let calls = 0;
    notices.subscribe(() => (calls += 1));
    notices.post('discarded');
    notices.dismiss();
    notices.dismiss();
    expect(calls).toBe(2);
  });
});
