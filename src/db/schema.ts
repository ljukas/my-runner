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
  eventLogJson: text('event_log_json'),
  motionPermission: text('motion_permission'),
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
    altitudeAccuracy: real('altitude_accuracy'),
    speed: real('speed'),
    segmentSeq: integer('segment_seq').notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.seq] })],
);

/**
 * Raw barometer readings at the sensor's own cadence — product data, not diagnostics:
 * the render slice folds these through `domain/elevation.ts` (ADR 0015 item 5).
 *
 * why no primary key, unlike `run_points`: `restore()` rebuilds the point `seq` counter and
 * nothing rebuilds this one, so a `(run_id, seq)` PK made a resumed run's first flush throw
 * UNIQUE — and because that insert shares the GPS transaction, the throw rolled back the GPS
 * points too, for the rest of the run. `seq` is a plain ordering column; nothing joins on it.
 * Exempt from ADR 0004 §5's UUID + timestamps + soft-delete rule for the same reason
 * `run_points` is: append-only rows whose own `at` is their temporal record.
 */
export const runAltitudeSamples = sqliteTable('run_altitude_samples', {
  runId: text('run_id')
    .notNull()
    .references(() => runs.id),
  seq: integer('seq').notNull(),
  at: text('at').notNull(),
  /** CoreMotion's boot-relative clock. Paired with `at` it separates a sampling gap from a JS-scheduling one. */
  sensorTimestampS: real('sensor_timestamp_s'),
  pressureHpa: real('pressure_hpa').notNull(),
  relativeAltitudeM: real('relative_altitude_m'),
  epoch: integer('epoch').notNull(),
  segmentSeq: integer('segment_seq').notNull(),
});

/**
 * Field-log entries for one run. `kind` is plain text, never a Drizzle enum: an enum would
 * force a migration for every new signal, which is the one thing this table exists to avoid.
 * Same PK and ADR 0004 §5 exemptions as `run_altitude_samples` above.
 */
export const runLog = sqliteTable('run_log', {
  runId: text('run_id')
    .notNull()
    .references(() => runs.id),
  seq: integer('seq').notNull(),
  at: text('at').notNull(),
  kind: text('kind').notNull(),
  detailJson: text('detail_json'),
});

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
export type AltitudeSampleRow = typeof runAltitudeSamples.$inferSelect;
export type RunLogRow = typeof runLog.$inferSelect;
