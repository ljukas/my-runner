import { SEGMENT_ENTRY_CUE, type CueId } from '@/domain/cues';
import {
  accuracyFilter,
  createSmootherState,
  smoothFix,
  type LocationFix,
  type SmootherState,
} from '@/domain/geo';
import {
  sessionTotalSeconds,
  type PlannedSegment,
  type PlanSession,
  type SegmentKind,
} from '@/domain/plan';
import { paceSecPerKm } from '@/domain/run-stats';
import { buildTimeline, positionAt, totalSeconds, type TimelineSegment } from '@/domain/segments';
import type { CueService } from '@/services/cue-service/port';
import type {
  AltitudeReading,
  ElevationSource,
  MotionPermissionStatus,
} from '@/services/elevation';
import { isFieldTestRun } from '@/services/field-test';
import type { LocationTracker } from '@/services/location-tracker/port';
import type { RunPoint, RunSnapshotState, RunStore } from '@/services/run-store/port';
import {
  createPointBatchScheduler,
  POINT_FLUSH_MS,
  type PointBatchScheduler,
} from './point-batch-scheduler';
import { RunLog, type PendingEntry, type PendingSample, type RunLogKind } from './run-log';
import type {
  BufferedRunPoint,
  Clock,
  CompletedRunRecord,
  EngineStatus,
  RunEvent,
  RunLifecyclePersistence,
  RunSnapshot,
  StepCounter,
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

// why: SQLite caps a statement at 32,766 bind parameters and each point binds 8 — an unbounded
// retained backlog would grow one insert past the limit and never recover.
const MAX_FLUSH_POINTS = 500;
// Bounded so a permanently failing write cannot spin the finalize path.
const MAX_TAIL_FLUSHES = 6;
// why bounded at all: a native promise can fail to *settle*, which no try/catch covers.
// expo-sensors' PedometerModule.getPermissionsAsync returns without resolving or rejecting when its
// permissions manager is absent, and getStepCountAsync's callback may only arrive once a system
// alert is answered — which never happens on a pocketed auto-complete. Unbounded, that leaves the
// run unsaved, its row `'active'` and the run screen with no route out; on the elevation chain it
// leaves CMAltimeter sampling for the process's lifetime. 2 s is ~1000x the real latency of every
// call it guards, so expiry means "stuck", never "slow".
const NATIVE_TIMEOUT_MS = 2000;

// why rejections are not absorbed too: every caller already has a catch that decides what a
// rejection means, and only non-settlement is invisible to it.
function withTimeout<T>(promise: Promise<T>, fallback: T, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn(`[run-engine] ${label} never settled; continuing without it`);
      resolve(fallback);
    }, ms);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Active time is derived from the timestamped event log, never accumulated
 * (ADR 0007). If currently paused, elapsed is frozen at the pause timestamp.
 */
function activeElapsedMs(events: readonly RunEvent[], now: number): number {
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

/** Active-elapsed seconds at each skip event, measured against the events before it. */
function skipAtsOf(events: readonly RunEvent[]): number[] {
  return events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'skip')
    .map(({ event, index }) => activeElapsedMs(events.slice(0, index), event.at) / 1000);
}

function timelineOf(segments: PlannedSegment[], events: readonly RunEvent[]): TimelineSegment[] {
  return buildTimeline(segments, skipAtsOf(events));
}

/** Paused-ness is the last unmatched pause, not the last event: `skip` is legal while paused. */
function isPausedInLog(events: readonly RunEvent[]): boolean {
  let paused = false;
  for (const event of events) {
    if (event.type === 'pause') paused = true;
    else if (event.type === 'resume') paused = false;
  }
  return paused;
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
  return positionAt(timelineOf(session.segments, events), elapsed).done;
}

