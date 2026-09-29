import { SEGMENT_ENTRY_CUE, type CueId } from '@/domain/cues';
import { sessionTotalSeconds, type PlanSession, type SegmentKind } from '@/domain/plan';
import { buildTimeline, positionAt, totalSeconds, type TimelineSegment } from '@/domain/segments';
import { activeElapsedMs, activeMsBetween, wallClockAtActive } from '@/domain/active-time';
import { FREE_RUN_KEY, OPEN_LIMITS, type RunPlan } from '@/domain/free-run';
import {
  createSmootherState,
  MAX_GAP_S,
  smoothFix,
  type LocationFix,
  type SmootherState,
} from '@/domain/geo';
import { pausedIntervals, type PausedInterval } from '@/domain/run-altitude';
import { createOpenTrackState, openTrackStep, type OpenTrackState } from '@/domain/run-motion';
import { paceSecPerKm } from '@/domain/run-stats';
import { isFieldTestRun } from '@/services/field-test';
import { RESUME_GRACE_MS } from './resumable';
import type { RunLogKind } from './run-log';
import type {
  CompletedSegmentRecord,
  OpenRunSnapshot,
  RunEvent,
  RunSnapshot,
  ScriptedRunSnapshot,
} from './types';

/** Active-elapsed seconds at each skip event, measured against the events before it. */
function skipAtsOf(events: readonly RunEvent[]): number[] {
  return events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'skip')
    .map(({ event, index }) => activeElapsedMs(events.slice(0, index), event.at) / 1000);
}

function timelineOf(session: PlanSession, events: readonly RunEvent[]): TimelineSegment[] {
  return buildTimeline(session.segments, skipAtsOf(events));
}

/**
 * Whether ending at `elapsed` counts as completing the session (issue #40):
 * inside the final segment when it is a cool-down, or past timeline
 * exhaustion. Every work segment is behind the runner, so the cool-down acts
 * as a flex period for ending early — consistent with the engine's
 * skipSegment(), which already completes when the final segment is skipped.
 * `endCountsAsCompleted` below is its snapshot twin: keep the two in sync.
 */
function endsInFinalCooldown(timeline: TimelineSegment[], elapsed: number): boolean {
  const pos = positionAt(timeline, elapsed);
  if (pos.done) return true;
  return pos.index === timeline.length - 1 && timeline[pos.index].kind === 'cooldown';
}

/** The UI's twin of `endsInFinalCooldown` over a snapshot — the run screen's End dialog copy. */
export function endCountsAsCompleted(snapshot: RunSnapshot): boolean {
  return (
    snapshot.mode === 'scripted' &&
    snapshot.segmentKind === 'cooldown' &&
    snapshot.nextSegment === null
  );
}

/**
 * Whether the log has already run past its timeline at `now`.
 * why: wall-clock time that passed while the app was dead is not evidence the session was run, so
 * such a log must be finalized as `partial`, never resumed into a completion (ADR 0007).
 */
export function isTimelineExhausted(
  session: PlanSession,
  events: readonly RunEvent[],
  now: number,
): boolean {
  if (events.length === 0) return false;
  const elapsed = activeElapsedMs(events, now) / 1000;
  return positionAt(timelineOf(session, events), elapsed).done;
}

/** A run's position: done (and why), or inside the segment whose `seq` new points are tagged with. */
export type ModePosition =
  { done: true; origin: 'runner' | 'limit' } | { done: false; segmentSeq: number };

/**
 * The plan-dependent half of a `RunSnapshot`, the active seconds it was derived at, and the segment
 * a barometer sample taken now belongs to.
 */
export type ModeView = (
  | Pick<
      ScriptedRunSnapshot,
      | 'mode'
      | 'activeElapsedSeconds'
      | 'totalSeconds'
      | 'segmentIndex'
      | 'segmentKind'
      | 'segmentSecondsRemaining'
      | 'segmentSecondsTotal'
      | 'segmentEndsAt'
      | 'nextSegment'
    >
  | Pick<
      OpenRunSnapshot,
      'mode' | 'activeElapsedSeconds' | 'motion' | 'rollingPaceSecPerKm' | 'hasFix'
    >
) & { sampleSegmentSeq: number };

