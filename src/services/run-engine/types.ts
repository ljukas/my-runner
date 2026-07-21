import type { SegmentKind } from '@/domain/plan';

/** Wall-clock time source, epoch milliseconds (ADR 0007: wall clock only). */
export type Clock = () => number;

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
  /** Set once persistence resolves after completion/end-early. */
  savedRunId: string | null;
  saveFailed: boolean;
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
