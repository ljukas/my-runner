import type { LocationFix } from '@/domain/geo';
import { sessionTotalSeconds, type PlanSession } from '@/domain/plan';
import type { RunSnapshotState } from '@/services/run-store/port';
import type { RunEvent } from './types';

/** Grace past the planned session length during which an interrupted run is still offered (spec §5). */
export const RESUME_GRACE_MS = 30 * 60 * 1000;

const EVENT_TYPES: RunEvent['type'][] = ['start', 'pause', 'resume', 'skip', 'end'];

function isEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<RunEvent>;
  if (typeof event.at !== 'number' || !Number.isFinite(event.at)) return false;
  return EVENT_TYPES.some((type) => type === event.type);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseFix(value: unknown): LocationFix | null {
  if (typeof value !== 'object' || value === null) return null;
  const fix = value as Partial<LocationFix>;
  if (typeof fix.timestamp !== 'number' || !Number.isFinite(fix.timestamp)) return null;
  if (typeof fix.lat !== 'number' || !Number.isFinite(fix.lat)) return null;
  if (typeof fix.lng !== 'number' || !Number.isFinite(fix.lng)) return null;
  return {
    timestamp: fix.timestamp,
    lat: fix.lat,
    lng: fix.lng,
    altitude: numberOrNull(fix.altitude),
    accuracy: numberOrNull(fix.accuracy),
    // Optional field: an older snapshot lacking it entirely must stay absent, not become an
    // explicit null — `LocationFix.altitudeAccuracy` distinguishes "no field" from "reported null".
    altitudeAccuracy:
      typeof fix.altitudeAccuracy === 'number' || fix.altitudeAccuracy === null
        ? fix.altitudeAccuracy
        : undefined,
    speed: numberOrNull(fix.speed),
  };
}

// Absent for a snapshot written before this slice, and it must stay absent rather than default to
// zero: the resumed run would then re-mint `seq`s the run already stored (spec §5.1).
function parseLogSeq(value: unknown): RunSnapshotState['logSeq'] {
  if (typeof value !== 'object' || value === null) return undefined;
  const { sampleSeq, entrySeq } = value as { sampleSeq?: unknown; entrySeq?: unknown };
  if (typeof sampleSeq !== 'number' || !Number.isInteger(sampleSeq) || sampleSeq < 0) {
    return undefined;
  }
  if (typeof entrySeq !== 'number' || !Number.isInteger(entrySeq) || entrySeq < 0) return undefined;
  return { sampleSeq, entrySeq };
}

/**
 * Narrows an untrusted `state_json` payload; null for anything the engine could not replay. An
 * `end` event is such a case: the run it belongs to already finished, so there is nothing to recover.
 */
export function parseSnapshotState(value: unknown): RunSnapshotState | null {
  if (typeof value !== 'object' || value === null) return null;
  const state = value as Partial<RunSnapshotState>;
  if (typeof state.sessionKey !== 'string' || state.sessionKey === '') return null;
  if (!Array.isArray(state.events) || state.events.length === 0) return null;
  if (!state.events.every(isEvent)) return null;
  if (state.events[0].type !== 'start') return null;
  if (state.events.some((event) => event.type === 'end')) return null;
  if (typeof state.lastAnnouncedIndex !== 'number' || !Number.isInteger(state.lastAnnouncedIndex)) {
    return null;
  }
  if (typeof state.halfwayFired !== 'boolean') return null;
  return {
    sessionKey: state.sessionKey,
    events: state.events.map((event) => ({ ...event })),
    lastAnnouncedIndex: state.lastAnnouncedIndex,
    halfwayFired: state.halfwayFired,
    lastAcceptedFix: parseFix(state.lastAcceptedFix),
    logSeq: parseLogSeq(state.logSeq),
  };
}

/**
 * Freshness gate (spec §5) against the row's own `updated_at`, re-stamped every flush.
 * why the `age >= 0` floor: a backwards device-clock jump would otherwise make an arbitrarily
 * old snapshot look fresh.
 */
export function isSnapshotFresh(updatedAt: string, session: PlanSession, now: number): boolean {
  const stampedAt = Date.parse(updatedAt);
  if (Number.isNaN(stampedAt)) return false;
  const age = now - stampedAt;
  return age >= 0 && age < sessionTotalSeconds(session) * 1000 + RESUME_GRACE_MS;
}

/**
 * Where an interrupted run's record ends: its own flush stamp, the last moment the run is known to
 * have been alive. Finalizing there rather than at `now` keeps a dead process's wall clock out of the
 * record — nothing was tracked after it. Falls back to `now` for an unparseable stamp, and never runs
 * ahead of `now`, which a forwards device-clock jump would otherwise do.
 */
export function snapshotAliveUntil(updatedAt: string, now: number): number {
  const stampedAt = Date.parse(updatedAt);
  return Number.isNaN(stampedAt) ? now : Math.min(stampedAt, now);
}