/** Snapshot fields a fix changes between refreshes; a scripted run has none. */
export type ModeLive = Partial<Pick<OpenRunSnapshot, 'motion' | 'rollingPaceSecPerKm' | 'hasFix'>>;

/** How a run is being finalized: by the runner, by a limit, or silently from a stale log at launch. */
export type FinalizeOrigin = 'runner' | 'limit' | 'abandon';

/** What the runner asked for; only a mode that `canDiscard` honours a discard. */
export type FinalizeIntent = 'save' | 'discard';

export interface FinalizeRequest {
  /** The log before its `end` event. */
  events: readonly RunEvent[];
  /** Where the engine would put `end`; the mode may move it (a free run's cap). */
  endAt: number;
  requested: 'completed' | 'endedEarly';
  origin: FinalizeOrigin;
  intent: FinalizeIntent;
}

export type ModeFinal =
  | { outcome: 'discard' }
  | {
      outcome: 'save';
      kind: 'completed' | 'endedEarly';
      endAt: number;
      elapsedS: number;
      segments: CompletedSegmentRecord[];
      /** A free run's buckets are derived from its points at finalize (ADR 0026 §4). */
      derived?: { thresholdMps: number };
    };

/** What a mode persists in the snapshot state, and is rebuilt from on resume. */
export interface ModeStateFields {
  lastAnnouncedIndex: number;
  halfwayFired: boolean;
  /** Owned by the mode: persisted as given, parsed only by the mode that wrote it. */
  modeState?: unknown;
}

export interface ModeDeps {
  /** A free run's starting threshold; asked only when no saved one survives (ADR 0026 §3). */
  thresholdMps: () => number;
}

/**
 * The plan-relative rules of a run, per ADR 0026 §1. Every method takes the engine's one append-only
 * event log — implementations may cache on that (`ScriptedMode` does), so never pass another log.
 */
export interface RunMode {
  readonly kind: RunSnapshot['mode'];
  readonly key: string;
  /** A field-test capture must not coach (spec §8.0). */
  readonly cuesSuppressed: boolean;
  readonly canSkip: boolean;
  readonly canDiscard: boolean;
  position(events: readonly RunEvent[], activeS: number, now: number): ModePosition;
  view(events: readonly RunEvent[], activeS: number, now: number): ModeView;
  live(): ModeLive;
  /** Folds one accepted fix into the mode's own track (ADR 0021 §3); returns the metres it committed. */
  ingest(fix: LocationFix, events: readonly RunEvent[]): number;
  /** Cues due at a running refresh; advances the mode's cue state. */
  takeCues(events: readonly RunEvent[], elapsedS: number): CueId[];
  exhausted(events: readonly RunEvent[], now: number): boolean;
  /** How long after its last flush an interrupted run is still offered for resume. */
  resumeWindowMs(): number;
  finalize(request: FinalizeRequest): ModeFinal;
  stateFields(): ModeStateFields;
  /** Logged once when a new run starts (spec §6). */
  startNote(): { kind: RunLogKind; detail: unknown } | null;
}

/** The one place a run's mode is made — a new run with no `saved`, or a resume or abandon from it. */
export function modeFor(plan: RunPlan, deps: ModeDeps, saved?: ModeStateFields): RunMode {
  return plan.mode === 'scripted'
    ? new ScriptedMode(plan.session, saved)
    : new OpenMode(OpenMode.savedThreshold(saved?.modeState) ?? deps.thresholdMps());
}

