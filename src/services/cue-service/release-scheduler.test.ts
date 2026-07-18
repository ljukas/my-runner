import { describe, expect, test } from 'bun:test';

import { createReleaseScheduler, RELEASE_DEBOUNCE_MS } from './release-scheduler';

/**
 * Deterministic harness: injected fake timers (no global mocking, same style
 * as the engine's injected clock) plus a fake speech queue — `announce()`
 * pairs a `begin()` with a returned `finish()` that fires the utterance's
 * single terminal callback, mirroring expo-speech's exactly-once semantics.
 */
function makeHarness() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const releases: number[] = [];
  const scheduler = createReleaseScheduler({
    debounceMs: RELEASE_DEBOUNCE_MS,
    release: () => void releases.push(now),
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
  const announce = () => {
    scheduler.begin();
    return () => scheduler.end();
  };
  return { scheduler, releases, advance, announce };
}

describe('release scheduler (ADR 0009 §3)', () => {
  test('a single cue releases the session once, after the debounce', () => {
    const { releases, advance, announce } = makeHarness();
    const finish = announce();
    finish();
    advance(RELEASE_DEBOUNCE_MS - 1);
    expect(releases).toHaveLength(0);
    advance(1);
    expect(releases).toEqual([RELEASE_DEBOUNCE_MS]);
  });

  // Regression for issue #41: W3's halfway milestone lands exactly on a
  // walk→run boundary, so the engine announces two cues in one heartbeat and
  // the second utterance queues inside the shared AVSpeechSynthesizer. The
  // session must NOT be released when the first utterance finishes — doing so
  // deactivates the audio session mid-queue and wedges the synthesizer,
  // silencing every cue for the rest of the run.
  test('back-to-back cues never release while the second utterance is in flight', () => {
    const { releases, advance, announce } = makeHarness();
    const finishTransition = announce(); // "Start running."
    const finishMilestone = announce(); // "You're halfway there." — queued natively
    finishTransition(); // utterance #1 ends while #2 is speaking
    advance(RELEASE_DEBOUNCE_MS);
    expect(releases).toHaveLength(0);
    finishMilestone();
    advance(RELEASE_DEBOUNCE_MS);
    expect(releases).toHaveLength(1);
  });

  test('reset cancels the pending release and neutralizes late terminal callbacks', () => {
    const { scheduler, releases, advance, announce } = makeHarness();
    const finish = announce();
    scheduler.reset(); // release(): hard teardown mid-utterance
    finish(); // onStopped from Speech.stop() flushing the queue
    advance(RELEASE_DEBOUNCE_MS * 2);
    expect(releases).toHaveLength(0);
  });

  test('a synchronous speak failure still lets the session release', () => {
    const { releases, advance, announce } = makeHarness();
    const finishFirst = announce();
    const finishFailed = announce(); // Speech.speak threw — the catch calls end()
    finishFirst();
    finishFailed();
    advance(RELEASE_DEBOUNCE_MS);
    expect(releases).toHaveLength(1);
  });

  test('a new announce during the debounce window cancels the pending release', () => {
    const { releases, advance, announce } = makeHarness();
    const finishFirst = announce();
    finishFirst();
    advance(RELEASE_DEBOUNCE_MS - 100); // inside the debounce window
    const finishSecond = announce();
    advance(RELEASE_DEBOUNCE_MS * 2);
    expect(releases).toHaveLength(0); // held while the new utterance speaks
    finishSecond();
    advance(RELEASE_DEBOUNCE_MS);
    expect(releases).toHaveLength(1);
  });
});
