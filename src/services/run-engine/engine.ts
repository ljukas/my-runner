import { SEGMENT_ENTRY_CUE } from '@/domain/cues';
import {
  accuracyFilter,
  createSmootherState,
  smoothFix,
  type LocationFix,
  type SmootherState,
} from '@/domain/geo';
import { sessionTotalSeconds, type PlanSession, type SegmentKind } from '@/domain/plan';
import { paceSecPerKm } from '@/domain/run-stats';
import { buildTimeline, positionAt, totalSeconds, type TimelineSegment } from '@/domain/segments';
import type { CueService } from '@/services/cue-service/port';
import type {
  BufferedRunPoint,
  Clock,
  CompletedRunRecord,
  EngineStatus,
  RunEvent,
  RunPersistence,
  RunSnapshot,
} from './types';

const IDLE_SNAPSHOT: RunSnapshot = {
  status: 'idle',
  sessionKey: null,
  segmentIndex: -1,
  segmentKind: null,
  segmentSecondsRemaining: 0,
  segmentSecondsTotal: 0,
  segmentEndsAt: null,
  nextSegment: null,
  activeElapsedSeconds: 0,
  totalSeconds: 0,
  distanceM: 0,
  paceSecPerKm: null,
  savedRunId: null,
  saveFailed: false,
};

/**
 * Active time is derived from the timestamped event log, never accumulated
 * (ADR 0007). If currently paused, elapsed is frozen at the pause timestamp.
 */
function activeElapsedMs(events: RunEvent[], now: number): number {
  if (events.length === 0) return 0;
  const startAt = events[0].at;
  let pausedTotal = 0;
  let pausedAt: number | null = null;
  for (const event of events) {
    if (event.type === 'pause' && pausedAt === null) pausedAt = event.at;
    if (event.type === 'resume' && pausedAt !== null) {
      pausedTotal += event.at - pausedAt;
      pausedAt = null;
    }
  }
  const end = pausedAt ?? Math.max(now, events[events.length - 1].at);
  return Math.max(0, end - startAt - pausedTotal);
}

/**
 * Whether ending at `elapsed` counts as completing the session (issue #40):
 * inside the final segment when it is a cool-down, or past timeline
 * exhaustion. Every work segment is behind the runner, so the cool-down acts
 * as a flex period for ending early — consistent with skipSegment(), which
 * already completes when the final segment is skipped.
 */
function endsInFinalCooldown(timeline: TimelineSegment[], elapsed: number): boolean {
  const pos = positionAt(timeline, elapsed);
  if (pos.done) return true;
  return pos.index === timeline.length - 1 && timeline[pos.index].kind === 'cooldown';
}

/**
 * Snapshot twin of `endsInFinalCooldown` for the UI — the run screen's End
 * dialog derives its copy from this. Keep the two rules in sync.
 */
export function endCountsAsCompleted(snapshot: RunSnapshot): boolean {
  return snapshot.segmentKind === 'cooldown' && snapshot.nextSegment === null;
}

export class RunEngine {
  private readonly clock: Clock;
  private readonly persistence: RunPersistence;
  private readonly cue: CueService;

  private session: PlanSession | null = null;
  private events: RunEvent[] = [];
  private status: EngineStatus = 'idle';
  private savedRunId: string | null = null;
  private saveFailed = false;
  /** Bumped by start()/reset() so a slow save from a superseded run can never stamp a later one. */
  private runGeneration = 0;
  private snapshot: RunSnapshot = IDLE_SNAPSHOT;
  /** The timeline only changes on start/reset/skip, not per heartbeat — cache it between those. */
  private cachedTimeline: TimelineSegment[] | null = null;
  private readonly listeners = new Set<() => void>();

  // Cue firing (ADR 0007 §4 / ADR 0009): a transition cue fires only when the
  // derived segment changes; milestones fire once each. All are computed at
  // start() and reset on start()/reset().
  private lastAnnouncedIndex = -1;
  private halfwayFired = false;
  private plannedTotalS = 0;
  private lastRunIndex = -1;

  // GPS ingest state (ADR 0021 §3): folded live so the snapshot distance equals the finalize re-fold; cleared per run.
  private smootherState: SmootherState = createSmootherState();
  private distanceM = 0;
  private pendingPoints: BufferedRunPoint[] = [];
  private nextSeq = 0;

  constructor(deps: { persistence: RunPersistence; cue: CueService; clock?: Clock }) {
    this.persistence = deps.persistence;
    this.cue = deps.cue;
    this.clock = deps.clock ?? Date.now;
  }