/** A plan session's run: the scripted timeline (ADR 0007). */
export class ScriptedMode implements RunMode {
  readonly kind = 'scripted';
  readonly key: string;
  readonly cuesSuppressed: boolean;
  readonly canSkip = true;
  readonly canDiscard = false;
  private smoother: SmootherState = createSmootherState();
  private readonly session: PlanSession;
  private readonly plannedTotalS: number;
  /** The final run is announced as "last run", not a generic "start running". */
  private readonly lastRunIndex: number;
  private lastAnnouncedIndex: number;
  private halfwayFired: boolean;
  /** The timeline only changes on a skip — cached per skip count, not rebuilt per heartbeat. */
  private cached: { skips: number; timeline: TimelineSegment[] } | null = null;

  constructor(
    session: PlanSession,
    cueState: ModeStateFields = { lastAnnouncedIndex: -1, halfwayFired: false },
  ) {
    this.session = session;
    this.key = session.key;
    this.cuesSuppressed = isFieldTestRun(session.key);
    this.plannedTotalS = sessionTotalSeconds(session);
    this.lastRunIndex = session.segments.findLastIndex((s) => s.kind === 'run');
    this.lastAnnouncedIndex = cueState.lastAnnouncedIndex;
    this.halfwayFired = cueState.halfwayFired;
  }

  private timeline(events: readonly RunEvent[]): TimelineSegment[] {
    const skips = events.filter((event) => event.type === 'skip').length;
    if (this.cached?.skips !== skips) {
      this.cached = { skips, timeline: timelineOf(this.session, events) };
    }
    return this.cached.timeline;
  }

  position(events: readonly RunEvent[], activeS: number): ModePosition {
    const pos = positionAt(this.timeline(events), activeS);
    return pos.done ? { done: true, origin: 'runner' } : { done: false, segmentSeq: pos.index };
  }

  view(events: readonly RunEvent[], activeS: number, now: number): ModeView {
    const timeline = this.timeline(events);
    const total = totalSeconds(timeline);
    const elapsed = Math.min(activeS, total);
    const pos = positionAt(timeline, elapsed);
    const base = { mode: 'scripted' as const, activeElapsedSeconds: elapsed, totalSeconds: total };
    if (pos.done) {
      return {
        ...base,
        sampleSegmentSeq: timeline.length - 1,
        segmentIndex: timeline.length - 1,
        segmentKind: timeline[timeline.length - 1]?.kind ?? null,
        segmentSecondsRemaining: 0,
        segmentSecondsTotal: timeline[timeline.length - 1]?.effectiveSeconds ?? 0,
        segmentEndsAt: null,
        nextSegment: null,
      };
    }
    const segment = timeline[pos.index];
    const next = timeline[pos.index + 1];
    return {
      ...base,
      sampleSegmentSeq: pos.index,
      segmentIndex: pos.index,
      segmentKind: segment.kind,
      segmentSecondsRemaining: pos.secondsRemaining,
      segmentSecondsTotal: segment.effectiveSeconds,
      segmentEndsAt: now + pos.secondsRemaining * 1000,
      nextSegment: next ? { kind: next.kind, seconds: next.effectiveSeconds } : null,
    };
  }

  /** The transition cue on a derived-segment change, and the halfway milestone once (ADR 0007 §4). */
  takeCues(events: readonly RunEvent[], elapsedS: number): CueId[] {
    const timeline = this.timeline(events);
    const pos = positionAt(timeline, elapsedS);
    if (pos.done) return [];
    const kind: SegmentKind = timeline[pos.index].kind;
    const cues: CueId[] = [];
    if (pos.index !== this.lastAnnouncedIndex) {
      this.lastAnnouncedIndex = pos.index;
      cues.push(pos.index === this.lastRunIndex ? 'lastRun' : SEGMENT_ENTRY_CUE[kind]);
    }
    if (!this.halfwayFired && this.plannedTotalS > 0 && elapsedS >= this.plannedTotalS / 2) {
      this.halfwayFired = true;
      cues.push('halfway');
    }
    return cues;
  }

  exhausted(events: readonly RunEvent[], now: number): boolean {
    return isTimelineExhausted(this.session, events, now);
  }

