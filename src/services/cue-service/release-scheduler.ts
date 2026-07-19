/**
 * Audio-session release scheduling for the cue adapter (ADR 0009 §3): music
 * must duck only around utterances, so the session is deactivated a short
 * debounce after speech finishes. Pure TS with injectable timers (the same
 * seam pattern as the engine's injected Clock, ADR 0003/0007) so `bun test`
 * can cover it without the RN runtime.
 *
 * The session is released only after the LAST in-flight utterance completes
 * (issue #41): when a milestone lands on a segment transition (W3's halfway is
 * exactly a walk→run boundary), the second utterance queues natively inside
 * the shared AVSpeechSynthesizer, and deactivating the session when the first
 * one finishes wedges the synthesizer — every later cue enqueues behind the
 * dead utterance and never plays. So `end()` counts utterances down and only
 * schedules the release when none remain in flight.
 *
 * The adapter pairs the calls 1:1 with utterances: `begin()` before each
 * `Speech.speak`, `end()` from the utterance's terminal callback. expo-speech
 * fires exactly one terminal event (onDone/onError/onStopped) per utterance —
 * its JS callbacks are deleted after the first terminal event — so the pairing
 * holds. (onError is currently unreachable on iOS, which only emits
 * Done/Stopped; it is wired for a future Android adapter.) Deliberate
 * scope-outs, accepted as smaller failures than issue #41's permanent silence:
 * - No per-utterance watchdog: if a terminal callback is lost to a native
 *   anomaly, the count stays >0 and music remains ducked until the run-end
 *   `reset()` (self-healing at `release()`, re-armored at `prepare()`).
 * - A stale terminal callback landing AFTER a subsequent `begin()` would
 *   decrement the new utterance's count. Unreachable in practice: terminal
 *   events arrive within milliseconds of `reset()`'s `Speech.stop()`, while
 *   the next `begin()` is a human action (starting a new run) away.
 */

export const RELEASE_DEBOUNCE_MS = 500;

export interface ReleaseScheduler {
  /** An utterance is about to be handed to the synthesizer. */
  begin(): void;
  /** An utterance reached its terminal callback (done/error/stopped). */
  end(): void;
  /** Hard teardown: forget in-flight utterances and any pending release. */
  reset(): void;
  /** True when no utterance is in flight — safe to deactivate the session.
   * Lets `release()`'s deferred teardown skip deactivation when a new run
   * started announcing while `Speech.stop()` was still resolving. */
  isIdle(): boolean;
}

export function createReleaseScheduler(options: {
  debounceMs: number;
  release: () => void;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
}): ReleaseScheduler {
  const {
    debounceMs,
    release,
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  } = options;

  let inFlight = 0;
  let pending: unknown = null;

  function cancelPending(): void {
    if (pending !== null) {
      clearTimeoutFn(pending);
      pending = null;
    }
  }

  return {
    begin(): void {
      cancelPending();
      inFlight += 1;
    },
    end(): void {
      if (inFlight === 0) return; // stray terminal callback after reset() — ignore
      inFlight -= 1;
      if (inFlight > 0) return; // another utterance is queued/speaking — hold the session
      cancelPending();
      pending = setTimeoutFn(() => {
        pending = null;
        release();
      }, debounceMs);
    },
    reset(): void {
      inFlight = 0;
      cancelPending();
    },
    isIdle(): boolean {
      return inFlight === 0;
    },
  };
}