export interface RunRestoreInput {
  runId: string;
  session: PlanSession;
  state: RunSnapshotState;
  /** The run's persisted `run_points`, in `seq` order. */
  points: readonly BufferedRunPoint[];
  /**
   * This run's already-stored instrumentation watermarks (spec §5.1). `epochBase` is always used;
   * the two `next*` counters only stand in for a snapshot written before `logSeq` existed, and
   * omitting them restarts this run's log at zero.
   */
  logResume?: { nextSampleSeq: number; nextEntrySeq: number; epochBase: number };
}

export interface RunAbandonInput extends Omit<RunRestoreInput, 'points'> {
  /** Epoch ms the record ends at — the run's last known-alive instant (`snapshotAliveUntil`). */
  aliveUntil: number;
}

function toRunPoint(point: BufferedRunPoint): RunPoint {
  return { ...point, timestamp: new Date(point.timestamp).toISOString() };
}

function toFix(point: BufferedRunPoint): LocationFix {
  return {
    timestamp: point.timestamp,
    lat: point.lat,
    lng: point.lng,
    altitude: point.altitude,
    accuracy: point.accuracy,
    altitudeAccuracy: point.altitudeAccuracy,
    speed: point.speed,
  };
}

export class RunEngine {
  private readonly clock: Clock;
  private readonly persistence: RunLifecyclePersistence;
  private readonly cue: CueService;
  private readonly runStore: RunStore;
  private readonly tracker: LocationTracker;
  private readonly elevation: ElevationSource;
  private readonly stepCounter: StepCounter;
  private readonly nativeTimeoutMs: number;
  private readonly scheduler: PointBatchScheduler;

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
  private lastAcceptedFix: LocationFix | null = null;

  // Field-log capture (spec §6). Instrumentation only — nothing here may influence the run.
  private log = new RunLog();
  /** Offsets the adapter's per-process epoch past what this run already stored (spec §4.2). */
  private elevationEpochBase = 0;
  /** A field-test capture must not coach (spec §8.0); set from the session key in start()/rebuild(). */
  private cuesSuppressed = false;

  // `run_points` FK-references the `'active'` row, so nothing can be written before startRun resolves.
  private runId: string | null = null;
  private startRunPromise: Promise<string | null> | null = null;
  // why: flushes are chained, never overlapped — the pre-finalize flush must queue behind an
  // in-flight cadence flush instead of being dropped, or the run's tail is lost.
  private flushChain: Promise<boolean> = Promise.resolve(true);
  // why: reset() + start() fire back-to-back (session screen); unordered, the old stop() can land
  // after the new start() and leave tracking off for the whole run.
  private trackerOps: Promise<unknown> = Promise.resolve();
  // Same hazard as trackerOps, one sensor over: an unordered stop() landing after a start() would
  // leave the barometer running with the app backgrounded.
  private elevationOps: Promise<unknown> = Promise.resolve();

  constructor(deps: {
    persistence: RunLifecyclePersistence;
    cue: CueService;
    runStore: RunStore;
    tracker: LocationTracker;
    elevation: ElevationSource;
    stepCounter: StepCounter;
    clock?: Clock;
    createScheduler?: (flush: () => void) => PointBatchScheduler;
    // A test seam like createScheduler: the suite cannot afford real multi-second waits to prove
    // these bounds, and there is nothing else in the engine to fake a native stall with.
    nativeTimeoutMs?: number;
  }) {
    this.persistence = deps.persistence;
    this.cue = deps.cue;
    this.runStore = deps.runStore;
    this.tracker = deps.tracker;
    this.elevation = deps.elevation;
    this.stepCounter = deps.stepCounter;
    this.nativeTimeoutMs = deps.nativeTimeoutMs ?? NATIVE_TIMEOUT_MS;
    this.clock = deps.clock ?? Date.now;
    const createScheduler =
      deps.createScheduler ??
      ((flush) => createPointBatchScheduler({ flushMs: POINT_FLUSH_MS, flush }));
    this.scheduler = createScheduler(() => void this.queueFlush());
    try {
      // Subscribed for the engine's lifetime: the port's fan-out is JS-side, so staying registered
      // costs nothing when no run is live and cannot stop the native altimeter (ADR 0015).
      this.elevation.onReading(this.captureReading);
    } catch (error) {
      console.warn('[run-engine] altitude subscription failed; the run is unaffected', error);
    }
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
    this.cuesSuppressed = isFieldTestRun(session.key);
    this.elevationEpochBase = 0;
    this.resetIngestState();
    this.openRunRow(session.key, this.events[0].at);
    this.cue.prepare();
    this.queueTracker(() => this.tracker.start(), 'start');
    this.queueElevation(() => this.elevation.start(), 'start');
    this.refresh();
    this.armFlush();
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.append('pause');
    this.status = 'paused';
    this.refresh();
    this.armFlush();
    this.announce('paused');
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.append('resume');
    this.status = 'running';
    this.refresh();
    this.armFlush();
    this.announce('resumed');
  }

