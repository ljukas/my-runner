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
  test('shows what was posted, then expires on its own once seen', () => {
    const t = fakeTimers();
    const notices = createRunNotices(6000, t.timers);
    notices.post('discarded');
    expect(notices.getSnapshot()).toBe('discarded');
    notices.shown();
    t.fire();
    expect(notices.getSnapshot()).toBeNull();
  });

  test('a new post replaces the notice and restarts its time', () => {
    const t = fakeTimers();
    const notices = createRunNotices(6000, t.timers);
    notices.post('discarded');
    notices.shown();
    notices.post('tooShort');
    expect(notices.getSnapshot()).toBe('tooShort');
    expect(t.armed()).toBe(false);
    notices.shown();
    t.fire();
    expect(notices.getSnapshot()).toBeNull();
  });

  test('dismiss clears it at once and cancels its timer', () => {
    const t = fakeTimers();
    const notices = createRunNotices(6000, t.timers);
    notices.post('tooShort');
    notices.shown();
    notices.dismiss();
    expect(notices.getSnapshot()).toBeNull();
    expect(t.armed()).toBe(false);
  });

  test('its time starts when it is first shown, not when it is posted', () => {
    const t = fakeTimers();
    const notices = createRunNotices(6000, t.timers);
    notices.post('discarded');
    expect(t.armed()).toBe(false);
    notices.shown();
    expect(t.armed()).toBe(true);
    t.fire();
    notices.shown();
    expect(t.armed()).toBe(false);
    expect(notices.getSnapshot()).toBeNull();
  });

  test('showing it again does not restart its time', () => {
    const t = fakeTimers();
    let sets = 0;
    const notices = createRunNotices(6000, {
      ...t.timers,
      set: (fn: () => void) => ((sets += 1), t.timers.set(fn)),
    });
    notices.post('tooShort');
    notices.shown();
    notices.shown();
    expect(sets).toBe(1);
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
