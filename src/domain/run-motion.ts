/**
 * Run/walk/stopped buckets for a free run (ADR 0026 §3). Pure — replayed live, on crash-resume and at
 * finalize, so all three see the same buckets.
 */
import {
  createSmootherState,
  MAX_GAP_S,
  smoothFix,
  type LatLng,
  type LocationFix,
  type SegmentedFix,
  type SmootherState,
} from './geo';
import { largestRemainder, quantile } from './math';
import type { SegmentKind } from './plan';
import type { PausedInterval } from './run-altitude';

export type MotionKind = 'run' | 'walk' | 'stopped';

/** `run_segments.kind` (ADR 0026 §4). */
export type StoredSegmentKind = SegmentKind | MotionKind;

/**
 * Measured on 12 field captures (spec §4.4). Provisional until an outdoor capture with a stop at a
 * crossing and a mid-run pause exists (#79).
 */
export const MOTION = {
  stoppedBelowMps: 0.5,
  stoppedUntilAboveMps: 0.8,
  dwellMs: 8000,
  agreement: 0.7,
  fallbackThresholdMps: 2.1,
  learnSkipMs: 10_000,
  learnMinSamples: 60,
  learnFloorMps: 1.5,
  learnCeilingMps: 3.0,
} as const;

export interface MotionSample {
  atMs: number;
  /** `SmoothStep.smoothedSpeedMps`; null holds the current kind. */
  speedMps: number | null;
  /** First sample after a resume: a candidate begun before the pause must not carry across it. */
  afterPause?: boolean;
}

interface Candidate {
  sinceMs: number;
  /** Samples that differed from the current kind, per kind they implied; the plurality confirms. */
  votes: Partial<Record<MotionKind, number>>;
  latest: MotionKind;
  agreeing: number;
  seen: number;
}

/** The kind most of a candidate's samples implied; a tie goes to the latest one. */
function pluralityOf(candidate: Candidate): MotionKind {
  let best = candidate.latest;
  for (const [kind, count] of Object.entries(candidate.votes) as [MotionKind, number][]) {
    if (count > (candidate.votes[best] ?? 0)) best = kind;
  }
  return best;
}

export interface MotionState {
  kind: MotionKind | null;
  candidate: Candidate | null;
}

/** A confirmed change: `kind` from `atMs` on, backdated to where the change began. */
export interface MotionTransition {
  kind: MotionKind;
  atMs: number;
}

export interface MotionStep {
  state: MotionState;
  transition: MotionTransition | null;
}

export function createMotionState(): MotionState {
  return { kind: null, candidate: null };
}

function targetKind(
  current: MotionKind | null,
  speedMps: number,
  thresholdMps: number,
): MotionKind {
  if (speedMps < MOTION.stoppedBelowMps) return 'stopped';
  if (current === 'stopped' && speedMps <= MOTION.stoppedUntilAboveMps) return 'stopped';
  return speedMps >= thresholdMps ? 'run' : 'walk';
}

export function motionStep(
  state: MotionState,
  sample: MotionSample,
  thresholdMps: number,
): MotionStep {
  const candidate = sample.afterPause ? null : state.candidate;
  if (sample.speedMps === null) return { state: { ...state, candidate }, transition: null };

  const target = targetKind(state.kind, sample.speedMps, thresholdMps);
  if (state.kind === null) {
    return {
      state: { kind: target, candidate: null },
      transition: { kind: target, atMs: sample.atMs },
    };
  }

  if (target === state.kind) {
    if (!candidate) return { state: { kind: state.kind, candidate: null }, transition: null };
    const seen = candidate.seen + 1;
    const kept = candidate.agreeing / seen >= MOTION.agreement;
    return {
      state: { kind: state.kind, candidate: kept ? { ...candidate, seen } : null },
      transition: null,
    };
  }

  // why one candidate across kinds, keeping `sinceMs`: slowing from a run through a walk into a stop
  // is one change, and its boundary is where the slowing began.
  const votes = candidate?.votes ?? {};
  const next: Candidate = {
    sinceMs: candidate?.sinceMs ?? sample.atMs,
    votes: { ...votes, [target]: (votes[target] ?? 0) + 1 },
    latest: target,
    agreeing: (candidate?.agreeing ?? 0) + 1,
    seen: (candidate?.seen ?? 0) + 1,
  };
  const confirmed =
    sample.atMs - next.sinceMs >= MOTION.dwellMs && next.agreeing / next.seen >= MOTION.agreement;
  if (!confirmed) return { state: { kind: state.kind, candidate: next }, transition: null };
  const kind = pluralityOf(next);
  return { state: { kind, candidate: null }, transition: { kind, atMs: next.sinceMs } };
}