  skipSegment(): void {
    if (this.status !== 'running' && this.status !== 'paused') return;
    this.append('skip');
    this.heartbeat(); // completes the session if the skipped segment was the last
  }

  endEarly(): void {
    if (this.status !== 'running' && this.status !== 'paused') return;
    void this.finalize('endedEarly');
  }

  heartbeat(now: number = this.clock(), fix?: LocationFix): void {
    if (this.status !== 'running' && this.status !== 'paused') return;
    const elapsed = activeElapsedMs(this.events, now) / 1000;
    const pos = positionAt(this.timeline(), elapsed);
    if (pos.done) {
      void this.finalize('completed');
      return;
    }
    // Timing/cues derive first; GPS ingestion can neither stall nor throw out of them.
    this.refresh(now);
    if (this.status === 'running' && fix) this.ingestFix(fix, pos.index);
    this.armFlush();
  }

  /**
   * Rebuild an interrupted run in place (crash recovery), continuing its existing `'active'` row.
   * False — leaving the engine untouched — when a run is already live, when the log cannot be
   * replayed, or when its timeline already expired (`abandon` is that run's only outcome).
   */
  restore(input: RunRestoreInput): boolean {
    if (this.status !== 'idle') return false;
    if (isTimelineExhausted(input.session, input.state.events, this.clock())) return false;
    if (!this.rebuild(input)) return false;
    this.cue.prepare();
    this.queueTracker(() => this.tracker.start(), 'start');
    this.queueElevation(() => this.elevation.start(), 'start');
    this.refresh();
    this.armFlush();
    // why here and not on the resume screen that offers this: announcing through the engine is what
    // puts it behind `cuesSuppressed`, so a capture stays silent by construction (spec §8.0). Last,
    // so it still follows any segment cue `refresh()` just fired — the screen's order.
    this.announce('resuming');
    return true;
  }

  /**
   * Finalize an unresumable in-flight run as `partial` from its log, then return to idle. Never
   * `completed`, even from the final cool-down: only the runner's own end event can complete a run.
   * The record ends at `aliveUntil`, not at now: the process was dead after it, so the wall clock in
   * between belongs to no one — crediting it would bill the run for time nothing was tracked.
   */
  async abandon(input: RunAbandonInput): Promise<void> {
    if (this.status !== 'idle') return;
    if (!this.rebuild({ ...input, points: [] })) return;
    await this.finalize('endedEarly', false, input.aliveUntil);
    this.reset();
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
    this.runId = null;
    this.startRunPromise = null;
    this.scheduler.stop();
    this.resetIngestState();
    this.snapshot = IDLE_SNAPSHOT;
    this.cue.release();
    this.queueTracker(() => this.tracker.stop(), 'stop');
    // why here too: a path to idle that skips finalize would otherwise leave CMAltimeter running
    // with the app backgrounded, and desync the adapter's idempotence flag from native state.
    this.queueElevation(() => this.elevation.stop(), 'stop');
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = (): RunSnapshot => this.snapshot;

  /** Buffered accuracy-passed points awaiting their `run_points` flush (ADR 0021 §3); a shallow copy so array mutation can't reach the engine's buffer. */
  getBufferedPoints = (): readonly BufferedRunPoint[] => this.pendingPoints.slice();

  /**
   * Records one field-log entry (spec §6). Public because the composition root owns the signals the
   * engine cannot see — delivered fix batches, app lifecycle, battery, the sensor's own state.
   * Never throws: instrumentation may not influence a run (spec §6.2).
   */
  note(kind: RunLogKind, detail: unknown): void {
    try {
      this.log.note(kind, detail);
    } catch (error) {
      console.warn('[run-engine] log entry dropped; the run is unaffected', error);
    }
  }

  // --- derivation ---

  /** Event timestamps are clamped non-decreasing so elapsed can never go negative (ADR 0007). */
  private append(type: RunEvent['type'], at?: number): void {
    const last = this.events[this.events.length - 1];
    this.events.push({ type, at: Math.max(at ?? this.clock(), last?.at ?? 0) });
    if (type === 'skip') this.cachedTimeline = null;
  }

  private timeline(): TimelineSegment[] {
    this.cachedTimeline ??= timelineOf(this.session?.segments ?? [], this.events);
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
      this.announce(index === this.lastRunIndex ? 'lastRun' : SEGMENT_ENTRY_CUE[kind]);
    }
    if (!this.halfwayFired && this.plannedTotalS > 0 && elapsed >= this.plannedTotalS / 2) {
      this.halfwayFired = true;
      this.announce('halfway');
    }
  }

