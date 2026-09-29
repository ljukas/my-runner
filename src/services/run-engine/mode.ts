import { SEGMENT_ENTRY_CUE, type CueId } from '@/domain/cues';
import { sessionTotalSeconds, type PlanSession, type SegmentKind } from '@/domain/plan';
import { buildTimeline, positionAt, totalSeconds, type TimelineSegment } from '@/domain/segments';
import { activeElapsedMs } from '@/domain/active-time';
import type { CompletedSegmentRecord, RunEvent, RunSnapshot } from './types';

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
  return snapshot.segmentKind === 'cooldown' && snapshot.nextSegment === null;
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

/** A run's position: done, or inside the segment whose `seq` new points are tagged with. */
export type ModePosition = { done: true } | { done: false; segmentSeq: number };

/** The plan-dependent half of a `RunSnapshot`, and the active seconds it was derived at. */
export type ModeView = Pick<
  RunSnapshot,
  | 'activeElapsedSeconds'
  | 'totalSeconds'
  | 'segmentIndex'
  | 'segmentKind'
  | 'segmentSecondsRemaining'
  | 'segmentSecondsTotal'
  | 'segmentEndsAt'
  | 'nextSegment'
>;

/** How a run is being finalized: by the runner, or silently from a stale log at launch. */
export type FinalizeOrigin = 'runner' | 'abandon';

export interface ModeFinal {
  kind: 'completed' | 'endedEarly';
  elapsedS: number;
  segments: CompletedSegmentRecord[];
}

/** Cue bookkeeping a crash-resume must carry across processes (persisted in the snapshot state). */
export interface ModeCueState {
  lastAnnouncedIndex: number;
  halfwayFired: boolean;
}

/**
 * The plan-relative rules of a run, per ADR 0026 §1. Every method takes the engine's one append-only
 * event log — implementations may cache on that (`ScriptedMode` does), so never pass another log.
 */
export interface RunMode {
  readonly kind: 'scripted';
  readonly key: string;
  position(events: readonly RunEvent[], activeS: number): ModePosition;
  view(events: readonly RunEvent[], activeS: number, now: number): ModeView;
  /** Cues due at a running refresh; advances the mode's cue state. */
  takeCues(events: readonly RunEvent[], elapsedS: number): CueId[];
  exhausted(events: readonly RunEvent[], now: number): boolean;
  finalize(
    events: readonly RunEvent[],
    endAt: number,
    requested: 'completed' | 'endedEarly',
    origin: FinalizeOrigin,
  ): ModeFinal;
  cueState(): ModeCueState;
}

/** A plan session's run: the scripted timeline (ADR 0007). */
export class ScriptedMode implements RunMode {
  readonly kind = 'scripted';
  readonly key: string;
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
    cueState: ModeCueState = { lastAnnouncedIndex: -1, halfwayFired: false },
  ) {
    this.session = session;
    this.key = session.key;
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
    return pos.done ? { done: true } : { done: false, segmentSeq: pos.index };
  }

  view(events: readonly RunEvent[], activeS: number, now: number): ModeView {
    const timeline = this.timeline(events);
    const total = totalSeconds(timeline);
    const elapsed = Math.min(activeS, total);
    const pos = positionAt(timeline, elapsed);
    const base = { activeElapsedSeconds: elapsed, totalSeconds: total };
    if (pos.done) {
      return {
        ...base,
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

  finalize(
    events: readonly RunEvent[],
    endAt: number,
    requested: 'completed' | 'endedEarly',
    origin: FinalizeOrigin,
  ): ModeFinal {
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
      elapsedS,
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

  cueState(): ModeCueState {
    return { lastAnnouncedIndex: this.lastAnnouncedIndex, halfwayFired: this.halfwayFired };
  }
}
