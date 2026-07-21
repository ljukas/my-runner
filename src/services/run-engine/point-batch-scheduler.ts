/**
 * Point-persistence batch cadence for the run engine (spec §5, ADR 0007 §5):
 * background location delivers fixes at ~1 Hz, but each fix must NOT trigger its
 * own SQLite transaction. This coalesces the fix stream into one flush every
 * `flushMs` — `RunStore.flush()` batch-inserts the buffered `run_points` and
 * upserts the tiny `active_run_snapshot` (event log + watermarks only) in a
 * single transaction. Pure TS with injectable timers (the same seam as the
 * engine's injected Clock and the cue adapter's release scheduler, ADR 0003 /
 * 0007) so `bun test` covers it without the RN runtime — no platform imports.
 *
 * Driven per fix. The engine pokes `arm()` from the per-fix ingest path (plan
 * architecture: `batchScheduler` sits inside `heartbeat`'s ingest block, run
 * only when `status==='running'`), and the scheduler coalesces that ~1 Hz
 * stream into a flush at most every `flushMs`. `arm()` from T13; `stop()` (the
 * "idempotent stop") from T5.
 *
 * Cadence (leading-edge throttle), not debounce. Unlike the release scheduler
 * (which resets its timer on every `begin()`), `arm()` does NOT push the flush
 * out: the first un-flushed `arm()` opens a `flushMs` window and later `arm()`s
 * within it coalesce into that one pending flush. A debounce would starve
 * persistence during continuous movement — the timer would never mature while
 * fixes keep arriving, so points would only reach the DB at a GPS gap or run
 * end, widening the crash-loss window unboundedly. A leading-edge cadence
 * guarantees buffered points are durable within `flushMs` of the first one
 * (spec §5's "every ~5s").
 *
 * `stop()` is a plain, RE-ARMABLE cancel — it mirrors `release-scheduler.reset()`,
 * not a terminal latch. The run engine is a long-lived singleton
 * (`run-engine/index.ts`) reused across every run via `start()`/`reset()`, and
 * this scheduler is one of its members, created once — exactly like the cue
 * adapter's module-scope `releaseScheduler`. A terminal latch would silently
 * kill persistence on every run after the first, so `stop()` only cancels the
 * pending flush; a later `arm()` opens a fresh window again. The
 * post-`stopLocationUpdatesAsync` stray-fix race (iOS can hand JS a queued
 * location just after the engine stops tracking) is closed upstream, where the
 * plan already puts it: `heartbeat` early-returns unless `status==='running'`,
 * so a fix delivered after `finalize()`/`reset()` never reaches ingestion/`arm()`.
 *
 * The `flush` closure owns its own async error handling (T13: catch the DB
 * rejection, retain → retry) and must not throw synchronously. Like the release
 * scheduler's `release: () => void`, the scheduler never awaits and adds no
 * `try/catch`, so timing-first fault isolation (spec §11) stays at the engine
 * call site rather than being masked here.
 */

export const POINT_FLUSH_MS = 5000;

export interface PointBatchScheduler {
  /** A batch of points is buffered. Ensures a flush is scheduled within
   * `flushMs`; a burst of `arm()`s coalesces into the pending flush already in
   * flight (the cadence is measured from the first un-flushed `arm()`, not reset
   * per tick). */
  arm(): void;
  /** Cancel any pending flush (idempotent). Re-armable: a later `arm()` opens a
   * fresh `flushMs` window. The engine reuses one long-lived scheduler across
   * runs and drives its own final synchronous flush on `finalize()`. */
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
      if (pending !== null) return; // a flush is already scheduled — coalesce this tick
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