  // why a seam: one flag can silence a whole run, and the log records what it would have said
  // either way (spec §6, §8.0).
  private announce(cue: CueId): void {
    this.note('cue', { cue, suppressed: this.cuesSuppressed });
    if (this.cuesSuppressed) return;
    this.cue.announce(cue);
  }

  private resetIngestState(): void {
    this.smootherState = createSmootherState();
    this.distanceM = 0;
    this.pendingPoints = [];
    this.nextSeq = 0;
    this.lastAcceptedFix = null;
    // The log's `seq` space is per run, and its rows FK-reference one run's row.
    this.log.reset();
  }

  private captureReading = (reading: AltitudeReading): void => {
    try {
      this.log.sample(reading, this.snapshot.segmentIndex, this.elevationEpochBase);
    } catch (error) {
      console.warn('[run-engine] altitude sample dropped; the run is unaffected', error);
    }
  };

  // why Date, not the record's own ISO strings: getStepCountAsync throws on a string argument
  // (no .getTime), and the injected stepCounter's own signature takes Date so that mistake can't
  // happen at this call site either.
  private async capturePedometerSteps(startedAt: number, endedAt: number): Promise<void> {
    try {
      const steps = await withTimeout<number | null | undefined>(
        this.stepCounter(new Date(startedAt), new Date(endedAt)),
        undefined,
        this.nativeTimeoutMs,
        'step count read',
      );
      // A stall and a genuine null are different findings in the field, so they get different rows.
      this.note('pedometer', steps === undefined ? { steps: null, timedOut: true } : { steps });
    } catch (error) {
      console.warn('[run-engine] step count unavailable; the run is unaffected', error);
    }
  }

  // why the port and not the last `sensor` note: that note is buffered instrumentation the flush
  // cadence may already have taken and sent, so it is not reliably still readable here; the port
  // this run already holds gives the same answer without depending on flush timing.
  private async readMotionPermission(): Promise<MotionPermissionStatus | undefined> {
    try {
      return await withTimeout<MotionPermissionStatus | undefined>(
        this.elevation.getPermissionStatus(),
        undefined,
        this.nativeTimeoutMs,
        'motion permission read',
      );
    } catch (error) {
      console.warn('[run-engine] motion permission unavailable; the run is unaffected', error);
      return undefined;
    }
  }

