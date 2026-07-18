/**
 * Audio-session release scheduling for the cue adapter (ADR 0009 §3): music
 * must duck only around utterances, so the session is deactivated a short
 * debounce after speech finishes. Pure TS with injectable timers (the same
 * seam pattern as the engine's injected Clock, ADR 0003/0007) so `bun test`
 * can cover it without the RN runtime.
 *
 * The adapter pairs the calls 1:1 with utterances: `begin()` before each
 * `Speech.speak`, `end()` from the utterance's terminal callback. expo-speech
 * fires exactly one terminal event (onDone/onError/onStopped) per utterance —
 * its JS callbacks are deleted after the first terminal event — so the
 * pairing holds.
 */

export const RELEASE_DEBOUNCE_MS = 500;

export interface ReleaseScheduler {
  /** An utterance is about to be handed to the synthesizer. */
  begin(): void;
  /** An utterance reached its terminal callback (done/error/stopped). */
  end(): void;
  /** Hard teardown: forget in-flight utterances and any pending release. */
  reset(): void;
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

  let pending: unknown = null;

  function cancelPending(): void {
    if (pending !== null) {
      clearTimeoutFn(pending);
      pending = null;
    }
  }

  function scheduleRelease(): void {
    cancelPending();
    pending = setTimeoutFn(() => {
      pending = null;
      release();
    }, debounceMs);
  }

  return {
    begin: cancelPending,
    end: scheduleRelease,
    reset: cancelPending,
  };
}
