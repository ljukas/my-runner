import { parseSessionKey, type PlanSession, type SegmentKind } from './plan';

/** Display names for segment kinds, shared by the run and summary screens (and later TTS cues). */
export const SEGMENT_KIND_LABEL: Record<SegmentKind, string> = {
  warmup: 'Warm Up',
  run: 'Run',
  walk: 'Walk',
  cooldown: 'Cool Down',
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

/**
 * A duration split into a display value and its unit word, Apple Health
 * style: under a minute reads in whole seconds ("16" + "seconds"), otherwise
 * as the m:ss clock ("8:00" + "min"). Ceils like formatClock, so the two
 * never disagree at the minute boundary.
 */
export function clockParts(totalSeconds: number): { value: string; unit: 'seconds' | 'min' } {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return s < 60 ? { value: String(s), unit: 'seconds' } : { value: formatClock(s), unit: 'min' };
}

/** Run date for the summary header, e.g. "Thu, Jan 1". Locale-dependent (device locale by default). */
export function formatRunDate(iso: string, locale?: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Distance in kilometres, metric only, always to two decimals so the value
 * keeps a stable width in a monospacedDigit row: `2310 → "2.31 km"`,
 * `0 → "0.00 km"`. Defensive like the rest of this module: negative input
 * (never expected from the haversine accumulator) clamps to zero, and
 * non-finite input (`NaN`/`±Infinity`) renders `"0.00 km"` rather than
 * `"NaN km"`, matching the guard on its sibling formatPace.
 */
export function formatDistanceKm(meters: number): string {
  if (!Number.isFinite(meters)) {
    return '0.00 km';
  }
  return `${(Math.max(0, meters) / 1000).toFixed(2)} km`;
}

/**
 * Average pace as `m:ss /km`, metric only: `389 → "6:29 /km"`. Pace is a
 * duration/distance quotient, so it is structurally degenerate before any
 * distance exists — a nullish value (straight from `paceSecPerKm`, which
 * returns `number | null`), `0`, negatives, `Infinity` (distance 0), and
 * `NaN` (0/0) all render the `--:-- /km` placeholder instead of a bogus
 * clock. Seconds round to the nearest whole second — an unbiased average,
 * unlike formatClock's countdown ceil, and the rounding is what carries
 * `359.6 → 360 → "6:00"`; a value that rounds down to zero seconds is
 * degenerate too. The rounded integer is then handed to formatClock, reusing
 * the one canonical m:ss splitter (padding + minute math).
 */
export function formatPace(secondsPerKm: number | null): string {
  if (secondsPerKm == null || !Number.isFinite(secondsPerKm)) {
    return '--:-- /km';
  }
  const seconds = Math.round(secondsPerKm);
  if (seconds <= 0) {
    return '--:-- /km';
  }
  return `${formatClock(seconds)} /km`;
}
