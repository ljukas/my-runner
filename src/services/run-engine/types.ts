import type { SegmentKind } from '@/domain/plan';

/** Wall-clock time source, epoch milliseconds (ADR 0007: wall clock only). */
export type Clock = () => number;

/**
 * One-shot pedometer read for `[start, end)`; null when unavailable (no permission, no hardware, or
 * a platform error — never throws). A function, not a fuller port, because finalize needs only this
 * one call: engine.ts must not import `expo-sensors` itself (ADR 0003; it also breaks `bun test`'s
 * parser), so the composition root supplies the real implementation.
 */
export type StepCounter = (start: Date, end: Date) => Promise<number | null>;

export interface RunEvent {
  type: 'start' | 'pause' | 'resume' | 'skip' | 'end';
  at: number;
}

export type EngineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'endedEarly';

export interface RunSnapshot {
  status: EngineStatus;
  sessionKey: string | null;
  segmentIndex: number;
  segmentKind: SegmentKind | null;
  segmentSecondsRemaining: number;
  segmentSecondsTotal: number;
  /** Epoch-ms the current segment ends while running; null when idle/done. */
  segmentEndsAt: number | null;
  nextSegment: { kind: SegmentKind; seconds: number } | null;
  activeElapsedSeconds: number;
  totalSeconds: number;
  /** Live smoothed distance in metres (ADR 0021 §3); 0 before the first committed fix / when GPS is off. */
  distanceM: number;
  /** Overall pace in seconds per km; null until distance exceeds 0. */
  paceSecPerKm: number | null;
  /** Set once persistence resolves after completion/end-early. */
  savedRunId: string | null;
  saveFailed: boolean;
}

/** `timestamp` is normalized integer epoch-ms so the `run_points` int-ms→ISO write round-trips losslessly and the finalize re-fold matches live distance (ADR 0021 §3). */
export interface BufferedRunPoint {
  seq: number;
  segmentSeq: number;
  timestamp: number;
  lat: number;
  lng: number;
  altitude: number | null;
  accuracy: number | null;
  altitudeAccuracy?: number | null;
  speed: number | null;
}

export interface CompletedSegmentRecord {
  seq: number;
  kind: SegmentKind;
  plannedDurationS: number;
  actualDurationS: number;
  wasSkipped: boolean;
  /** Engine's live-cached smoothed metres; finalize re-derives the stored value from `run_points` (ADR 0021 §3), never this. Absent when GPS is off / pre-Wave-C. */
  distanceM?: number;
}

export interface CompletedRunRecord {
  sessionKey: string;
  status: 'completed' | 'partial';
  startedAt: string; // ISO-8601 UTC
  endedAt: string;
  activeDurationS: number;
  segments: CompletedSegmentRecord[];
  /** Live-cached smoothed total; finalize re-derives from `run_points`, never this (ADR 0021 §3). */
  distanceM?: number;
  /** The event log, persisted because `active_run_snapshot` is cleared at finalize and it would otherwise be destroyed (spec §5.2). */
  eventLogJson?: string;
  motionPermission?: string;
}

/** Persistence port (ADR 0003) — the engine never touches the DB directly. */
export interface RunPersistence {
  saveRun(record: CompletedRunRecord): Promise<string>;
}

/**
 * Points-as-spine run lifecycle (Stage 3 crash-recovery contract, ADR 0021): `startRun` opens the in-flight
 * `'active'` row so `run_points` can FK-reference it mid-run; `finalizeRun` flips it to terminal, deriving
 * distance, per-segment rollup, and polyline from the persisted points. Wave C moves the engine onto this pair.
 */
export interface RunLifecyclePersistence extends RunPersistence {
  startRun(sessionKey: string, startedAtIso: string): Promise<string>;
  finalizeRun(runId: string, record: CompletedRunRecord): Promise<void>;
}
