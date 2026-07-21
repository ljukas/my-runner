import { describe, expect, test } from 'bun:test';

import { createPointBatchScheduler, POINT_FLUSH_MS } from './point-batch-scheduler';

/**
 * Deterministic harness: injected fake timers (no global mocking, the same style
 * as the release scheduler's and the engine's injected clock). `flushes` records
 * the wall-clock time of every flush, so the cadence is directly assertable.
 */
function makeHarness() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const flushes: number[] = [];
  const scheduler = createPointBatchScheduler({
    flushMs: POINT_FLUSH_MS,
    flush: () => void flushes.push(now),
    setTimeoutFn: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeoutFn: (id) => void timers.delete(id as number),
  });
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = target;
  };
  return { scheduler, flushes, advance };
}

describe('point batch scheduler (spec §5, ~5s persistence cadence)', () => {
  test('an armed batch flushes once, at the cadence', () => {
    const { scheduler, flushes, advance } = makeHarness();
    scheduler.arm();
    advance(POINT_FLUSH_MS - 1);
    expect(flushes).toHaveLength(0);
    advance(1);
    expect(flushes).toEqual([POINT_FLUSH_MS]);
  });

  // A ~1 Hz fix stream keeps calling arm() inside the open window; the cadence
  // must be measured from the first un-flushed arm (leading-edge), not reset per
  // tick — otherwise continuous movement would starve persistence.
  test('a burst of ticks coalesces into a single pending flush at the cadence', () => {
    const { scheduler, flushes, advance } = makeHarness();
    scheduler.arm(); // opens the window at t=0
    advance(1000);
    scheduler.arm();
    advance(1000);
    scheduler.arm();
    scheduler.arm();
    advance(POINT_FLUSH_MS);
    expect(flushes).toEqual([POINT_FLUSH_MS]); // one flush, timed from the first arm
  });

  test('the cadence continues: a fresh arm after a flush schedules the next one', () => {
    const { scheduler, flushes, advance } = makeHarness();
    scheduler.arm();
    advance(POINT_FLUSH_MS); // first flush at 5000
    scheduler.arm();
    advance(POINT_FLUSH_MS); // second flush at 10000
    expect(flushes).toEqual([POINT_FLUSH_MS, POINT_FLUSH_MS * 2]);
  });

  test('stop cancels a pending flush', () => {
    const { scheduler, flushes, advance } = makeHarness();
    scheduler.arm();
    advance(POINT_FLUSH_MS - 1); // inside the open window
    scheduler.stop();
    advance(POINT_FLUSH_MS * 2);
    expect(flushes).toHaveLength(0);
  });

  test('stop is idempotent and fires nothing after a flush already landed', () => {
    const { scheduler, flushes, advance } = makeHarness();
    scheduler.arm();
    advance(POINT_FLUSH_MS); // flush fires at 5000
    scheduler.stop();
    scheduler.stop(); // idempotent — no throw, nothing pending
    advance(POINT_FLUSH_MS * 2);
    expect(flushes).toEqual([POINT_FLUSH_MS]); // no further flush after stop
  });

  // stop() is a re-armable cancel, NOT a terminal latch: the engine is a reused
  // singleton and this scheduler is a reused member, so a later run's arm() must
  // re-open the cadence. (A terminal `stopped` flag would silently kill point
  // persistence on every run after the first.)
  test('stop is re-armable: a later arm reopens the cadence', () => {
    const { scheduler, flushes, advance } = makeHarness();
    scheduler.arm();
    advance(POINT_FLUSH_MS); // first flush at 5000
    scheduler.stop(); // re-armable cancel (nothing pending here)
    scheduler.arm(); // a fresh fix (next run) after stop re-opens the window
    advance(POINT_FLUSH_MS);
    expect(flushes).toEqual([POINT_FLUSH_MS, POINT_FLUSH_MS * 2]); // second flush proves stop() is not terminal
  });
});
