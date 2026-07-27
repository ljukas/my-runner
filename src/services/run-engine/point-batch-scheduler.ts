/**
 * Coalesces the ~1 Hz fix stream into one `RunStore.flush()` every `flushMs`
 * (spec §5, ADR 0007 §5) so each fix does not open its own SQLite transaction.
 *
 * why leading-edge throttle, not debounce: the first un-flushed `arm()` opens the
 * window and later `arm()`s coalesce into it. A debounce would push the timer out on
 * every fix and starve persistence during continuous movement, widening crash-loss.
 *
 * why `stop()` is re-armable, not a terminal latch: the engine reuses one long-lived
 * scheduler across runs; a latch would kill persistence on every run after the first.
 */

export const POINT_FLUSH_MS = 5000;

export interface PointBatchScheduler {
  /** Ensure a flush is scheduled within `flushMs`; a burst of `arm()`s coalesces into the pending one. */
  arm(): void;
  /** Cancel any pending flush. Idempotent and re-armable — a later `arm()` opens a fresh window. */
  stop(): void;
}

export function createPointBatchScheduler(options: {
  flushMs: number;
  flush: () => void;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
}): PointBatchScheduler {
  const {
    flushMs,
    flush,
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  } = options;

  let pending: unknown = null;

  function cancelPending(): void {
    if (pending !== null) {
      clearTimeoutFn(pending);
      pending = null;
    }
  }

  return {
    arm(): void {
      if (pending !== null) return; // coalesce: a flush is already scheduled
      pending = setTimeoutFn(() => {
        pending = null;
        flush();
      }, flushMs);
    },
    stop(): void {
      cancelPending();
    },
  };
}
