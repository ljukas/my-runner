import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { and, asc, eq, gt, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runPolicy } from '@/domain/free-run';
import { EARTH_RADIUS_M } from '@/domain/geo';
import { bandsFor } from '@/domain/profile-bands';
import { foldRunProfile } from '@/domain/run-profile';
import type { CompletedRunRecord } from '@/services/run-engine/types';
import { deleteRunTree, saveDerivedRun, writeDerivedFinalize } from './derived-finalize';
import { runAltitudeSamples, runLog, runPoints, runSegments, runs } from './schema';

const MIGRATIONS = join(import.meta.dir, 'migrations');
const T = 2.1;
const DEG_PER_M = 180 / (Math.PI * EARTH_RADIUS_M);
const iso = (ms: number) => new Date(ms).toISOString();

/** A real schema: the app's own migrations, with foreign keys enforced as on device. */
function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    for (const statement of readFileSync(join(MIGRATIONS, file), 'utf8').split(
      '--> statement-breakpoint',
    )) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
  return drizzle(sqlite);
}

type Db = ReturnType<typeof makeDb>;

/** An in-flight free run: its 'active' row, 1 Hz points walking then running, and a barometer sample per point. */
function seed(db: Db, legs: readonly [number, number][]) {
  db.insert(runs)
    .values({
      id: 'r',
      sessionKey: 'free-run',
      status: 'active',
      startedAt: iso(0),
      endedAt: iso(0),
      activeDurationS: 0,
      createdAt: iso(0),
      updatedAt: iso(0),
    })
    .run();
  let t = 0;
  let north = 0;
  let seq = 0;
  for (const [seconds, mps] of legs) {
    for (let s = 0; s < seconds; s += 1) {
      t += 1000;
      north += mps;
      db.insert(runPoints)
        .values({
          runId: 'r',
          seq,
          timestamp: iso(t),
          lat: 59 + north * DEG_PER_M,
          lng: 18,
          accuracy: 5,
          segmentSeq: 0,
        })
        .run();
      db.insert(runAltitudeSamples)
        .values({ runId: 'r', seq, at: iso(t), pressureHpa: 1013, epoch: 0, segmentSeq: 0 })
        .run();
      seq += 1;
    }
  }
  db.insert(runLog)
    .values({ runId: 'r', seq: 0, at: iso(0), kind: 'tick' })
    .run();
  return t;
}

function record(endMs: number): CompletedRunRecord {
  return {
    sessionKey: 'free-run',
    status: 'completed',
    startedAt: iso(0),
    endedAt: iso(endMs),
    activeDurationS: Math.round(endMs / 1000),
    segments: [],
    eventLogJson: JSON.stringify([
      { type: 'start', at: 0 },
      { type: 'end', at: endMs },
    ]),
    derived: { thresholdMps: T },
  };
}

const ctx = () => {
  let n = 0;
  return { nowIso: iso(9e12), newId: () => `seg-${(n += 1)}` };
};

const finalize = (db: Db, endMs: number) =>
  db.transaction((tx) => writeDerivedFinalize(tx, 'r', record(endMs), ctx()));

describe('writeDerivedFinalize', () => {
  test('saves the buckets as segment rows that add up to the run', () => {
    const db = makeDb();
    const end = seed(db, [
      [90, 1.5],
      [90, 2.6],
    ]);
    expect(finalize(db, end)).toBe('saved');
    const run = db.select().from(runs).get()!;
    const rows = db.select().from(runSegments).orderBy(asc(runSegments.seq)).all();
    expect(run.status).toBe('completed');
    expect(rows.map((row) => row.kind)).toEqual(['walk', 'run']);
    expect(rows.reduce((sum, row) => sum + (row.distanceM ?? 0), 0)).toBeCloseTo(run.distanceM!, 6);
    expect(rows.reduce((sum, row) => sum + row.actualDurationS, 0)).toBe(run.activeDurationS);
  });

  test('tags every point and sample with its bucket, a fix on a boundary closing the earlier one', () => {
    const db = makeDb();
    const end = seed(db, [
      [90, 1.5],
      [90, 2.6],
    ]);
    finalize(db, end);
    const boundary = db.select().from(runSegments).where(eq(runSegments.seq, 1)).get()!;
    const points = db.select().from(runPoints).orderBy(asc(runPoints.seq)).all();
    const runStart = points.findIndex((p) => p.segmentSeq === 1);
    expect(boundary).toBeDefined();
    expect(runStart).toBeGreaterThan(0);
    // contiguous: every point before the boundary is 0, every point after is 1
    expect(points.slice(0, runStart).every((p) => p.segmentSeq === 0)).toBe(true);
    expect(points.slice(runStart).every((p) => p.segmentSeq === 1)).toBe(true);
    const samples = db.select().from(runAltitudeSamples).orderBy(asc(runAltitudeSamples.seq)).all();
    expect(samples.map((s) => s.segmentSeq)).toEqual(points.map((p) => p.segmentSeq));
  });

  test('trims a trailing stop: the points and samples after the end are deleted', () => {
    const db = makeDb();
    const end = seed(db, [
      [120, 2.6],
      [1900, 0],
    ]);
    finalize(db, end);
    const run = db.select().from(runs).get()!;
    const endMs = Date.parse(run.endedAt);
    expect(endMs).toBeLessThan(130_000);
    expect(
      db
        .select()
        .from(runPoints)
        .all()
        .every((p) => Date.parse(p.timestamp) <= endMs),
    ).toBe(true);
    expect(
      db
        .select()
        .from(runAltitudeSamples)
        .all()
        .every((s) => Date.parse(s.at) <= endMs),
    ).toBe(true);
    expect(JSON.parse(run.eventLogJson!).at(-1)).toEqual({ type: 'end', at: endMs });
  });

  test('a run left under a minute is deleted with everything it owns', () => {
    const db = makeDb();
    const end = seed(db, [[40, 2.6]]);
    expect(finalize(db, end)).toBe('discarded');
    expect(db.select().from(runs).all()).toEqual([]);
    expect(db.select().from(runPoints).all()).toEqual([]);
    expect(db.select().from(runAltitudeSamples).all()).toEqual([]);
    expect(db.select().from(runLog).all()).toEqual([]);
  });

  test('finalizing twice gives the same rows (a crash-recovery re-finalize)', () => {
    const db = makeDb();
    const end = seed(db, [
      [90, 1.5],
      [90, 2.6],
    ]);
    finalize(db, end);
    const strip = (rows: { id: string }[]) => rows.map(({ id: _id, ...rest }) => rest);
    const first = {
      segs: strip(db.select().from(runSegments).all()),
      pts: db.select().from(runPoints).all(),
    };
    finalize(db, end);
    expect(strip(db.select().from(runSegments).all())).toEqual(first.segs);
    expect(db.select().from(runPoints).all()).toEqual(first.pts);
  });
});