export interface MotionBucket {
  seq: number;
  kind: MotionKind;
  startMs: number;
  endMs: number;
  /** Seconds in [startMs, endMs] outside every pause. */
  activeS: number;
  /** `activeS` as whole seconds, rounded so the buckets sum to the run's rounded active time. */
  durationS: number;
  distanceM: number;
}

export interface OpenTrackRollup {
  distanceM: number;
  /** Smoothed points for rendering, as `smoothTrack` returns them. */
  points: LatLng[];
  buckets: MotionBucket[];
}

export interface OpenTrackStepOptions {
  thresholdMps: number;
  paused: readonly PausedInterval[];
}

export interface OpenTrackOptions extends OpenTrackStepOptions {
  startMs: number;
  endMs: number;
}

export interface OpenTrackState {
  smoother: SmootherState;
  motion: MotionState;
  previousMs: number | null;
}

export interface OpenTrackStep {
  state: OpenTrackState;
  acceptedDeltaMeters: number;
  smoothedPoint: LatLng | null;
  /** Kind changes this fix confirmed, in time order; the saved buckets are built from these. */
  changes: MotionTransition[];
}

export function createOpenTrackState(): OpenTrackState {
  return { smoother: createSmootherState(), motion: createMotionState(), previousMs: null };
}

function pausedMsWithin(paused: readonly PausedInterval[], fromMs: number, toMs: number): number {
  let total = 0;
  for (const pause of paused) {
    total += Math.max(0, Math.min(toMs, pause.toMs) - Math.max(fromMs, pause.fromMs));
  }
  return total;
}

const activeMs = (paused: readonly PausedInterval[], fromMs: number, toMs: number) =>
  toMs - fromMs - pausedMsWithin(paused, fromMs, toMs);

const pauseBetween = (paused: readonly PausedInterval[], fromMs: number, toMs: number) =>
  paused.some((pause) => pause.fromMs >= fromMs && pause.fromMs < toMs);

const withinPause = (paused: readonly PausedInterval[], atMs: number) =>
  paused.some((pause) => atMs >= pause.fromMs && atMs < pause.toMs);

/**
 * One accepted fix of a free run through the smoother and `motionStep` — the step the live engine
 * takes, and the one `rollupOpenTrack` folds (ADR 0026 §3). The smoother restarts at the first fix
 * after a pause, so ground covered while paused is not counted, as active time excludes the pause;
 * a GPS gap longer than `MAX_GAP_S` of active time is stopped.
 */
export function openTrackStep(
  state: OpenTrackState,
  fix: LocationFix,
  { thresholdMps, paused }: OpenTrackStepOptions,
): OpenTrackStep {
  const previous = state.previousMs;
  // why ignored rather than folded: a fix stamped at or before the last one, or inside a pause,
  // describes no active movement — and would read as a gap to the next fix.
  if ((previous !== null && fix.timestamp <= previous) || withinPause(paused, fix.timestamp)) {
    return { state, acceptedDeltaMeters: 0, smoothedPoint: null, changes: [] };
  }
  const afterPause = previous !== null && pauseBetween(paused, previous, fix.timestamp);
  const afterGap =
    previous !== null && activeMs(paused, previous, fix.timestamp) > MAX_GAP_S * 1000;

  const smoothed = smoothFix(afterPause ? createSmootherState() : state.smoother, fix);
  const changes: MotionTransition[] =
    afterGap && previous !== null && state.motion.kind !== null
      ? [
          { kind: 'stopped', atMs: previous },
          { kind: state.motion.kind, atMs: fix.timestamp },
        ]
      : [];
  const moved = motionStep(
    state.motion,
    {
      atMs: fix.timestamp,
      speedMps: smoothed.smoothedSpeedMps,
      afterPause: afterPause || afterGap,
    },
    thresholdMps,
  );
  if (moved.transition) changes.push(moved.transition);

  return {
    // why the smoother's clock, not this fix's: a velocity-gated fix is no position to measure from
    state: {
      smoother: smoothed.state,
      motion: moved.state,
      previousMs: smoothed.state.lastAcceptedTime,
    },
    acceptedDeltaMeters: smoothed.acceptedDeltaMeters,
    smoothedPoint: smoothed.smoothedPoint,
    changes,
  };
}

/**
 * The saved buckets of a free run: `openTrackStep` folded over its accepted fixes inside
 * [startMs, endMs]. Buckets tile that span; each committed delta belongs to the bucket its end fix
 * falls in, so the buckets' distances sum to `distanceM`.
 */
