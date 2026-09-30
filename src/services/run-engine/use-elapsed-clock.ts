import { useEffect, useState } from 'react';

import { elapsedSecondsAt, msUntilNextSecond } from '@/domain/elapsed';

/**
 * Whole seconds of active time for a count-up clock: ticking from `anchorMs` while the run runs,
 * frozen at `frozenSeconds` when it has no anchor (paused or ended). why a JS timer and not a
 * Reanimated animation: Reduce Motion collapses `withTiming` to instant completion, and the clock
 * only changes once a second anyway.
 */
export function useElapsedClock(anchorMs: number | null, frozenSeconds: number): number {
  const [running, setRunning] = useState(0);

  useEffect(() => {
    if (anchorMs === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const now = Date.now();
      setRunning(elapsedSecondsAt(anchorMs, now));
      timer = setTimeout(tick, msUntilNextSecond(anchorMs, now));
    };
    tick();
    return () => clearTimeout(timer);
  }, [anchorMs]);

  return anchorMs === null ? Math.floor(frozenSeconds) : running;
}
