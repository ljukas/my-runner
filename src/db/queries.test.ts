import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { runCompleted, runIsResult, runNotDeleted } from './queries';
import { runs } from './schema';

/**
 * Pins the Stage 3 result-filtering invariant that nothing else in the gate
 * covers: `status = 'active'` (the in-flight/abandoned row) is excluded from
 * every result query, and soft-deleted rows stay hidden. Runs on an in-memory
 * `bun:sqlite` with the driver-agnostic `runs` table + a minimal hand-rolled
 * DDL (only the `runs` columns the predicates touch), so no RN runtime, Metro,
 * or migration replay is needed — it fits the pure-TS `bun test` suite.
 */
const sqlite = new Database(':memory:');
const db = drizzle(sqlite);

beforeAll(() => {
  sqlite.exec(`
    CREATE TABLE runs (
      id text PRIMARY KEY NOT NULL,
      session_key text NOT NULL,
      status text NOT NULL,
      started_at text NOT NULL,
      ended_at text NOT NULL,
      active_duration_s integer NOT NULL,
      distance_m real,
      summary_polyline text,
      healthkit_saved integer DEFAULT false NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
  `);
  const base = {
    sessionKey: 'w1d1',
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T00:30:00Z',
    activeDurationS: 1800,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:30:00Z',
  };
  db.insert(runs)
    .values([
      { id: 'a', status: 'active', ...base },
      { id: 'c', status: 'completed', ...base },
      { id: 'p', status: 'partial', ...base },
      { id: 'd', status: 'completed', ...base, deletedAt: '2026-01-02T00:00:00Z' },
    ])
    .run();
});

afterAll(() => {
  sqlite.close();
});

test('runIsResult excludes active and soft-deleted, keeps completed + partial', () => {
  const rows = db.select({ id: runs.id }).from(runs).where(runIsResult).all();
  expect(rows.map((r) => r.id).sort()).toEqual(['c', 'p']);
});

test('runCompleted keeps only completed, not deleted', () => {
  const rows = db.select({ id: runs.id }).from(runs).where(runCompleted).all();
  expect(rows.map((r) => r.id)).toEqual(['c']);
});

test('runNotDeleted keeps active/completed/partial, drops soft-deleted', () => {
  const rows = db.select({ id: runs.id }).from(runs).where(runNotDeleted).all();
  expect(rows.map((r) => r.id).sort()).toEqual(['a', 'c', 'p']);
});