  // Same smoother the finalize re-fold re-runs over run_points, so live distance == re-derived (ADR 0021 §3):
  // the integer-ms timestamp survives the ISO round-trip, and the full accuracy-passed stream is buffered (no re-gate — the smoother owns velocity).
  private ingestFix(fix: LocationFix, segmentSeq: number): void {
    let buffered = false;
    try {
      if (!accuracyFilter(fix)) {
        // why only here: `smoothFix`'s velocity gate returns no smoothed point but still persists the
        // fix, so the accuracy filter is the only true rejection (spec §6.1).
        this.note('fix_rejected', {
          at: fix.timestamp,
          accuracy: fix.accuracy,
          altitudeAccuracy: fix.altitudeAccuracy ?? null,
        });
        return;
      }
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
        altitudeAccuracy: fix.altitudeAccuracy ?? null,
        speed: fix.speed,
      };
      this.smootherState = step.state;
      this.distanceM += step.acceptedDeltaMeters;
      this.pendingPoints.push(point);
      if (step.acceptedDeltaMeters > 0) this.lastAcceptedFix = toFix(point);
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

  /** Replays the log and re-folds the persisted points into live state; false when the log is unusable. */
  private rebuild(input: RunRestoreInput): boolean {
    const { runId, session, state, points, logResume } = input;
    if (state.events.length === 0 || state.events[0].type !== 'start') return false;
    if (state.sessionKey !== session.key) return false;

    this.session = session;
    this.events = state.events.map((event) => ({ ...event }));
    this.cachedTimeline = null;
    this.status = isPausedInLog(state.events) ? 'paused' : 'running';
    this.savedRunId = null;
    this.saveFailed = false;
    this.runGeneration += 1;
    this.lastAnnouncedIndex = state.lastAnnouncedIndex;
    this.halfwayFired = state.halfwayFired;
    this.plannedTotalS = sessionTotalSeconds(session);
    this.lastRunIndex = session.segments.findLastIndex((s) => s.kind === 'run');
    this.cuesSuppressed = isFieldTestRun(session.key);
    this.elevationEpochBase = logResume?.epochBase ?? 0;
    this.resetIngestState();
    // why the snapshot wins: it counts the rows this run minted, including any lost with the
    // unflushed tail, so continuing from it leaves the drop as a `seq` gap instead of a duplicate.
    this.log.restoreFrom(
      state.logSeq ?? {
        sampleSeq: logResume?.nextSampleSeq ?? 0,
        entrySeq: logResume?.nextEntrySeq ?? 0,
      },
    );
    // The `'active'` row already exists — recovery must never open a second one.
    this.runId = runId;
    this.startRunPromise = Promise.resolve(runId);

    // why: re-folding exactly the persisted spine — not the unflushed tail, not the snapshot anchor
    // on its own — is what keeps resumed distance equal to the live and finalize values (ADR 0021 §3).
    for (const point of points) {
      const step = smoothFix(this.smootherState, toFix(point));
      this.smootherState = step.state;
      this.distanceM += step.acceptedDeltaMeters;
      if (step.acceptedDeltaMeters > 0) this.lastAcceptedFix = toFix(point);
      if (point.seq >= this.nextSeq) this.nextSeq = point.seq + 1;
    }
    return true;
  }

  private async finalize(
    requestedKind: 'completed' | 'endedEarly',
    promoteInCooldown = true,
    at?: number,
  ): Promise<void> {
    if (!this.session || this.events.length === 0) return;
    this.append('end', at);
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
      requestedKind === 'endedEarly' &&
      promoteInCooldown &&
      endsInFinalCooldown(timeline, finalElapsed)
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
      // active_run_snapshot (the only other home for this) is cleared once finalize succeeds, and
      // snapshotState strips `end` — so this is the run's last chance to keep it (spec §5.2).
      eventLogJson: JSON.stringify(this.events),
    };

    this.status = kind;
    this.refresh(endAt);
    // A completed run speaks its congratulations, then self-releases the audio
    // session when that utterance finishes — calling release() here would cut it
    // off. Ending early has no cue, so tear the session down immediately.
    if (kind === 'completed') this.announce('complete');
    else this.cue.release();
    this.scheduler.stop();
    // why above tracker.stop(): after that stop the process can be suspended mid-write (ADR 0008).
    // Both reads are bounded, so holding the keepalive for them costs at most NATIVE_TIMEOUT_MS.
    await this.capturePedometerSteps(this.events[0].at, endAt);
    record.motionPermission = await this.readMotionPermission();
    this.queueTracker(() => this.tracker.stop(), 'stop');
    this.queueElevation(() => this.elevation.stop(), 'stop');
    await this.completeRun(record, this.runGeneration);
  }

