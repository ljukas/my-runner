import type { SegmentKind } from './plan';

/**
 * Spoken/haptic coaching cues (ADR 0009). The engine fires cues by ID on
 * derived-segment change and at milestones (ADR 0007); phrases and categories
 * live here as pure data so the whole cue script is unit-testable and the
 * sound/haptic producers stay swappable adapters. The concrete haptic pattern
 * per cue is a platform concern and lives in the iOS adapter (ADR 0003).
 */
export const CUE_IDS = [
  'warmupStart',
  'startRun',
  'startWalk',
  'cooldownStart',
  'halfway',
  'lastRun',
  'complete',
  'paused',
  'resumed',
  'resuming',
  'kilometre',
] as const;

export type CueId = (typeof CUE_IDS)[number];

/** Interval cues are the routine transition/control chatter; milestone cues are
 * the occasional motivational moments. The two map to the two Settings toggles. */
export type CueCategory = 'interval' | 'milestone';

export const CUE_CATEGORY: Record<CueId, CueCategory> = {
  warmupStart: 'interval',
  startRun: 'interval',
  startWalk: 'interval',
  cooldownStart: 'interval',
  halfway: 'milestone',
  lastRun: 'milestone',
  complete: 'milestone',
  paused: 'interval',
  resumed: 'interval',
  resuming: 'interval',
  kilometre: 'milestone',
};

/** English cue script (spec §6). Warm-up and cool-down name the walk so the
 * coaching is self-explanatory. */
export const CUE_PHRASE: Record<CueId, string> = {
  warmupStart: "Let's warm up with a brisk walk.",
  startRun: 'Start running.',
  startWalk: 'Start walking.',
  cooldownStart: 'Cool down with a gentle walk.',
  halfway: "You're halfway there.",
  lastRun: 'Last run. Finish strong!',
  complete: 'Workout complete. Great job!',
  paused: 'Paused.',
  resumed: 'Resumed.',
  resuming: 'Resuming your workout.',
  // why no numbers: this is also the pre-recorded fallback's one fixed clip (ADR 0009 amendment)
  kilometre: 'Kilometre.',
};

/** A free run's kilometre cue: the kilometre just reached and the moving pace over it, if known. */
export interface KilometreCueData {
  km: number;
  paceSecPerKm: number | null;
}

export type CueData = KilometreCueData;

/** What a run mode asks to be announced; `data` is typed, never a phrase (ADR 0026 §7). */
export interface ModeCue {
  cue: CueId;
  data?: CueData;
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

// why a floor: a pace under a minute per kilometre is a GPS artefact, not something to read aloud
const MIN_SPOKEN_PACE_S = 60;

/** "2 kilometres. 6 minutes 40 per kilometre." — the pace is dropped when unknown. */
export function kilometrePhrase({ km, paceSecPerKm }: KilometreCueData): string {
  const head = `${plural(km, 'kilometre')}.`;
  if (paceSecPerKm === null || !Number.isFinite(paceSecPerKm)) return head;
  // why rounded before splitting: 359.6 s must read "6 minutes", never "5 minutes 60"
  const total = Math.round(paceSecPerKm);
  if (total < MIN_SPOKEN_PACE_S) return head;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${head} ${plural(minutes, 'minute')}${seconds === 0 ? '' : ` ${seconds}`} per kilometre.`;
}

export function cuePhrase(cue: CueId, data?: CueData): string {
  return cue === 'kilometre' && data ? kilometrePhrase(data) : CUE_PHRASE[cue];
}

/** Which cue announces entry into a segment of a given kind (except the final
 * run, which the engine announces as `lastRun`). */
export const SEGMENT_ENTRY_CUE: Record<SegmentKind, CueId> = {
  warmup: 'warmupStart',
  run: 'startRun',
  walk: 'startWalk',
  cooldown: 'cooldownStart',
};

export interface CuePrefs {
  intervalCues: boolean;
  milestoneCues: boolean;
}

/**
 * The cue that actually plays given the user's preferences, or `null` to stay
 * silent — the single gate for both speech and haptics so the two never drift.
 * `lastRun` degrades to `startRun` when only interval cues are enabled, so
 * entering the final run is never dropped for a listener who wants the
 * transition chatter but not the motivational milestones.
 */
export function effectiveCue(cue: CueId, prefs: CuePrefs): CueId | null {
  if (cue === 'lastRun' && !prefs.milestoneCues) {
    return prefs.intervalCues ? SEGMENT_ENTRY_CUE.run : null;
  }
  const enabled = CUE_CATEGORY[cue] === 'milestone' ? prefs.milestoneCues : prefs.intervalCues;
  return enabled ? cue : null;
}
