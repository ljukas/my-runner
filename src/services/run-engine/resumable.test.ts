import { describe, expect, test } from 'bun:test';

import type { PlanSession } from '@/domain/plan';
import type { RunSnapshotState } from '@/services/run-store/port';
import { isSnapshotFresh, parseSnapshotState, RESUME_GRACE_MS } from './resumable';

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
