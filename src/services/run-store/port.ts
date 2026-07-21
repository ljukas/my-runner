import type { LocationFix } from '@/domain/geo';
import type { RunEvent } from '@/services/run-engine/types';

/**
 * Incremental, mid-run run-store persistence port (ADR 0003, 0004, 0007).
 * Separate from `RunPersistence.saveRun` (run-engine/types.ts): that writes the
 * finalized, immutable `runs`/`run_segments` rows once at completion; this
 * streams the raw GPS spine (`run_points`) plus a tiny crash-recovery snapshot
 * (`active_run_snapshot`) throughout the run so a killed app can resume. The
 * engine reaches it outside React (ADR 0004); the DB-backed adapter is
 * run-store/index.ts (T7). DB-agnostic — no SQLite/Drizzle/expo types cross it.
 */

/**
 * One persisted GPS fix — the `run_points` row shape (spec §4). Derived from the
 * canonical `LocationFix` (`@/domain/geo`) so the measurement fields
 * (lat/lng/altitude/accuracy/speed) keep a single definition, plus two
 * engine-derived tags and a storage-facing timestamp. `timestamp` is re-typed to
 * an ISO-8601 UTC string to match the `run_points.timestamp` TEXT column (spec
 * §4) and the `CompletedRunRecord` convention; the epoch-ms→ISO conversion at
 * the storage boundary is adapter-owned (per `domain/geo`). `accuracy` stays
 * `number | null` (inherited): though only fixes passing `accuracyFilter` are
 * ever written, the column is nullable REAL and the type must stay sound when a
 * row is read back (resume, Stage 4/5 projections).
 */
export interface RunPoint extends Omit<LocationFix, 'timestamp'> {
  /** Monotonic per-run point index, engine-assigned; `(run_id, seq)` is the PK. */
  seq: number;
  /** ISO-8601 UTC — the fix's own timestamp, not wall-clock at insert time. */
  timestamp: string;
  /**
   * 0-based index of the run segment this fix falls in (the engine's derived
   * `segment_seq`). Per-segment distance is `Σ` of points grouped by this at
   * finalize; never stored as a scalar (points-as-spine).
   */
  segmentSeq: number;
}

/**
 * The persisted engine state for crash recovery — `state_json` of the single
 * `active_run_snapshot` row (ADR 0007 §5). Intentionally tiny: the event log
 * plus two watermarks and the haversine anchor, and **no point array** (the
 * track lives in `run_points`, reloaded on resume — no write amplification).
 * `runId` is absent: exactly one `runs` row is `'active'`, so resume recovers it
 * from that row (T8/T14), not from here.
 */
export interface RunSnapshotState {
  /** Re-resolves the `PlanSession` from static plan data on resume. */
  sessionKey: string;
  /**
   * The full event log (ADR 0007). Active-elapsed replays from this alone, so
   * elapsed stays correct across process death (pure wall-clock math).
   */
  events: RunEvent[];
  /**
   * Cue-firing watermark so resume never re-announces an already-spoken
   * transition/last-run cue. Mirrors the engine's `lastAnnouncedIndex`.
   */
  lastAnnouncedIndex: number;
  /**
   * Whether the halfway milestone already fired — the one milestone flag not
   * derivable from `lastAnnouncedIndex` (halfway is time-based). Mirrors the
   * engine's `halfwayFired`; without it resume would re-announce halfway.
   */
  halfwayFired: boolean;
  /**
   * The haversine anchor — the last accepted fix, restored on resume so the
   * first post-resume delta measures from the correct origin (else it is
   * dropped). Held as the raw `LocationFix` the engine accepted (epoch-ms
   * timestamp), not a stored `RunPoint`, so the ~1 Hz ingest / monotonic-dedupe
   * path stays conversion-free; only lat/lng (origin) and timestamp (dedupe) are
   * consumed. `null` before the first accepted fix.
   */
  lastAcceptedFix: LocationFix | null;
}

/**
 * Incremental run-persistence port (ADR 0003). Streams points + the crash
 * snapshot during the run; `RunPersistence.saveRun` writes the finalized run
 * once at the end.
 */
export interface RunStore {
  /**
   * Persist one ~5 s cadence atomically: batch-insert `points` into `run_points`
   * under `runId` AND upsert the single (`id = 1`) `active_run_snapshot` row in
   * **one transaction** (spec §5, ADR 0007 §5). An empty `points` array is valid
   * — the snapshot is still upserted (e.g. while paused or before the first fix).
   * The adapter stamps `active_run_snapshot.updated_at` (ISO-8601 UTC) on every
   * call. Rejects on DB failure so the engine retains the batch and retries next
   * cadence (spec §11 — points are never silently dropped); being atomic, a
   * rejected flush commits neither points nor snapshot, so the two never diverge
   * and a retry re-sends the same `seq`s without duplication. Also called on
   * `finalize()` to drain the final batch before the run row is finalized.
   */
  flush(runId: string, points: RunPoint[], state: RunSnapshotState): Promise<void>;
  /**
   * Load the crash-recovery snapshot together with the row's `updated_at`, or
   * `null` when none is stored (no active run). The caller (T15
   * `detectResumableRun`) gates freshness on `updatedAt` — resumable iff
   * `now − updatedAt < plannedLength + 30 min` (spec §5), `plannedLength` derived
   * from `state.sessionKey`. Row age (`updated_at`), not event-log age, is the
   * freshness signal: the row is re-stamped every flush (incl. while paused), but
   * the log only appends on start/pause/resume/skip.
   */
  loadSnapshot(): Promise<{ state: RunSnapshotState; updatedAt: string } | null>;
  /**
   * Delete the snapshot row. Idempotent — a no-op when none exists. Called at
   * finalize and after a resume decline.
   */
  clearSnapshot(): Promise<void>;
}
