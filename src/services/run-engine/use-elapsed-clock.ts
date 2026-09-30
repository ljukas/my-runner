import { useEffect, useState } from 'react';

import { elapsedSecondsAt, msUntilNextSecond } from '@/domain/elapsed';

/**
 * Whole seconds of active time for a count-up clock: ticking from `anchorMs` while the run runs,
 * frozen at `frozenSeconds` when it has no anchor (paused or ended).
 */
export function useElapsedClock(anchorMs: number | null, frozenSeconds: number): number {
  // why seeded: a resumed run mounts with a live anchor, and 0 would roll the digits up from 0:00
  const [running, setRunning] = useState(() => Math.floor(frozenSeconds));

  // why a JS timer, not Reanimated: Reduce Motion collapses `withTiming` to instant completion, and
  // the clock changes only once a second anyway
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
