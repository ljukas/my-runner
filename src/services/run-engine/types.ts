import type { SegmentKind } from '@/domain/plan';
import type { RunNotice } from '@/domain/run-notice';
import type { MotionKind } from '@/domain/run-motion';

/** Wall-clock time source, epoch milliseconds (ADR 0007: wall clock only). */
export type Clock = () => number;

export interface RunEvent {
  type: 'start' | 'pause' | 'resume' | 'skip' | 'end';
  at: number;
}

export type EngineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'endedEarly';

interface RunSnapshotBase {
  status: EngineStatus;
  sessionKey: string | null;
  activeElapsedSeconds: number;
  /** Live smoothed distance in metres (ADR 0021 §3); 0 before the first committed fix / when GPS is off. */
  distanceM: number;
  /** Overall pace in seconds per km; null until distance exceeds 0. */
  paceSecPerKm: number | null;
  /** Set once persistence resolves after completion/end-early. */
  savedRunId: string | null;
  saveFailed: boolean;
  /** Epoch ms the active clock counts up from while running (now − active time); null otherwise. */
  elapsedAnchorMs: number | null;
  /** Why the last run left no summary (a free run, ADR 0026 §6); null otherwise, and once a run starts. */
  lastOutcome: RunNotice | null;
}

export interface ScriptedRunSnapshot extends RunSnapshotBase {
  mode: 'scripted';
  segmentIndex: number;
  segmentKind: SegmentKind | null;
  segmentSecondsRemaining: number;
  segmentSecondsTotal: number;
  /** Epoch-ms the current segment ends while running; null when idle/done. */
  segmentEndsAt: number | null;
  nextSegment: { kind: SegmentKind; seconds: number } | null;
  totalSeconds: number;
}

/** A free run's live view (ADR 0026 §6): no countdown, only what the classifier sees now. */
export interface OpenRunSnapshot extends RunSnapshotBase {
  mode: 'open';
  /** The confirmed kind right now; null before the first velocity. */
  motion: MotionKind | null;
  /** Pace over the last stretch of moving samples; null unless running or walking on fresh GPS. */
  rollingPaceSecPerKm: number | null;
  /** No recent speed, or none yet: "Waiting for GPS" (spec §5.2). */
  gpsStale: boolean;
  /** Ending now would delete the run: under a minute of active time, as the save rounds it. */
  endDiscards: boolean;
}

export type RunSnapshot = ScriptedRunSnapshot | OpenRunSnapshot;

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
  /** Engine's live-cached smoothed metres; finalize re-derives the stored value from `run_points` (ADR 0021 §3), never this. Absent when GPS is off. */
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
  /**
   * Present on a free run: its buckets are derived from the points at finalize (ADR 0026 §3–§4), with
   * the threshold it ran under. `endedAt`/`activeDurationS` are then provisional — the derivation
   * settles them (trim, cap) — and `eventLogJson` must be set.
   */
  derived?: { thresholdMps: number };
}

/** What a finalize did: saved the run, or deleted it (a free run left under a minute; ADR 0026 §6). */
export type FinalizeOutcome = 'saved' | 'discarded';

/** Persistence port (ADR 0003) — the engine never touches the DB directly. */
export interface RunPersistence {
  /** The saved run's id; null when a free run was too short to keep, so nothing was written. */
  saveRun(record: CompletedRunRecord): Promise<string | null>;
}

/**
 * Points-as-spine lifecycle (ADR 0021): `startRun` opens the `'active'` row `run_points` references;
 * `finalizeRun` derives the stored totals from those points, or deletes the run (`FinalizeOutcome`).
 */
export interface RunLifecyclePersistence extends RunPersistence {
  startRun(sessionKey: string, startedAtIso: string): Promise<string>;
  finalizeRun(runId: string, record: CompletedRunRecord): Promise<FinalizeOutcome>;
  /** Deletes an in-flight run and everything it owns — a discarded free run (ADR 0026 §6). */
  discardRun(runId: string): Promise<void>;
}
