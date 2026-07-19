import { useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { scheduleOnRN } from 'react-native-worklets';
import { runEngine } from './index';
import type { EngineStatus } from './types';

/**
 * How far in the future `endsAt` may be and still be trusted as the boundary
 * timestamp. With Reduce Motion off, the completion callback lands at or after
 * the boundary in animation time — `endsAt` and the animation duration come
 * from the same snapshot — so any apparent earliness against `Date.now()` is
 * clock-domain skew and scheduling jitter of at most a few frames; 250 ms
 * covers that with an order of magnitude to spare. With Reduce Motion on,
 * `withTiming` completes instantly and `endsAt` is a whole segment in the
 * future — at least 2 s even on the compressed E2E plan — so it always
 * exceeds the tolerance and the run cannot fast-forward.
 */
const BOUNDARY_TOLERANCE_MS = 250;

/**
 * Advances the engine exactly at the segment boundary. Passing the boundary
 * timestamp makes the crossing deterministic regardless of frame timing;
 * `heartbeat` derives everything from the event log, so records stay correct.
 * `endsAt` is speculative, though — it only becomes real once the animation
 * has run its full duration. When the completion fired far ahead of the
 * boundary (Reduce Motion collapses `withTiming` to instant completion),
 * trusting it would fast-forward the run a whole segment per effect pass, so
 * the future timestamp is discarded in favour of the real clock — a plain
 * refresh that advances nothing — and the per-second interval heartbeat
 * advances the run in real time instead.
 */
function advanceToBoundary(endsAt: number): void {
  const now = Date.now();
  runEngine.heartbeat(endsAt - now <= BOUNDARY_TOLERANCE_MS ? endsAt : now);
}

/**
 * The per-frame segment clock: one shared value (seconds remaining) driven by a
 * linear `withTiming` to 0 whose completion callback advances the run engine —
 * so the value hitting 0, the countdown reading 0:00.00, the bar reaching 1.0,
 * and the logical segment advance are the same event. Read-only for consumers;
 * both the countdown and the progress bar derive from it. Re-seeded from the
 * engine's authoritative snapshot on every segment or run-status change.
 */
export function useSegmentClock(segmentIndex: number, status: EngineStatus): SharedValue<number> {
  const remaining = useSharedValue(0);

  useEffect(() => {
    // Read fresh authoritative values here (not via deps) so per-second
    // heartbeats don't restart the animation; this effect only re-seeds on a
    // real segment/status transition.
    const snap = runEngine.getSnapshot();
    cancelAnimation(remaining);
    const remainingS = Math.max(0, snap.segmentSecondsRemaining);
    if (status === 'running' && snap.segmentEndsAt != null) {
      const endsAt = snap.segmentEndsAt;
      remaining.value = remainingS;
      remaining.value = withTiming(
        0,
        { duration: remainingS * 1000, easing: Easing.linear },
        (finished) => {
          'worklet';
          if (finished) scheduleOnRN(advanceToBoundary, endsAt);
        },
      );
    } else {
      // paused / idle / completed / endedEarly: freeze at the authoritative value
      remaining.value = remainingS;
    }
  }, [segmentIndex, status, remaining]);

  return remaining;
}