  // --- persistence ---

  private openRunRow(sessionKey: string, startedAt: number): void {
    const generation = this.runGeneration;
    this.runId = null;
    this.startRunPromise = this.persistence
      .startRun(sessionKey, new Date(startedAt).toISOString())
      .then(
        (id) => {
          if (generation !== this.runGeneration) return null; // superseded by reset()/start()
          this.runId = id;
          // why: stamp this run's own snapshot at once — until it lands, a launch-time resume can
          // still find the previous attempt's snapshot beside this row.
          void this.queueFlush();
          return id;
        },
        (error) => {
          console.warn('[run-engine] startRun failed; retrying at the next flush cadence', error);
          return null;
        },
      );
  }

  private async awaitRunId(): Promise<string | null> {
    if (this.runId !== null) return this.runId;
    const pending = this.startRunPromise;
    if (pending !== null) {
      const id = await pending;
      if (id !== null) return id;
      if (this.startRunPromise !== pending) return this.runId; // another attempt already replaced it
    }
    // why: one retry per cadence — otherwise a single transient failure at start() costs the whole run's track.
    if (this.session === null || (this.status !== 'running' && this.status !== 'paused'))
      return null;
    this.openRunRow(this.session.key, this.events[0].at);
    return await this.startRunPromise;
  }

  private armFlush(): void {
    if (this.status === 'running' || this.status === 'paused') this.scheduler.arm();
  }

  private queueFlush(): Promise<boolean> {
    this.flushChain = this.flushChain.then(() => this.flushOnce());
    return this.flushChain;
  }

  /** Never rejects — a poisoned chain would kill every later flush, including finalize's. False when points are still buffered. */
  private async flushOnce(): Promise<boolean> {
    const generation = this.runGeneration;
    let batch: BufferedRunPoint[] = [];
    let samples: PendingSample[] = [];
    let entries: PendingEntry[] = [];
    try {
      // The aliveness heartbeat (spec §6.1): noted before the batch is claimed, so this attempt's
      // own tick rides it and a stalled flush cannot silently stop the trace.
      this.note('tick', null);
      const runId = await this.awaitRunId();
      const session = this.session;
      if (runId === null || session === null) return false;
      if (generation !== this.runGeneration) return true; // superseded: this run has nothing left to persist
      // why: the buffer is claimed only after the runId await resolves, so fixes arriving during it
      // are not handed to the DB under a stale runId.
      batch = this.pendingPoints.slice(0, MAX_FLUSH_POINTS);
      this.pendingPoints = this.pendingPoints.slice(batch.length);
      samples = this.log.takeSamples();
      entries = this.log.takeEntries();
      await this.runStore.flush(
        runId,
        batch.map(toRunPoint),
        samples,
        entries,
        this.snapshotState(session),
      );
      return true;
    } catch (error) {
      // The retained batch keeps its `seq`s: `run_points` has no ON CONFLICT clause, so a re-sent duplicate would reject forever.
      // Re-minting the log rows' `seq` would erase the gap that marks a genuine drop (run-log.ts).
      if (generation === this.runGeneration) {
        this.pendingPoints = batch.concat(this.pendingPoints);
        this.log.restoreSamples(samples);
        this.log.restoreEntries(entries);
      }
      console.warn('[run-engine] point flush failed; batch retained for the next cadence', error);
      return false;
    } finally {
      // why: the cadence re-arms itself so `updated_at` keeps advancing with no heartbeats at all
      // (paused run, or GPS denied) — the freshness gate reads that stamp, not event-log age.
      this.armFlush();
    }
  }

