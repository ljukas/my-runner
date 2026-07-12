import { parseSessionKey, type SegmentKind } from './plan';

/** Display names for segment kinds, shared by the run and summary screens (and later TTS cues). */
export const SEGMENT_KIND_LABEL: Record<SegmentKind, string> = {
  warmup: 'Warm up',
  run: 'Run',
  walk: 'Walk',
  cooldown: 'Cool down',
};

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
