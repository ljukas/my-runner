import type { RunEvent } from './types';

/**
 * Active time is derived from the timestamped event log, never accumulated
 * (ADR 0007). If currently paused, elapsed is frozen at the pause timestamp.
 */
export function activeElapsedMs(events: readonly RunEvent[], now: number): number {
  if (events.length === 0) return 0;
  const startAt = events[0].at;
  let pausedTotal = 0;
  let pausedAt: number | null = null;
  for (const event of events) {
    if (event.type === 'pause' && pausedAt === null) pausedAt = event.at;
    if (event.type === 'resume' && pausedAt !== null) {
      pausedTotal += event.at - pausedAt;
      pausedAt = null;
    }
  }
  const end = pausedAt ?? Math.max(now, events[events.length - 1].at);
  return Math.max(0, end - startAt - pausedTotal);
}
