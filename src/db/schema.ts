import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  sessionKey: text('session_key').notNull(),
  status: text('status', { enum: ['completed', 'partial'] }).notNull(),
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