  resumeWindowMs(): number {
    return this.plannedTotalS * 1000 + RESUME_GRACE_MS;
  }

  live(): ModeLive {
    return {};
  }

  finalize({ events, endAt, requested, origin }: FinalizeRequest): ModeFinal {
    const timeline = this.timeline(events);
    // Completion is capped at timeline exhaustion (ADR 0007).
    const elapsedS = Math.min(activeElapsedMs(events, endAt) / 1000, totalSeconds(timeline));
    // Ending early during the final cool-down — or past exhaustion, before the
    // next heartbeat notices — completes the session (issue #40). Resolved from
    // the recorded end event so the outcome stays derivable from the event log
    // alone (ADR 0007). Only the runner's own end can: an abandoned log never completes.
    const kind =
      requested === 'endedEarly' && origin === 'runner' && endsInFinalCooldown(timeline, elapsedS)
        ? 'completed'
        : requested;
    return {
      kind,
      endAt,
      elapsedS,
      outcome: 'save',
      segments: timeline
        .filter((segment) => segment.wasSkipped || segment.startsAt < elapsedS)
        .map((segment, seq) => ({
          seq,
          kind: segment.kind,
          plannedDurationS: segment.plannedSeconds,
          actualDurationS: Math.round(
            Math.min(segment.effectiveSeconds, Math.max(0, elapsedS - segment.startsAt)),
          ),
          wasSkipped: segment.wasSkipped,
        })),
    };
  }

  stateFields(): ModeStateFields {
    return { lastAnnouncedIndex: this.lastAnnouncedIndex, halfwayFired: this.halfwayFired };
  }

  startNote(): null {
    return null;
  }

  ingest(fix: LocationFix): number {
    const step = smoothFix(this.smoother, fix);
    this.smoother = step.state;
    return step.acceptedDeltaMeters;
  }
}

/** Pace is shown over the last stretch, not the whole run, so a walk break does not linger in it. */
const ROLLING_WINDOW_MS = 45_000;

/** A free run (ADR 0026): no timeline — it ends by hand, or at a limit, and is bucketed by speed. */
export class OpenMode implements RunMode {
  readonly kind = 'open';
  readonly key = FREE_RUN_KEY;
  readonly cuesSuppressed = false;
  readonly canSkip = false;
  readonly canDiscard = true;
  private readonly thresholdMps: number;
  private track: OpenTrackState = createOpenTrackState();
  private moving: { atMs: number; speedMps: number }[] = [];
  private stoppedSinceMs: number | null = null;
  private pausedCache: { count: number; paused: PausedInterval[] } | null = null;

  constructor(thresholdMps: number) {
    this.thresholdMps = thresholdMps;
  }

  /** The threshold a snapshot's `modeState` carries; undefined for anything else. */
  static savedThreshold(modeState: unknown): number | undefined {
    if (typeof modeState !== 'object' || modeState === null) return undefined;
    const { thresholdMps } = modeState as { thresholdMps?: unknown };
    return typeof thresholdMps === 'number' && Number.isFinite(thresholdMps) && thresholdMps > 0
      ? thresholdMps
      : undefined;
  }

  private paused(events: readonly RunEvent[]): PausedInterval[] {
    if (this.pausedCache?.count !== events.length) {
      this.pausedCache = { count: events.length, paused: pausedIntervals(events) };
    }
    return this.pausedCache.paused;
  }

  ingest(fix: LocationFix, events: readonly RunEvent[]): number {
    const step = openTrackStep(this.track, fix, {
      thresholdMps: this.thresholdMps,
      paused: this.paused(events),
    });
    this.track = step.state;
    for (const change of step.changes) {
      this.stoppedSinceMs = change.kind === 'stopped' ? change.atMs : null;
    }
    const lastMs = this.track.previousMs ?? fix.timestamp;
    if (step.smoothedSpeedMps !== null && this.track.motion.kind !== 'stopped') {
      this.moving.push({ atMs: lastMs, speedMps: step.smoothedSpeedMps });
    }
    this.moving = this.moving.filter((sample) => sample.atMs > lastMs - ROLLING_WINDOW_MS);
    return step.acceptedDeltaMeters;
  }

