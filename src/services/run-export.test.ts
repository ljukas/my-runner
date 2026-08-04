import { Database } from 'bun:sqlite';
import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import { runs } from '@/db/schema';

const RUN_COMPLETED = 'run-completed';
const RUN_ACTIVE = 'run-active';

// Deliberately non-contiguous and out of array-index order: a positional-index bug (`index` from
// `.map`) would renumber these 0,1,2 — this fixture only passes if the real `run_points.seq` is
// the value that lands in the export.
const FIXTURE_POINTS = [
  {
    seq: 5,
    segmentSeq: 0,
    timestamp: Date.parse('2026-08-04T09:00:05.000Z'),
    lat: 59.1,
    lng: 18.1,
    altitude: 10,
    accuracy: 5,
    altitudeAccuracy: 2,
    speed: 1,
  },
  {
    seq: 9,
    segmentSeq: 0,
    timestamp: Date.parse('2026-08-04T09:00:09.000Z'),
    lat: 59.2,
    lng: 18.2,
    altitude: 11,
    accuracy: 5,
    altitudeAccuracy: 2,
    speed: 1,
  },
  {
    seq: 12,
    segmentSeq: 1,
    timestamp: Date.parse('2026-08-04T09:00:12.000Z'),
    lat: 59.3,
    lng: 18.3,
    altitude: 12,
    accuracy: 5,
    altitudeAccuracy: 2,
    speed: 1,
  },
];

let capturedText = '';
let exportRun: (runId: string) => Promise<'shared' | 'unavailable' | 'failed'>;

// why mock.module, not a Metro build: `@/db/client` opens a real expo-sqlite database at import
// time, and expo-constants/expo-file-system/expo-sharing/expo-updates/react-native are native
// modules — none reachable from `bun test`'s plain Node-style resolution (same reasoning as
// services/health/sync.test.ts). One shared mock + one dynamic import for the whole file, so both
// tests below exercise the same mocked module without relying on re-import semantics.
beforeAll(async () => {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite);
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
    CREATE TABLE run_segments (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      seq integer NOT NULL,
      kind text NOT NULL,
      planned_duration_s integer NOT NULL,
      actual_duration_s integer NOT NULL,
      distance_m real,
      was_skipped integer DEFAULT false NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
  `);
  const base = {
    sessionKey: 'w1d1',
    startedAt: '2026-08-04T09:00:00.000Z',
    endedAt: '2026-08-04T09:30:00.000Z',
    activeDurationS: 1800,
    createdAt: '2026-08-04T09:00:00.000Z',
    updatedAt: '2026-08-04T09:30:00.000Z',
  };
  db.insert(runs)
    .values([
      { id: RUN_COMPLETED, status: 'completed', ...base },
      { id: RUN_ACTIVE, status: 'active', ...base },
    ])
    .run();

  void mock.module('@/db/client', () => ({ db }));
  // Mocking a module specifier is process-global in `bun test`, not scoped to this file — other
  // test files (health/sync.test.ts, health/index.test.ts) mock these same two specifiers with a
  // different shape, and re-mocking a specifier with a narrower shape than an earlier mock has
  // caused "export not found" errors for whichever file's static import gets resolved against the
  // mismatched cached shape. Keeping both files' export keys present here sidesteps that regardless
  // of run order.
  void mock.module('@/db/run-points', () => ({
    loadBufferedRunPoints: () => FIXTURE_POINTS,
    loadRunFixes: () => [],
  }));
  void mock.module('@/db/run-log', () => ({
    loadAltitudeSamples: () => [],
    loadRunLog: () => [],
  }));
  void mock.module('expo-constants', () => ({
    default: { deviceName: 'Test iPhone', expoConfig: { version: '9.9.9' } },
  }));
  void mock.module('expo-updates', () => ({ updateId: null }));
  void mock.module('react-native', () => ({
    Platform: { OS: 'ios', Version: '26.5' },
    AppState: { addEventListener: () => ({ remove: () => {} }) },
  }));
  void mock.module('expo-file-system', () => ({
    Paths: { cache: '/tmp' },
    File: class {
      uri: string;
      constructor(base: string, name: string) {
        this.uri = `${base}/${name}`;
      }
      create() {}
      write(text: string) {
        capturedText = text;
      }
    },
  }));
  void mock.module('expo-sharing', () => ({
    isAvailableAsync: async () => true,
    shareAsync: async () => {},
  }));

  ({ exportRun } = await import('@/services/run-export'));
});

describe('exportRun', () => {
  test('the exported point seq is the stored run_points.seq, not a positional index', async () => {
    const result = await exportRun(RUN_COMPLETED);
    expect(result).toBe('shared');

    const body = capturedText.slice(
      capturedText.indexOf('## points'),
      capturedText.indexOf('## altitude'),
    );
    const seqs = body
      .split('\n')
      .slice(2) // '## points' + column header
      .filter(Boolean)
      .map((row) => Number(row.split(',')[0]));
    expect(seqs).toEqual([5, 9, 12]);
  });

  test('returns "unavailable" for a run that is still active', async () => {
    expect(await exportRun(RUN_ACTIVE)).toBe('unavailable');
  });
});