  private snapshotState(session: PlanSession): RunSnapshotState {
    return {
      sessionKey: session.key,
      // why: an `end`-terminated log is not resumable, so a finalize that fails must not leave one behind.
      events: this.events.filter((event) => event.type !== 'end').map((event) => ({ ...event })),
      lastAnnouncedIndex: this.lastAnnouncedIndex,
      halfwayFired: this.halfwayFired,
      lastAcceptedFix: this.lastAcceptedFix,
      logSeq: this.log.watermarks,
    };
  }

  // why one unconditional flush and then a points-only loop: finalize always mints at least one
  // entry (the completion cue, the pedometer read), so a log-gated loop would spend the whole retry
  // budget on instrumentation under a failing DB — six synchronous transactions inside the window
  // ADR 0008's keepalive has just closed.
  private async drainPendingPoints(): Promise<boolean> {
    await this.queueFlush();
    for (let attempt = 1; attempt < MAX_TAIL_FLUSHES && this.pendingPoints.length > 0; attempt++) {
      await this.queueFlush();
    }
    // Points only: the caller's warning is about the run's distance, which instrumentation cannot shorten.
    return this.pendingPoints.length === 0;
  }

  private async completeRun(record: CompletedRunRecord, generation: number): Promise<void> {
    try {
      const runId = await this.awaitRunId();
      if (generation !== this.runGeneration) return; // superseded by reset()/start()
      if (runId === null) {
        // No `'active'` row means no point was ever insertable either, so the live scalar is the
        // only distance this run will ever have.
        const id = await this.persistence.saveRun({ ...record, distanceM: this.distanceM });
        if (generation !== this.runGeneration) return;
        this.markSaved(id);
        return;
      }
      const drained = await this.drainPendingPoints();
      if (generation !== this.runGeneration) return;
      if (!drained) {
        console.warn(
          `[run-engine] ${this.pendingPoints.length} point(s) could not be persisted; the saved distance is short`,
        );
      }
      await this.persistence.finalizeRun(runId, record);
      if (generation !== this.runGeneration) return;
      this.markSaved(runId);
    } catch (error) {
      if (generation !== this.runGeneration) return;
      // why: leave the row `'active'` and the snapshot in place — the next launch re-finalizes it.
      console.warn('[run-engine] finalize failed', error);
      this.markSaveFailed();
      return;
    }
    try {
      // Only now: until finalizeRun commits, the snapshot is the run's only recovery path.
      await this.runStore.clearSnapshot();
    } catch (error) {
      console.warn('[run-engine] snapshot clear failed; the next launch discards it', error);
    }
  }

  private markSaved(id: string): void {
    this.savedRunId = id;
    this.snapshot = { ...this.snapshot, savedRunId: id };
    this.emit();
  }

  private markSaveFailed(): void {
    this.saveFailed = true;
    this.snapshot = { ...this.snapshot, saveFailed: true };
    this.emit();
  }

  // KNOWN GAP (important, pre-existing since the GPS slice — deliberately not fixed here): unlike
  // queueElevation below, this chain is unbounded, so a tracker op that never *settles* strands every
  // later op behind it — including the stop() that ends background location, which then runs for the
  // process's lifetime and drains the battery ADR 0008 exists to protect. It cannot lose a run
  // (finalize does not await this chain). The fix is the same one line: wrap `op()` in `withTimeout`.
  private queueTracker(op: () => Promise<void>, label: string): void {
    this.trackerOps = this.trackerOps
      .then(op)
      .catch((error) => console.warn(`[run-engine] location ${label} failed`, error));
  }

  private queueElevation(op: () => Promise<void>, label: string): void {
    this.elevationOps = this.elevationOps
      // why bounded and trackerOps is not: this chain carries the stop() that releases CMAltimeter,
      // so one op that never settles leaves the barometer sampling for the process's lifetime.
      .then(() => withTimeout<void>(op(), undefined, this.nativeTimeoutMs, `altitude ${label}`))
      .catch((error) => console.warn(`[run-engine] altitude ${label} failed`, error));
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
