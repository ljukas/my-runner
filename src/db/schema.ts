import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  sessionKey: text('session_key').notNull(),
  status: text('status', { enum: ['active', 'completed', 'partial'] }).notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at').notNull(),
  activeDurationS: integer('active_duration_s').notNull(),
  distanceM: real('distance_m'),
  summaryPolyline: text('summary_polyline'),
  healthkitSaved: integer('healthkit_saved', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const runSegments = sqliteTable('run_segments', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id),
  seq: integer('seq').notNull(),
  kind: text('kind', { enum: ['warmup', 'run', 'walk', 'cooldown'] }).notNull(),
  plannedDurationS: integer('planned_duration_s').notNull(),
  actualDurationS: integer('actual_duration_s').notNull(),
  distanceM: real('distance_m'),
  wasSkipped: integer('was_skipped', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * The persisted raw GPS fix stream — the single source of truth for distance,
 * pace, splits, and (Stage 4/5) the route polyline + HealthKit route. Append-only
 * and immutable after write: the fix's own `timestamp` is its temporal record, so
 * unlike `runs`/`run_segments` these rows carry no `created_at`/`updated_at`
 * (avoids write amplification on the ~1 Hz batch inserts — spec §5, ADR 0007 §5).
 * Never read via `useLiveQuery` (ADR 0004 §3) — the RunStore adapter and the
 * finalize rollup read them imperatively, outside React.
 */
export const runPoints = sqliteTable(
  'run_points',
  {
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    seq: integer('seq').notNull(),
    timestamp: text('timestamp').notNull(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    altitude: real('altitude'),
    accuracy: real('accuracy'),
    speed: real('speed'),
    segmentSeq: integer('segment_seq').notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.seq] })],
);

/**
 * The in-flight run's crash-recovery snapshot: event log + sessionKey + cue and
 * `seq` watermarks + `lastAcceptedFix` anchor (never the track — ADR 0007 §5). A
 * hard singleton: `id` is pinned to 1 by the CHECK, so the RunStore adapter (T7)
 * MUST always write `id: 1` and upsert one row (`ON CONFLICT(id) DO UPDATE`) —
 * `integer PRIMARY KEY` leaves `id` optional in the insert type, so the singleton
 * guarantee rests on the adapter passing `1`, not on the type system. Cleared at
 * finalize.
 */
export const activeRunSnapshot = sqliteTable(
  'active_run_snapshot',
  {
    id: integer('id').primaryKey(),
    stateJson: text('state_json').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [check('active_run_snapshot_singleton', sql`${table.id} = 1`)],
);

/** A stored run row and one of its segment rows — the shapes the summary reads. */
export type Run = typeof runs.$inferSelect;
export type RunSegment = typeof runSegments.$inferSelect;
