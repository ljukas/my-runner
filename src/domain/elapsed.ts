/** A count-up clock's display (spec §5.2): whole seconds run, `M:SS` under an hour, `H:MM:SS` from one. */

export function elapsedSecondsAt(anchorMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - anchorMs) / 1000));
}

/** Milliseconds until the clock next turns over, in (0, 1000]. */
export function msUntilNextSecond(anchorMs: number, nowMs: number): number {
  if (nowMs < anchorMs) return Math.min(1000, anchorMs - nowMs);
  return 1000 - ((nowMs - anchorMs) % 1000);
}

export interface ElapsedParts {
  /** Absent under an hour. */
  hours?: number;
  minutes: number;
  seconds: number;
}

export function elapsedParts(totalSeconds: number): ElapsedParts {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(whole / 60) % 60;
  const seconds = whole % 60;
  return whole >= 3600
    ? { hours: Math.floor(whole / 3600), minutes, seconds }
    : { minutes, seconds };
}

export function formatElapsed(totalSeconds: number): string {
  const { hours, minutes, seconds } = elapsedParts(totalSeconds);
  const ss = String(seconds).padStart(2, '0');
  return hours === undefined
    ? `${minutes}:${ss}`
    : `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
}