  /** Active ms spent stopped up to `now`; a GPS silence past `MAX_GAP_S` counts, as the fold's gap rule does. */
  private stoppedMs(events: readonly RunEvent[], now: number): number {
    const lastMs = this.track.previousMs;
    if (lastMs === null) return 0;
    if (this.track.motion.kind === 'stopped' && this.stoppedSinceMs !== null) {
      return activeMsBetween(events, this.stoppedSinceMs, now);
    }
    const quietMs = activeMsBetween(events, lastMs, now);
    return quietMs > MAX_GAP_S * 1000 ? quietMs : 0;
  }

  position(events: readonly RunEvent[], activeS: number, now: number): ModePosition {
    if (activeS >= OPEN_LIMITS.capActiveS) return { done: true, origin: 'limit' };
    if (this.stoppedMs(events, now) >= OPEN_LIMITS.stoppedLimitS * 1000) {
      return { done: true, origin: 'limit' };
    }
    return { done: false, segmentSeq: 0 };
  }

  private rollingPace(stale: boolean): number | null {
    if (stale || this.track.motion.kind === 'stopped' || this.moving.length === 0) return null;
    const meanMps = this.moving.reduce((sum, s) => sum + s.speedMps, 0) / this.moving.length;
    return paceSecPerKm(meanMps, 1);
  }

  live(): ModeLive {
    return {
      motion: this.track.motion.kind,
      hasFix: this.track.previousMs !== null,
      rollingPaceSecPerKm: this.rollingPace(false),
    };
  }

  view(events: readonly RunEvent[], activeS: number, now: number): ModeView {
    const lastMs = this.track.previousMs;
    const stale = lastMs === null || activeMsBetween(events, lastMs, now) > MAX_GAP_S * 1000;
    return {
      mode: 'open',
      activeElapsedSeconds: Math.min(activeS, OPEN_LIMITS.capActiveS),
      motion: this.track.motion.kind,
      hasFix: lastMs !== null,
      rollingPaceSecPerKm: this.rollingPace(stale),
      // why 0: finalize re-tags every sample with its bucket (ADR 0026 §4)
      sampleSegmentSeq: 0,
    };
  }

  takeCues(): CueId[] {
    return [];
  }

  exhausted(events: readonly RunEvent[], now: number): boolean {
    return activeElapsedMs(events, now) >= OPEN_LIMITS.capActiveS * 1000;
  }

  resumeWindowMs(): number {
    return OPEN_LIMITS.resumeWindowMs;
  }

  finalize({ events, endAt, intent }: FinalizeRequest): ModeFinal {
    if (intent === 'discard') return { outcome: 'discard' };
    const pastCap = activeElapsedMs(events, endAt) > OPEN_LIMITS.capActiveS * 1000;
    const end = pastCap ? (wallClockAtActive(events, OPEN_LIMITS.capActiveS) ?? endAt) : endAt;
    const elapsedS = Math.min(activeElapsedMs(events, end) / 1000, OPEN_LIMITS.capActiveS);
    // why the minimum here too, beside deriveOpenRun's: a run that short is deleted without the
    // finalize work. The derivation still decides after trimming a trailing stop.
    if (elapsedS < OPEN_LIMITS.minActiveS) return { outcome: 'discard' };
    return {
      outcome: 'save',
      kind: 'completed',
      endAt: end,
      elapsedS,
      segments: [],
      derived: { thresholdMps: this.thresholdMps },
    };
  }

  stateFields(): ModeStateFields {
    return {
      lastAnnouncedIndex: -1,
      halfwayFired: false,
      modeState: { thresholdMps: this.thresholdMps },
    };
  }

  startNote() {
    return { kind: 'motion_threshold' as const, detail: { thresholdMps: this.thresholdMps } };
  }
}
