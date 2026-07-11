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
}

export interface CompletedRunRecord {
  sessionKey: string;
  status: 'completed' | 'partial';
  startedAt: string; // ISO-8601 UTC
  endedAt: string;
  activeDurationS: number;
  segments: CompletedSegmentRecord[];
}

/** Persistence port (ADR 0003) — the engine never touches the DB directly. */
export interface RunPersistence {
  saveRun(record: CompletedRunRecord): Promise<string>;
}