  start(session: PlanSession): void {
    if (this.status !== 'idle') return;
    this.session = session;
    this.events = [{ type: 'start', at: this.clock() }];
    this.cachedTimeline = null;
    this.status = 'running';
    this.savedRunId = null;
    this.saveFailed = false;
    this.runGeneration += 1;
    this.lastAnnouncedIndex = -1;
    this.halfwayFired = false;
    this.plannedTotalS = sessionTotalSeconds(session);
    // The final run is announced as "last run", not a generic "start running".
    this.lastRunIndex = session.segments.findLastIndex((s) => s.kind === 'run');
    this.resetIngestState();
    this.cue.prepare();
    this.refresh();
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.append('pause');
    this.status = 'paused';
    this.refresh();
    this.cue.announce('paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.append('resume');
    this.status = 'running';
    this.refresh();
    this.cue.announce('resumed');
  }

  skipSegment(): void {
    if (this.status !== 'running' && this.status !== 'paused') return;
    this.append('skip');
    this.heartbeat(); // completes the session if the skipped segment was the last
  }

  endEarly(): void {
    if (this.status !== 'running' && this.status !== 'paused') return;
    this.finalize('endedEarly');
  }

  heartbeat(now: number = this.clock(), fix?: LocationFix): void {
    if (this.status !== 'running' && this.status !== 'paused') return;
    const elapsed = activeElapsedMs(this.events, now) / 1000;
    const pos = positionAt(this.timeline(), elapsed);
    if (pos.done) {
      this.finalize('completed');
      return;
    }
    // Timing/cues derive first; GPS ingestion can neither stall nor throw out of them.
    this.refresh(now);
    if (this.status === 'running' && fix) this.ingestFix(fix, pos.index);
  }

  reset(): void {
    this.session = null;
    this.events = [];
    this.cachedTimeline = null;
    this.status = 'idle';
    this.savedRunId = null;
    this.saveFailed = false;
    this.runGeneration += 1;
    this.lastAnnouncedIndex = -1;
    this.halfwayFired = false;
    this.resetIngestState();
    this.snapshot = IDLE_SNAPSHOT;
    this.cue.release();
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = (): RunSnapshot => this.snapshot;

  /** Buffered accuracy-passed points for incremental `run_points` flush (ADR 0021 §3); a shallow copy so array mutation can't reach the engine's buffer. */
  getBufferedPoints = (): readonly BufferedRunPoint[] => this.pendingPoints.slice();

  // --- derivation ---

  /** Event timestamps are clamped non-decreasing so elapsed can never go negative (ADR 0007). */
  private append(type: RunEvent['type']): void {
    const last = this.events[this.events.length - 1];
    this.events.push({ type, at: Math.max(this.clock(), last?.at ?? 0) });
    if (type === 'skip') this.cachedTimeline = null;
  }

  /** Active-elapsed seconds at each skip event, measured against the events before it. */
  private skipAts(): number[] {
    return this.events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === 'skip')
      .map(({ event, index }) => activeElapsedMs(this.events.slice(0, index), event.at) / 1000);
  }

  private timeline(): TimelineSegment[] {
    this.cachedTimeline ??= buildTimeline(this.session?.segments ?? [], this.skipAts());
    return this.cachedTimeline;
  }

  private refresh(now: number = this.clock()): void {
    if (!this.session) return;
    const timeline = this.timeline();
    const total = totalSeconds(timeline);
    const elapsed = Math.min(activeElapsedMs(this.events, now) / 1000, total);
    const pos = positionAt(timeline, elapsed);

    const base = {
      status: this.status,
      sessionKey: this.session.key,
      activeElapsedSeconds: elapsed,
      totalSeconds: total,
      savedRunId: this.savedRunId,
      saveFailed: this.saveFailed,
      distanceM: this.distanceM,
      paceSecPerKm: paceSecPerKm(this.distanceM, elapsed),
    };
    if (pos.done) {
      this.snapshot = {
        ...base,
        segmentIndex: timeline.length - 1,
        segmentKind: timeline[timeline.length - 1]?.kind ?? null,
        segmentSecondsRemaining: 0,
        segmentSecondsTotal: timeline[timeline.length - 1]?.effectiveSeconds ?? 0,
        segmentEndsAt: null,
        nextSegment: null,
      };
    } else {
      const segment = timeline[pos.index];
      const next = timeline[pos.index + 1];
      this.snapshot = {
        ...base,
        segmentIndex: pos.index,
        segmentKind: segment.kind,
        segmentSecondsRemaining: pos.secondsRemaining,
        segmentSecondsTotal: segment.effectiveSeconds,
        segmentEndsAt: now + pos.secondsRemaining * 1000,
        nextSegment: next ? { kind: next.kind, seconds: next.effectiveSeconds } : null,
      };
      // Cues fire on live running refreshes only — never on pause/resume/finalize
      // (whose status is already non-running here).
      if (this.status === 'running') this.announceProgress(pos.index, segment.kind, elapsed);
    }
    this.emit();
  }

  /** Fires the transition cue on a derived-segment change and the halfway
   * milestone once (ADR 0007 §4). The final run announces `lastRun`. */
  private announceProgress(index: number, kind: SegmentKind, elapsed: number): void {
    if (index !== this.lastAnnouncedIndex) {
      this.lastAnnouncedIndex = index;
      this.cue.announce(index === this.lastRunIndex ? 'lastRun' : SEGMENT_ENTRY_CUE[kind]);
    }
    if (!this.halfwayFired && this.plannedTotalS > 0 && elapsed >= this.plannedTotalS / 2) {
      this.halfwayFired = true;
      this.cue.announce('halfway');
    }
  }

  private resetIngestState(): void {
    this.smootherState = createSmootherState();
    this.distanceM = 0;
    this.pendingPoints = [];
    this.nextSeq = 0;
  }

  // Same smoother the finalize re-fold re-runs over run_points, so live distance == re-derived (ADR 0021 §3):
  // the integer-ms timestamp survives the ISO round-trip, and the full accuracy-passed stream is buffered (no re-gate — the smoother owns velocity).
  private ingestFix(fix: LocationFix, segmentSeq: number): void {
    let buffered = false;
    try {
      if (!accuracyFilter(fix)) return;
      const timestamp = Math.round(fix.timestamp);
      const step = smoothFix(this.smootherState, { ...fix, timestamp });
      const point: BufferedRunPoint = {
        seq: this.nextSeq,
        segmentSeq,
        timestamp,
        lat: fix.lat,
        lng: fix.lng,
        altitude: fix.altitude,
        accuracy: fix.accuracy,
        speed: fix.speed,
      };
      this.smootherState = step.state;
      this.distanceM += step.acceptedDeltaMeters;
      this.pendingPoints.push(point);
      this.nextSeq += 1;
      buffered = true;
    } catch (error) {
      // Fault-isolated: timing/cues already ran this heartbeat, so a GPS/smoother throw only drops a fix.
      console.warn('[run-engine] fix ingestion failed; timing and cues unaffected', error);
    }
    if (buffered) {
      this.snapshot = {
        ...this.snapshot,
        distanceM: this.distanceM,
        paceSecPerKm: paceSecPerKm(this.distanceM, this.snapshot.activeElapsedSeconds),
      };
      this.emit();
    }
  }

  private finalize(requestedKind: 'completed' | 'endedEarly'): void {
    if (!this.session || this.events.length === 0) return;
    this.append('end');
    const endAt = this.events[this.events.length - 1].at;
    const timeline = this.timeline();
    const total = totalSeconds(timeline);
    // Completion is capped at timeline exhaustion (ADR 0007).
    const finalElapsed = Math.min(activeElapsedMs(this.events, endAt) / 1000, total);
    // Ending early during the final cool-down — or past exhaustion, before the
    // next heartbeat notices — completes the session (issue #40). Resolved from
    // the recorded end event so the outcome stays derivable from the event log
    // alone (ADR 0007).
    const kind =
      requestedKind === 'endedEarly' && endsInFinalCooldown(timeline, finalElapsed)
        ? 'completed'
        : requestedKind;

    const record: CompletedRunRecord = {
      sessionKey: this.session.key,
      status: kind === 'completed' ? 'completed' : 'partial',
      startedAt: new Date(this.events[0].at).toISOString(),
      endedAt: new Date(endAt).toISOString(),
      activeDurationS: Math.round(finalElapsed),
      segments: timeline
        .filter((segment) => segment.wasSkipped || segment.startsAt < finalElapsed)
        .map((segment, seq) => ({
          seq,
          kind: segment.kind,
          plannedDurationS: segment.plannedSeconds,
          actualDurationS: Math.round(
            Math.min(segment.effectiveSeconds, Math.max(0, finalElapsed - segment.startsAt)),
          ),
          wasSkipped: segment.wasSkipped,
        })),
    };

    this.status = kind;
    this.refresh(endAt);
    // A completed run speaks its congratulations, then self-releases the audio
    // session when that utterance finishes — calling release() here would cut it
    // off. Ending early has no cue, so tear the session down immediately.
    if (kind === 'completed') this.cue.announce('complete');
    else this.cue.release();
    const generation = this.runGeneration;
    this.persistence.saveRun(record).then(
      (id) => {
        if (generation !== this.runGeneration) return; // superseded by reset()/start()
        this.savedRunId = id;
        this.snapshot = { ...this.snapshot, savedRunId: id };
        this.emit();
      },
      () => {
        if (generation !== this.runGeneration) return; // superseded by reset()/start()
        this.saveFailed = true;
        this.snapshot = { ...this.snapshot, saveFailed: true };
        this.emit();
      },
    );
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
