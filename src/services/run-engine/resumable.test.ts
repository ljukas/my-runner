import { describe, expect, test } from 'bun:test';

import type { PlanSession } from '@/domain/plan';
import type { RunSnapshotState } from '@/services/run-store/port';
import {
  isSnapshotFresh,
  parseSnapshotState,
  RESUME_GRACE_MS,
  snapshotAliveUntil,
} from './resumable';

const SESSION: PlanSession = {
  key: 'w1d1',
  week: 1,
  day: 1,
  segments: [
    { kind: 'warmup', seconds: 300 },
    { kind: 'run', seconds: 300 },
  ], // total 600s
};

const STATE: RunSnapshotState = {
  sessionKey: 'w1d1',
  events: [
    { type: 'start', at: 1_000_000 },
    { type: 'pause', at: 1_010_000 },
  ],
  lastAnnouncedIndex: 1,
  halfwayFired: false,
  lastAcceptedFix: { timestamp: 1_005_000, lat: 59, lng: 18, altitude: 42, accuracy: 5, speed: 2 },
};

const CORRUPT: [string, unknown][] = [
  ['null', null],
  ['a string', 'nonsense'],
  ['an empty object', {}],
  ['an array', []],
  ['a missing sessionKey', { ...STATE, sessionKey: undefined }],
  ['an empty event log', { ...STATE, events: [] }],
  ['a log that does not start', { ...STATE, events: [{ type: 'pause', at: 1 }] }],
  ['an unknown event type', { ...STATE, events: [{ type: 'boom', at: 1 }] }],
  ['a non-numeric event time', { ...STATE, events: [{ type: 'start', at: 'x' }] }],
  ['a fractional watermark', { ...STATE, lastAnnouncedIndex: 1.5 }],
  ['a non-boolean halfwayFired', { ...STATE, halfwayFired: 'yes' }],
];

describe('parseSnapshotState', () => {
  test('round-trips a real snapshot through JSON', () => {
    expect(parseSnapshotState(JSON.parse(JSON.stringify(STATE)))).toEqual(STATE);
  });

  test.each(CORRUPT)('rejects %s', (_label, value) => {
    expect(parseSnapshotState(value)).toBeNull();
  });

  test('rejects a log that already ended — its run was finalized', () => {
    expect(
      parseSnapshotState({ ...STATE, events: [...STATE.events, { type: 'end', at: 1_020_000 }] }),
    ).toBeNull();
  });

  test('a garbage anchor degrades to null instead of failing the whole snapshot', () => {
    expect(
      parseSnapshotState({ ...STATE, lastAcceptedFix: { lat: 'x' } })?.lastAcceptedFix,
    ).toBeNull();
  });

  describe('lastAcceptedFix.altitudeAccuracy — three-state passthrough', () => {
    test('a negative number survives verbatim (CoreLocation: negative means altitude invalid)', () => {
      const raw = { ...STATE, lastAcceptedFix: { ...STATE.lastAcceptedFix, altitudeAccuracy: -1 } };
      const parsed = parseSnapshotState(JSON.parse(JSON.stringify(raw)));
      expect(parsed?.lastAcceptedFix?.altitudeAccuracy).toBe(-1);
    });

    test('an explicit null survives as null', () => {
      const raw = {
        ...STATE,
        lastAcceptedFix: { ...STATE.lastAcceptedFix, altitudeAccuracy: null },
      };
      const parsed = parseSnapshotState(JSON.parse(JSON.stringify(raw)));
      expect(parsed?.lastAcceptedFix?.altitudeAccuracy).toBeNull();
    });

    test('an absent field stays absent, not coerced to null', () => {
      // STATE.lastAcceptedFix carries no altitudeAccuracy key — an older snapshot's shape.
      const parsed = parseSnapshotState(JSON.parse(JSON.stringify(STATE)));
      expect(parsed?.lastAcceptedFix?.altitudeAccuracy).toBeUndefined();
    });
  });

  describe('logSeq — the instrumentation resume watermark', () => {
    test('survives the JSON round-trip, so a resumed run continues its own numbering', () => {
      const raw = { ...STATE, logSeq: { sampleSeq: 12, entrySeq: 340 } };
      expect(parseSnapshotState(JSON.parse(JSON.stringify(raw)))?.logSeq).toEqual({
        sampleSeq: 12,
        entrySeq: 340,
      });
    });

    test('stays absent for a pre-slice snapshot rather than being zeroed', () => {
      // Zeroing it would re-mint `seq`s the run already stored, faking a clean stretch (spec §5.1).
      expect(parseSnapshotState(JSON.parse(JSON.stringify(STATE)))?.logSeq).toBeUndefined();
    });

    test('a garbage watermark degrades to absent instead of failing the whole snapshot', () => {
      const parsed = parseSnapshotState({ ...STATE, logSeq: { sampleSeq: 1.5, entrySeq: 'x' } });
      expect(parsed).not.toBeNull();
      expect(parsed?.logSeq).toBeUndefined();
    });
  });
});

describe('isSnapshotFresh', () => {
  const stampedAt = 2_000_000_000_000;
  const stamped = new Date(stampedAt).toISOString();
  const limit = 600 * 1000 + RESUME_GRACE_MS;

  test('is fresh just inside the planned length + grace window', () => {
    expect(isSnapshotFresh(stamped, SESSION, stampedAt + limit - 1)).toBe(true);
  });

  test('is stale at and past the window', () => {
    expect(isSnapshotFresh(stamped, SESSION, stampedAt + limit)).toBe(false);
    expect(isSnapshotFresh(stamped, SESSION, stampedAt + limit + 60_000)).toBe(false);
  });

  test('a stamp in the future is never fresh (backwards device clock)', () => {
    expect(isSnapshotFresh(stamped, SESSION, stampedAt - 1)).toBe(false);
  });

  test('an unparseable timestamp is never fresh', () => {
    expect(isSnapshotFresh('not-a-date', SESSION, stampedAt)).toBe(false);
  });
});

describe('snapshotAliveUntil', () => {
  const stampedAt = 2_000_000_000_000;
  const stamped = new Date(stampedAt).toISOString();

  test('is the flush stamp, however long ago the process died', () => {
    expect(snapshotAliveUntil(stamped, stampedAt + 30 * 60 * 1000)).toBe(stampedAt);
  });

  test('never runs ahead of now (forwards device clock)', () => {
    expect(snapshotAliveUntil(stamped, stampedAt - 5000)).toBe(stampedAt - 5000);
  });

  test('falls back to now for an unparseable stamp', () => {
    expect(snapshotAliveUntil('not-a-date', stampedAt)).toBe(stampedAt);
  });
});
