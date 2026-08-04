import type { LocationFix } from '@/domain/geo';
import type { PendingEntry, PendingSample } from '@/services/run-engine/run-log';
import type { RunEvent } from '@/services/run-engine/types';

/**
 * Incremental mid-run persistence (ADR 0003, 0004, 0007): streams the GPS spine
 * (`run_points`) plus a crash-recovery snapshot (`active_run_snapshot`) so a killed
 * app can resume. `RunPersistence.saveRun` writes the finalized run once at completion.
 */

/**
 * A persisted `run_points` row (spec §4). Extends `LocationFix` but re-types
 * `timestamp` to an ISO-8601 UTC string (the TEXT column); `accuracy` stays nullable
 * so a row read back stays sound, though only accuracy-filtered fixes are ever written.
 */
export interface RunPoint extends Omit<LocationFix, 'timestamp'> {
  /** Monotonic per-run point index, engine-assigned; `(run_id, seq)` is the PK. */
  seq: number;
  /** ISO-8601 UTC — the fix's own timestamp, not wall-clock at insert time. */
  timestamp: string;
  /** 0-based index of the segment this fix falls in; per-segment distance is derived from grouped points at finalize, never stored. */
  segmentSeq: number;
}

/**
 * Persisted engine state for crash recovery — `state_json` of the single
 * `active_run_snapshot` row (ADR 0007 §5). Holds no point array (the track lives in
 * `run_points`, reloaded on resume — no write amplification) and no `runId` (the one
 * `'active'` runs row identifies the run on resume).
 */
export interface RunSnapshotState {
  /** Re-resolves the `PlanSession` from static plan data on resume. */
  sessionKey: string;
  /** Full event log (ADR 0007); active-elapsed replays from this alone, so timing survives process death. */
  events: RunEvent[];
  /** Cue-firing watermark so resume never re-announces an already-spoken cue. */
  lastAnnouncedIndex: number;
  /** Halfway milestone flag — time-based, so not derivable from `lastAnnouncedIndex`; without it resume would re-announce halfway. */
  halfwayFired: boolean;
  /**
   * The last fix that committed distance, as the raw `LocationFix` (epoch-ms). Diagnostic only:
   * resume re-derives the haversine anchor by re-folding `run_points`, since anchoring on an
   * unpersisted fix would make resumed distance un-derivable from the stored track (ADR 0021 §3).
   * Null before the first committed fix.
   */
  lastAcceptedFix: LocationFix | null;
  /** Watermarks so a resumed run's instrumentation `seq` continues instead of restarting (spec §5.1). Absent in snapshots written before this slice. */
  logSeq?: { sampleSeq: number; entrySeq: number };
}

export interface RunStore {
  /**
   * Persist one cadence atomically: batch-insert `points`, `samples`, and `entries`, and upsert
   * the single (`id = 1`) `active_run_snapshot` row, all in ONE transaction (spec §5), stamping
   * its `updated_at` (ISO-8601 UTC). Empty arrays are valid (snapshot still upserted). Rejects on
   * DB failure so the engine retries the same batch next cadence; being atomic, a rejected flush
   * commits none of the four writes, so they never diverge and the retry re-sends the same
   * `seq`s without duplication.
   */
  flush(
    runId: string,
    points: RunPoint[],
    samples: PendingSample[],
    entries: PendingEntry[],
    state: RunSnapshotState,
  ): Promise<void>;
  /**
   * Load the crash-recovery snapshot with the row's `updated_at`, or null when none is
   * stored. The caller gates resumability on `updatedAt` (spec §5), not event-log age:
   * the row is re-stamped every flush (even while paused), but the log only appends on
   * start/pause/resume/skip.
   */
  loadSnapshot(): Promise<{ state: RunSnapshotState; updatedAt: string } | null>;
  /** Delete the snapshot row. Idempotent — a no-op when none exists. */
  clearSnapshot(): Promise<void>;
}
