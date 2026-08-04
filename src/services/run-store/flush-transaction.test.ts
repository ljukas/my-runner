import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { activeRunSnapshot, runAltitudeSamples, runLog, runPoints, runs } from '@/db/schema';
import type { PendingEntry, PendingSample } from '@/services/run-engine/run-log';
import { writeFlush } from './flush-transaction';
import type { RunPoint } from './port';

/**
 * Exercises `writeFlush` against a real synchronous SQLite driver (`bun:sqlite`, not
 * `expo-sqlite`) — see the module comment on `writeFlush` for why the split exists. Both
 * drivers wrap `db.transaction` around the native SQLite BEGIN/COMMIT/ROLLBACK, so a rollback
 * proven here against `bun:sqlite` is the same mechanism `dbRunStore.flush` relies on; only the
 * driver underneath (expo-sqlite vs. bun:sqlite) differs, not the transaction semantics.
 */
function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
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
      event_log_json text,
      motion_permission text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE run_points (
      run_id text NOT NULL,
      seq integer NOT NULL,
      timestamp text NOT NULL,
      lat real NOT NULL,
      lng real NOT NULL,
      altitude real,
      accuracy real,
      altitude_accuracy real,
      speed real,
      segment_seq integer NOT NULL,
      PRIMARY KEY (run_id, seq),
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
    CREATE TABLE run_altitude_samples (
      run_id text NOT NULL,
      seq integer NOT NULL,
      at text NOT NULL,
      sensor_timestamp_s real,
      pressure_hpa real NOT NULL,
      relative_altitude_m real,
      epoch integer NOT NULL,
      segment_seq integer NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
    CREATE TABLE run_log (
      run_id text NOT NULL,
      seq integer NOT NULL,
      at text NOT NULL,
      kind text NOT NULL,
      detail_json text,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
    CREATE TABLE active_run_snapshot (
      id integer PRIMARY KEY NOT NULL,
      state_json text NOT NULL,
      updated_at text NOT NULL,
      CONSTRAINT active_run_snapshot_singleton CHECK (id = 1)
    );
  `);
  const db = drizzle(sqlite);
  db.insert(runs)
    .values({
      id: 'run-1',
      sessionKey: 'w1d1',
      status: 'active',
      startedAt: '2026-08-04T09:00:00.000Z',
      endedAt: '2026-08-04T09:00:00.000Z',
      activeDurationS: 0,
      createdAt: '2026-08-04T09:00:00.000Z',
      updatedAt: '2026-08-04T09:00:00.000Z',
    })
    .run();
  return db;
}

const POINT: RunPoint = {
  seq: 0,
  timestamp: '2026-08-04T09:00:00.000Z',
  lat: 59,
  lng: 18,
  altitude: 10,
  accuracy: 5,
  altitudeAccuracy: 2,
  speed: 1,
  segmentSeq: 0,
};

const SAMPLE: PendingSample = {
  seq: 0,
  at: Date.parse('2026-08-04T09:00:00.000Z'),
  sensorTimestampS: 1,
  pressureHpa: 1013,
  relativeAltitudeM: 0,
  epoch: 0,
  segmentSeq: 0,
};

const ENTRY: PendingEntry = {
  seq: 0,
  at: Date.parse('2026-08-04T09:00:00.000Z'),
  kind: 'tick',
  detailJson: null,
};

describe('writeFlush atomicity', () => {
  test('a mid-transaction failure leaves no GPS points, samples, or entries committed for that flush', () => {
    const db = makeDb();
    // `kind` is NOT NULL; forcing it null fails the entries insert, which runs after points and
    // samples inside the same transaction — proving a later write's failure undoes the earlier ones.
    const badEntry = { ...ENTRY, kind: null } as unknown as PendingEntry;
    expect(() =>
      db.transaction((tx) =>
        writeFlush(
          tx,
          'run-1',
          [POINT],
          [SAMPLE],
          [badEntry],
          JSON.stringify({ sessionKey: 'w1d1' }),
          '2026-08-04T09:00:00.000Z',
        ),
      ),
    ).toThrow();
    expect(db.select().from(runPoints).all()).toEqual([]);
    expect(db.select().from(runAltitudeSamples).all()).toEqual([]);
    expect(db.select().from(runLog).all()).toEqual([]);
    expect(db.select().from(activeRunSnapshot).all()).toEqual([]);
  });

  test('a successful flush commits points, samples, entries and the snapshot together', () => {
    const db = makeDb();
    db.transaction((tx) =>
      writeFlush(
        tx,
        'run-1',
        [POINT],
        [SAMPLE],
        [ENTRY],
        JSON.stringify({ sessionKey: 'w1d1' }),
        '2026-08-04T09:00:00.000Z',
      ),
    );
    expect(db.select().from(runPoints).all()).toHaveLength(1);
    expect(db.select().from(runAltitudeSamples).all()).toHaveLength(1);
    expect(db.select().from(runLog).all()).toHaveLength(1);
    expect(db.select().from(activeRunSnapshot).all()).toHaveLength(1);
  });
});