export function rollupOpenTrack(
  fixes: readonly LocationFix[],
  { startMs, endMs, ...stepOptions }: OpenTrackOptions,
): OpenTrackRollup {
  let state = createOpenTrackState();
  const changes: MotionTransition[] = [];
  const deltas: { atMs: number; m: number }[] = [];
  const points: LatLng[] = [];
  let distanceM = 0;

  for (const fix of fixes) {
    // why only the end is cut: the engine ingests a fix stamped just before the start (a cached
    // first fix), so dropping it would make the saved distance differ from the live one.
    if (fix.timestamp > endMs) continue;
    const step = openTrackStep(state, fix, stepOptions);
    state = step.state;
    distanceM += step.acceptedDeltaMeters;
    if (step.acceptedDeltaMeters > 0) {
      deltas.push({ atMs: fix.timestamp, m: step.acceptedDeltaMeters });
    }
    if (step.smoothedPoint) points.push(step.smoothedPoint);
    changes.push(...step.changes);
  }

  return {
    distanceM,
    points,
    buckets: toBuckets(changes, deltas, stepOptions.paused, startMs, endMs),
  };
}

function toBuckets(
  changes: readonly MotionTransition[],
  deltas: readonly { atMs: number; m: number }[],
  paused: readonly PausedInterval[],
  startMs: number,
  endMs: number,
): MotionBucket[] {
  const spans: { kind: MotionKind; startMs: number }[] = [];
  for (const change of changes) {
    const at = spans.length === 0 ? startMs : Math.min(Math.max(change.atMs, startMs), endMs);
    // A change at the same instant as the previous one replaces it rather than leaving a 0 ms bucket.
    if (spans.at(-1)?.startMs === at) spans.pop();
    if (spans.at(-1)?.kind !== change.kind) spans.push({ kind: change.kind, startMs: at });
  }

  const buckets = spans.map((span, seq): MotionBucket => {
    const bucketEnd = spans[seq + 1]?.startMs ?? endMs;
    return {
      seq,
      kind: span.kind,
      startMs: span.startMs,
      endMs: bucketEnd,
      activeS: activeMs(paused, span.startMs, bucketEnd) / 1000,
      durationS: 0,
      distanceM: 0,
    };
  });
  const whole = largestRemainder(
    buckets.map((b) => b.activeS),
    Math.round(buckets.reduce((sum, b) => sum + b.activeS, 0)),
  );
  buckets.forEach((bucket, i) => (bucket.durationS = whole[i]));
  // why `<`: a delta is the leg ending at its fix, so a fix exactly on a boundary closes the earlier bucket.
  for (const delta of deltas) {
    const owner = buckets.findLast((bucket) => bucket.startMs < delta.atMs) ?? buckets[0];
    if (owner) owner.distanceM += delta.m;
  }
  return buckets;
}

/** `msIntoSegment` counts from the first fix of that segment passed in, not from the plan's timeline. */
export interface LabelledSpeed {
  kind: SegmentKind;
  speedMps: number;
  msIntoSegment: number;
}

/**
 * Replays the smoother over ONE plan run's accepted fixes; steps without a velocity are dropped. Call
 * it per run and concatenate: segment starts are keyed by `segmentSeq`, which every run reuses.
 */
export function labelledSpeeds(
  fixes: readonly SegmentedFix[],
  kindBySeq: ReadonlyMap<number, SegmentKind>,
): LabelledSpeed[] {
  let smoother = createSmootherState();
  const segmentStart = new Map<number, number>();
  const out: LabelledSpeed[] = [];
  for (const fix of fixes) {
    if (!segmentStart.has(fix.segmentSeq)) segmentStart.set(fix.segmentSeq, fix.timestamp);
    const step = smoothFix(smoother, fix);
    smoother = step.state;
    const kind = kindBySeq.get(fix.segmentSeq);
    if (step.smoothedSpeedMps === null || kind === undefined) continue;
    out.push({
      kind,
      speedMps: step.smoothedSpeedMps,
      msIntoSegment: fix.timestamp - (segmentStart.get(fix.segmentSeq) ?? fix.timestamp),
    });
  }
  return out;
}

/**
 * The run/walk threshold for a runner, from their recent plan runs (ADR 0026 §3): the midpoint of the
 * walk p90 and the run p10 — where the two distributions meet, which tracks a slow day better than
 * the midpoint of the medians (spec §4.4). Warm-ups and cool-downs are left out.
 */
export function learnThreshold(samples: readonly LabelledSpeed[]): number {
  // why stopped samples go too: a runner standing inside a scripted run would drag its p10 down.
  const settled = samples.filter(
    (s) => s.msIntoSegment >= MOTION.learnSkipMs && s.speedMps > MOTION.stoppedUntilAboveMps,
  );
  const walk = settled.filter((s) => s.kind === 'walk').map((s) => s.speedMps);
  const run = settled.filter((s) => s.kind === 'run').map((s) => s.speedMps);
  if (walk.length < MOTION.learnMinSamples || run.length < MOTION.learnMinSamples) {
    return MOTION.fallbackThresholdMps;
  }
  const learned = (quantile(walk, 0.9) + quantile(run, 0.1)) / 2;
  return Math.min(Math.max(learned, MOTION.learnFloorMps), MOTION.learnCeilingMps);
}
