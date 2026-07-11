import { parseSessionKey } from './plan';

/** `m:ss` countdown/elapsed clock. Ceils so a fresh segment shows its full length. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatMinutes(totalSeconds: number): string {
  return `${Math.round(totalSeconds / 60)} min`;
}

export function sessionTitle(key: string): string {
  const parsed = parseSessionKey(key);
  return parsed ? `Week ${parsed.week} · Day ${parsed.day}` : key;
}