describe('the saved buckets on the pace chart (ADR 0026 §5)', () => {
  test('the strip tiles the saved distance and the stop sits where the runner stood', () => {
    const db = makeDb();
    const end = seed(db, [
      [200, 2.6],
      [60, 0],
      [120, 1.4],
      [150, 2.6],
    ]);
    finalize(db, end);
    const run = db.select().from(runs).get()!;
    const rows = db.select().from(runSegments).orderBy(asc(runSegments.seq)).all();
    const fixes = db
      .select()
      .from(runPoints)
      .orderBy(asc(runPoints.seq))
      .all()
      .map((p) => ({ ...p, timestamp: Date.parse(p.timestamp), speed: null }));

    const { spans } = foldRunProfile(fixes, { policy: runPolicy('free-run', []) });
    const bands = bandsFor('free-run', spans, rows)!;

    expect(bands.runWalk.map((band) => band.kind)).toEqual(['run', 'walk', 'run']);
    expect(bands.runWalk.at(-1)!.toM).toBeCloseTo(run.distanceM!, 6);
    expect(bands.stopsAtM).toHaveLength(1);
    expect(Math.abs(bands.stopsAtM[0] - 200 * 2.6)).toBeLessThan(15);
    expect(bands.silencesAtM).toEqual([]);
  });

  test('a tunnel is a silence, not a stop', () => {
    const db = makeDb();
    const end = seed(db, [[400, 2.6]]);
    db.delete(runPoints)
      .where(and(gt(runPoints.timestamp, iso(200_000)), lte(runPoints.timestamp, iso(260_000))))
      .run();
    finalize(db, end);
    const rows = db.select().from(runSegments).orderBy(asc(runSegments.seq)).all();
    const fixes = db
      .select()
      .from(runPoints)
      .orderBy(asc(runPoints.seq))
      .all()
      .map((p) => ({ ...p, timestamp: Date.parse(p.timestamp), speed: null }));

    const { spans } = foldRunProfile(fixes, { policy: runPolicy('free-run', []) });
    const bands = bandsFor('free-run', spans, rows)!;

    expect(rows.map((row) => row.kind)).toContain('stopped');
    expect(bands.stopsAtM).toEqual([]);
    expect(bands.silencesAtM).toHaveLength(1);
  });
});

describe('writeDerivedFinalize — a log with no end event', () => {
  test('keeps its pauses, and ends where the record does', () => {
    const db = makeDb();
    seed(db, [[200, 2.6]]);
    const paused: CompletedRunRecord = {
      ...record(200_000),
      eventLogJson: JSON.stringify([
        { type: 'start', at: 0 },
        { type: 'pause', at: 60_000 },
        { type: 'resume', at: 120_000 },
      ]),
    };
    db.transaction((tx) => writeDerivedFinalize(tx, 'r', paused, ctx()));
    const run = db.select().from(runs).get()!;
    expect(run.activeDurationS).toBe(140);
    expect(JSON.parse(run.eventLogJson!).map((e: { type: string }) => e.type)).toEqual([
      'start',
      'pause',
      'resume',
      'end',
    ]);
  });
});

describe('saveDerivedRun — a free run with no in-flight row', () => {
  test('writes the run, derived from its log alone', () => {
    const db = makeDb();
    const outcome = db.transaction((tx) => saveDerivedRun(tx, 'new', record(300_000), ctx()));
    expect(outcome).toBe('saved');
    expect(db.select().from(runs).get()).toMatchObject({
      id: 'new',
      sessionKey: 'free-run',
      status: 'completed',
      activeDurationS: 300,
      distanceM: null,
    });
  });

  test('keeps the live distance, having no points to derive one from', () => {
    const db = makeDb();
    db.transaction((tx) =>
      saveDerivedRun(tx, 'new', { ...record(300_000), distanceM: 812.5 }, ctx()),
    );
    expect(db.select().from(runs).get()?.distanceM).toBe(812.5);
  });

  test('writes nothing for a run under a minute', () => {
    const db = makeDb();
    const outcome = db.transaction((tx) => saveDerivedRun(tx, 'new', record(40_000), ctx()));
    expect(outcome).toBe('discarded');
    expect(db.select().from(runs).all()).toEqual([]);
  });
});

describe('deleteRunTree', () => {
  test('removes a run and its children without tripping a foreign key', () => {
    const db = makeDb();
    seed(db, [[30, 1.5]]);
    db.transaction((tx) => deleteRunTree(tx, 'r'));
    expect(db.select().from(runs).all()).toEqual([]);
    expect(db.select().from(runPoints).all()).toEqual([]);
  });
});
