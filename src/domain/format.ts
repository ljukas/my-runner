import { parseSessionKey, type PlanSession, type SegmentKind } from './plan';

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

/**
 * `m:ss.cc` countdown with centiseconds, driven every frame on the UI thread.
 * Ceils to hundredths so `0:00.00` appears only at exactly zero. The `'worklet'`
 * directive lets it run inside a Reanimated reaction; it is an inert string
 * literal under `bun test`.
 */
export function formatCountdown(remainingSeconds: number): string {
  'worklet';
  const cs = Math.ceil(Math.max(0, remainingSeconds) * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

export function formatMinutes(totalSeconds: number): string {
  return `${Math.round(totalSeconds / 60)} min`;
}

export function sessionTitle(key: string): string {
  const parsed = parseSessionKey(key);
  return parsed ? `Week ${parsed.week} · Day ${parsed.day}` : key;
}

/** Human words for a segment length: whole minutes as "N-minute", otherwise "N-second". */
export function durationWords(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}-minute` : `${seconds}-second`;
}

/** One-line description of a session's core intervals (warm-up/cool-down excluded). */
export function sessionSummary(session: PlanSession): string {
  const { segments } = session;
  const from = segments[0]?.kind === 'warmup' ? 1 : 0;
  const to =
    segments[segments.length - 1]?.kind === 'cooldown' ? segments.length - 1 : segments.length;
  const core = segments.slice(from, to);

  if (core.length === 1 && core[0].kind === 'run') {
    return `One continuous ${durationWords(core[0].seconds)} run.`;
  }

  const runs = core.filter((s) => s.kind === 'run');
  const walks = core.filter((s) => s.kind === 'walk');
  const alternating =
    core.length === runs.length + walks.length &&
    runs.length === walks.length + 1 &&
    core.every((s, i) => s.kind === (i % 2 === 0 ? 'run' : 'walk'));
  const uniform =
    alternating &&
    runs.every((s) => s.seconds === runs[0].seconds) &&
    walks.every((s) => s.seconds === walks[0].seconds);
  if (uniform) {
    return `Alternates ${durationWords(runs[0].seconds)} runs with ${durationWords(walks[0].seconds)} walks, ${runs.length} times.`;
  }

  const totalRun = runs.reduce((sum, s) => sum + s.seconds, 0);
  return `${runs.length} run intervals with walk recovery · ${formatMinutes(totalRun)} running.`;
}
