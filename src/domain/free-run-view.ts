// What a free run's surfaces say (spec §5), kept out of the platform forks so it exists once.
import { formatPace } from './format';
import type { MotionKind } from './run-motion';

/** A location permission as the run screen reads it; null before the first read. */
export type LocationState = 'granted' | 'denied' | 'undetermined' | 'unsupported' | null;

export type FreeRunLook = MotionKind | 'waiting' | 'timerOnly';

const MOTION_LABEL: Record<MotionKind, string> = {
  run: 'Running',
  walk: 'Walking',
  stopped: 'Stopped',
};

export function freeRunPhase({
  motion,
  gpsStale,
  location,
}: {
  motion: MotionKind | null;
  gpsStale: boolean;
  location: LocationState;
}): { look: FreeRunLook; label: string } {
  // why null counts as granted: an unread permission must not flash "Timer only" at the start
  if (location !== null && location !== 'granted')
    return { look: 'timerOnly', label: 'Timer only' };
  if (gpsStale || motion === null) return { look: 'waiting', label: 'Waiting for GPS' };
  return { look: motion, label: MOTION_LABEL[motion] };
}

/** Distance and pace show only where they can move, or already have — never a permanent 0.00 km. */
export function showsRunMetrics(location: LocationState, distanceM: number): boolean {
  return location === 'granted' || distanceM > 0;
}

export function formatRollingPace(secondsPerKm: number | null): string {
  return secondsPerKm === null ? '—' : formatPace(secondsPerKm);
}

export function freeRunLocationLine(location: LocationState): string {
  if (location === 'granted') return 'Location is on: distance, pace and route are recorded.';
  if (location === 'undetermined' || location === null) {
    return 'Location is asked when you start, for distance, pace and route.';
  }
  return 'Location is off: this run will be timer only.';
}

export const FREE_RUN_CARD = {
  title: 'Free run',
  detail: 'Run, walk or stop as you like — no plan.',
} as const;

export const FREE_RUN_END_DIALOG = {
  title: 'End this run?',
  message: 'Save it to your Log, or discard it.',
  save: 'Save Run',
  discard: 'Discard',
} as const;
