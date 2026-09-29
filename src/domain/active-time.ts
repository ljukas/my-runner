import type { LoggedRunEvent } from './run-altitude';

/**
 * Active time is derived from the timestamped event log, never accumulated
 * (ADR 0007). If currently paused, elapsed is frozen at the pause timestamp.
 */
export function activeElapsedMs(events: readonly LoggedRunEvent[], now: number): number {
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

/**
 * The wall-clock instant a run's active time reached `activeS`, skipping the pauses before it; null
 * when the log never gets there (the run is paused, or its last event is earlier).
 */
export function wallClockAtActive(
  events: readonly LoggedRunEvent[],
  activeS: number,
): number | null {
  if (events.length === 0) return null;
  let remainingMs = activeS * 1000;
  let runningFrom: number | null = events[0].at;
  for (const event of events.slice(1)) {
    if (event.type === 'pause' && runningFrom !== null) {
      const ranMs = event.at - runningFrom;
      if (ranMs >= remainingMs) return runningFrom + remainingMs;
      remainingMs -= ranMs;
      runningFrom = null;
    } else if (event.type === 'resume' && runningFrom === null) {
      runningFrom = event.at;
    }
  }
  return runningFrom === null ? null : runningFrom + remainingMs;
}
