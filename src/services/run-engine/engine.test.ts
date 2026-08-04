import { describe, expect, test } from 'bun:test';

import type { CueId } from '@/domain/cues';
import {
  smoothTrack,
  smoothTrackBySegment,
  type LocationFix,
  type SegmentedFix,
} from '@/domain/geo';
import type { PlanSession } from '@/domain/plan';
import type { CueService } from '@/services/cue-service/port';
import type {
  AltitudeReading,
  ElevationSource,
  MotionPermissionStatus,
} from '@/services/elevation';
import type { LocationTracker } from '@/services/location-tracker/port';
import type { RunPoint, RunSnapshotState, RunStore } from '@/services/run-store/port';
import { endCountsAsCompleted, isTimelineExhausted, RunEngine } from './engine';
import type { PointBatchScheduler } from './point-batch-scheduler';
import { parseSnapshotState } from './resumable';
import type { PendingEntry, PendingSample } from './run-log';
import type {
  BufferedRunPoint,
  CompletedRunRecord,
  RunLifecyclePersistence,
  StepCounter,
} from './types';

/** A recording fake so cue firing can be asserted without expo-speech/audio. */
function makeFakeCue() {
  const cues: CueId[] = [];
  let prepared = 0;
  let released = 0;
  const cue: CueService = {
    prepare: () => void prepared++,
    announce: (c) => void cues.push(c),
    release: () => void released++,
  };
  return {
    cue,
    cues,
    prepareCount: () => prepared,
    releaseCount: () => released,
  };
}

/** A recording fake barometer: the engine subscribes once, so `emit` is how a reading arrives. */
function fakeElevation() {
  const listeners = new Set<(reading: AltitudeReading) => void>();
  const calls: string[] = [];
  const source: ElevationSource = {
    isAvailable: async () => true,
    requestPermission: async () => 'granted',
    getPermissionStatus: async () => 'granted',
    start: async () => void calls.push('start'),
    stop: async () => void calls.push('stop'),
    onReading: (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
  return {
    calls,
    source,
    emit: (reading: AltitudeReading) => listeners.forEach((listener) => listener(reading)),
  };
}

const SESSION: PlanSession = {
  key: 'w1d1',
  week: 1,
  day: 1,
  segments: [
    { kind: 'warmup', seconds: 10 },
    { kind: 'run', seconds: 20 },
    { kind: 'walk', seconds: 15 },
    { kind: 'run', seconds: 20 },
    { kind: 'cooldown', seconds: 10 },
  ], // total 75
};

const FIX_START = 1_000_000; // makeEngine's initial clock — the run's start event lands here

function fixAt(offsetSec: number, lat: number, lng: number, accuracy = 5): LocationFix {
  return {
    timestamp: FIX_START + Math.round(offsetSec * 1000),
    lat,
    lng,
    altitude: 42,
    accuracy,
    speed: 2,
  };
}

function readingAt(offsetSec: number, pressureHpa: number): AltitudeReading {
  return {
    at: FIX_START + offsetSec * 1000,
    sensorTimestampS: offsetSec,
    pressureHpa,
    relativeAltitudeM: 0,
    epoch: 1,
  };
}

// ~2 m/s northbound at 1 Hz, 6 fixes, all inside warmup [0,10) of SESSION.
const WALK_TRACK: LocationFix[] = Array.from({ length: 6 }, (_, i) =>
  fixAt(i, 59 + i * 0.000018, 18),
);

/** A snapshot state whose log is nothing but a start event at `FIX_START`. */
function stateAtStart(overrides: Partial<RunSnapshotState> = {}): RunSnapshotState {
  return {
    sessionKey: 'w1d1',
    events: [{ type: 'start', at: FIX_START }],
    lastAnnouncedIndex: 0,
    halfwayFired: false,
    lastAcceptedFix: null,
    ...overrides,
  };
}

/** The `run_points` read path the composition root feeds `restore()`: ISO column → epoch ms. */
function fromRunPoint(point: RunPoint): BufferedRunPoint {
  return { ...point, timestamp: new Date(point.timestamp).getTime() };
}

function toSegmented(point: BufferedRunPoint): SegmentedFix {
  return {
    timestamp: point.timestamp,
    lat: point.lat,
    lng: point.lng,
    altitude: point.altitude,
    accuracy: point.accuracy,
    speed: point.speed,
    segmentSeq: point.segmentSeq,
  };
}

/** Captures console.warn for tests that exercise a warned failure path. */
async function withoutWarnings(body: () => Promise<void>): Promise<number> {
  const original = console.warn;
  let count = 0;
  console.warn = () => void count++;
  try {
    await body();
  } finally {
    console.warn = original;
  }
  return count;
}

function makeEngine(
  options: {
    deferStartRun?: boolean;
    failStartRunTimes?: number;
    elevation?: ElevationSource;
    stepCounter?: StepCounter;
    nativeTimeoutMs?: number;
  } = {},
) {
  let now = 1_000_000;
  const calls: string[] = [];
  const saved: CompletedRunRecord[] = [];
  const finalized: { runId: string; record: CompletedRunRecord }[] = [];
  const flushes: {
    runId: string;
    points: RunPoint[];
    samples: PendingSample[];
    entries: PendingEntry[];
    state: RunSnapshotState;
  }[] = [];
  const trackerCalls: string[] = [];
  let startRunFailures = options.failStartRunTimes ?? 0;
  let failSave = false;
  let failFlush = false;
  let deferFinalize = false;
  let deferFlush = false;
  let gateStartRun: (() => void) | undefined;
  let gateFinalize: (() => void) | undefined;
  let gateFlush: (() => void) | undefined;

  const persistence: RunLifecyclePersistence = {
    saveRun: async (record) => {
      calls.push('saveRun');
      if (failSave) throw new Error('db down');
      saved.push(record);
      return 'run-1';
    },
    startRun: async () => {
      calls.push('startRun');
      if (options.deferStartRun) await new Promise<void>((resolve) => (gateStartRun = resolve));
      if (startRunFailures > 0) {
        startRunFailures -= 1;
        throw new Error('db down');
      }
      return 'run-1';
    },
    finalizeRun: async (runId, record) => {
      calls.push('finalizeRun');
      if (deferFinalize) await new Promise<void>((resolve) => (gateFinalize = resolve));
      if (failSave) throw new Error('db down');
      finalized.push({ runId, record });
      saved.push(record); // `saved` covers either persistence path, so record assertions stay one shape
    },
  };

  const runStore: RunStore = {
    flush: async (runId, points, samples, entries, state) => {
      calls.push('flush');
      if (deferFlush) await new Promise<void>((resolve) => (gateFlush = resolve));
      if (failFlush) throw new Error('flush rejected');
      flushes.push({ runId, points, samples, entries, state });
    },
    loadSnapshot: async () => null,
    clearSnapshot: async () => void calls.push('clearSnapshot'),
  };

  const tracker: LocationTracker = {
    requestPermission: async () => 'granted',
    getPermissionStatus: async () => 'granted',
    start: async () => void trackerCalls.push('start'),
    stop: async () => void trackerCalls.push('stop'),
    onFix: () => () => {},
  };

  let armCount = 0;
  let schedulerStops = 0;
  let fireFlush = (): void => {};
  const createScheduler = (flushNow: () => void): PointBatchScheduler => {
    fireFlush = flushNow;
    return { arm: () => void armCount++, stop: () => void schedulerStops++ };
  };

  const fakeCue = makeFakeCue();
  const fakeBarometer = fakeElevation();
  let stepCounterReturn: number | null = 0;
  const stepCounterCalls: { start: Date; end: Date }[] = [];
  const stepCounter: StepCounter =
    options.stepCounter ??
    (async (start, end) => {
      stepCounterCalls.push({ start, end });
      return stepCounterReturn;
    });
  const engine = new RunEngine({
    persistence,
    runStore,
    tracker,
    cue: fakeCue.cue,
    elevation: options.elevation ?? fakeBarometer.source,
    stepCounter,
    clock: () => now,
    createScheduler,
    nativeTimeoutMs: options.nativeTimeoutMs,
  });
  return {
    engine,
    calls,
    elevationCalls: fakeBarometer.calls,
    emitReading: fakeBarometer.emit,
    stepCounterCalls,
    setStepCounterReturn: (v: number | null) => (stepCounterReturn = v),
    saved,
    finalized,
    flushes,
    trackerCalls,
    cues: fakeCue.cues,
    prepareCount: fakeCue.prepareCount,
    releaseCount: fakeCue.releaseCount,
    armCount: () => armCount,
    schedulerStops: () => schedulerStops,
    flushedSeqs: () => flushes.flatMap((f) => f.points.map((p) => p.seq)),
    flushedPoints: () => flushes.flatMap((f) => f.points),
    flushedSamples: () => flushes.flatMap((f) => f.samples),
    flushedEntries: () => flushes.flatMap((f) => f.entries),
    lastFlush: () => flushes[flushes.length - 1],
    setFailSave: (v: boolean) => (failSave = v),
    setFailFlush: (v: boolean) => (failFlush = v),
    deferFinalize: () => (deferFinalize = true),
    deferFlush: () => (deferFlush = true),
    releaseStartRun: () => gateStartRun?.(),
    releaseFinalize: () => gateFinalize?.(),
    releaseFlush: () => gateFlush?.(),
    fireFlush: () => fireFlush(),
    setNow: (value: number) => (now = value),
    tick: (seconds: number) => {
      now += seconds * 1000;
      engine.heartbeat();
    },
    advance: (seconds: number) => (now += seconds * 1000),
    // Drive a fix as production does: the engine's clock is the fix's own timestamp.
    feed: (fix: LocationFix) => {
      now = fix.timestamp;
      engine.heartbeat(fix.timestamp, fix);
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** For the bounded native reads: `flush()` is a microtask drain, and a timeout needs real time. */
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('lifecycle', () => {
  test('start enters the first segment', () => {
    const { engine } = makeEngine();
    engine.start(SESSION);
    const s = engine.getSnapshot();
    expect(s.status).toBe('running');
    expect(s.sessionKey).toBe('w1d1');
    expect(s.segmentIndex).toBe(0);
    expect(s.segmentKind).toBe('warmup');
    expect(s.segmentSecondsRemaining).toBe(10);
    expect(s.nextSegment).toEqual({ kind: 'run', seconds: 20 });
    expect(s.totalSeconds).toBe(75);
  });

  test('start is ignored unless idle', () => {
    const { engine } = makeEngine();
    engine.start(SESSION);
    engine.start({ ...SESSION, key: 'w9d3' });
    expect(engine.getSnapshot().sessionKey).toBe('w1d1');
  });

  test('heartbeats derive the current segment from elapsed time', () => {
    const { engine, tick } = makeEngine();
    engine.start(SESSION);
    tick(12); // 12s → 2s into the run segment
    const s = engine.getSnapshot();
    expect(s.segmentIndex).toBe(1);
    expect(s.segmentKind).toBe('run');
    expect(s.segmentSecondsRemaining).toBe(18);
    expect(s.activeElapsedSeconds).toBe(12);
  });

  test('a single late heartbeat lands in the right segment (no per-tick accumulation)', () => {
    const { engine, tick } = makeEngine();
    engine.start(SESSION);
    tick(46); // one heartbeat 46s later → segment 3
    expect(engine.getSnapshot().segmentIndex).toBe(3);
  });

  test('reset returns to idle', () => {
    const { engine } = makeEngine();
    engine.start(SESSION);
    engine.reset();
    expect(engine.getSnapshot().status).toBe('idle');
  });
});

describe('pause/resume', () => {
  test('pause freezes active elapsed', () => {
    const { engine, tick, advance } = makeEngine();
    engine.start(SESSION);
    tick(30);
    engine.pause();
    advance(100);
    engine.heartbeat();
    const s = engine.getSnapshot();
    expect(s.status).toBe('paused');
    expect(s.activeElapsedSeconds).toBe(30);
  });

  test('resume continues from where it paused; pauses accumulate', () => {
    const { engine, tick, advance } = makeEngine();
    engine.start(SESSION);
    tick(30);
    engine.pause();
    advance(100);
    engine.resume();
    tick(5); // active 35
    engine.pause();
    advance(50);
    engine.resume();
    tick(2); // active 37
    expect(engine.getSnapshot().activeElapsedSeconds).toBe(37);
    expect(engine.getSnapshot().segmentIndex).toBe(2); // 37 ∈ walk [30, 45)
  });

  test('pause when not running and resume when not paused are ignored', () => {
    const { engine } = makeEngine();
    engine.resume();
    expect(engine.getSnapshot().status).toBe('idle');
    engine.start(SESSION);
    engine.resume();
    expect(engine.getSnapshot().status).toBe('running');
    engine.pause();
    engine.pause();
    expect(engine.getSnapshot().status).toBe('paused');
  });
});

describe('skip', () => {
  test('skip truncates the current segment and moves to the next', () => {
    const { engine, tick } = makeEngine();
    engine.start(SESSION);
    tick(15); // 5s into run
    engine.skipSegment();
    const s = engine.getSnapshot();
    expect(s.segmentIndex).toBe(2);
    expect(s.segmentKind).toBe('walk');
    expect(s.totalSeconds).toBe(60); // run shortened 20→5
    expect(s.activeElapsedSeconds).toBe(15);
  });

  test('skipping the final segment completes the session', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(70); // into cooldown (65–75)
    engine.skipSegment();
    expect(engine.getSnapshot().status).toBe('completed');
    await flush();
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe('completed');
  });
});

describe('completion', () => {
  test('timeline exhaustion completes and persists a correct record', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    h.tick(30);
    h.engine.pause();
    h.engine.resume();
    h.tick(50); // active 80 > 75 → done, capped at 75
    expect(h.engine.getSnapshot().status).toBe('completed');
    expect(h.engine.getSnapshot().activeElapsedSeconds).toBe(75);
    await flush();
    expect(h.engine.getSnapshot().savedRunId).toBe('run-1');
    // The run must land through the points-as-spine lifecycle, never the standalone saveRun path.
    expect(h.calls).toContain('finalizeRun');
    expect(h.calls).not.toContain('saveRun');
    expect(h.finalized[0].runId).toBe('run-1');
    const record = h.saved[0];
    expect(record.sessionKey).toBe('w1d1');
    expect(record.status).toBe('completed');
    expect(record.activeDurationS).toBe(75);
    expect(record.segments).toHaveLength(5);
    expect(record.segments.map((s) => s.actualDurationS)).toEqual([10, 20, 15, 20, 10]);
    expect(record.startedAt).toBe(new Date(1_000_000).toISOString());
  });

  test('endEarly persists a partial run: reached segments only, last one truncated', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    h.tick(12); // 2s into segment 1 (run)
    h.engine.endEarly();
    expect(h.engine.getSnapshot().status).toBe('endedEarly');
    await flush();
    expect(h.calls).toContain('finalizeRun');
    expect(h.calls).not.toContain('saveRun');
    expect(h.finalized[0].runId).toBe('run-1');
    const record = h.saved[0];
    expect(record.status).toBe('partial');
    expect(record.activeDurationS).toBe(12);
    expect(record.segments).toHaveLength(2);
    expect(record.segments[0]).toMatchObject({ seq: 0, kind: 'warmup', actualDurationS: 10 });
    expect(record.segments[1]).toMatchObject({
      seq: 1,
      kind: 'run',
      actualDurationS: 2,
      wasSkipped: false,
    });
  });

  test('skipped segments are recorded with their truncated duration and flag', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(15);
    engine.skipSegment(); // run 20→5
    tick(60); // active 75 ≥ total 60 → completed
    await flush();
    const record = saved[0];
    expect(record.segments[1]).toMatchObject({
      kind: 'run',
      plannedDurationS: 20,
      actualDurationS: 5,
      wasSkipped: true,
    });
  });

  test('a failed save surfaces saveFailed and keeps the snapshot for the next launch', async () => {
    const h = makeEngine();
    h.setFailSave(true);
    const warnings = await withoutWarnings(async () => {
      h.engine.start(SESSION);
      h.tick(80);
      await flush();
    });
    expect(h.engine.getSnapshot().saveFailed).toBe(true);
    expect(h.engine.getSnapshot().savedRunId).toBeNull();
    expect(h.calls).not.toContain('clearSnapshot');
    expect(warnings).toBeGreaterThanOrEqual(1);
  });

  test('a slow save from a superseded run never stamps a later run', async () => {
    const h = makeEngine();
    h.deferFinalize();
    h.engine.start(SESSION);
    h.tick(80); // completes run A; its finalize stays pending
    expect(h.engine.getSnapshot().status).toBe('completed');
    await flush();
    h.engine.reset();
    h.engine.start({ ...SESSION, key: 'w1d2' });
    h.releaseFinalize();
    await flush();
    const s = h.engine.getSnapshot();
    expect(s.savedRunId).toBeNull();
    expect(s.sessionKey).toBe('w1d2');
    expect(s.status).toBe('running');
    expect(h.calls).not.toContain('clearSnapshot'); // it would delete run B's recovery row
  });

  test('controls are inert after completion', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(80);
    await flush();
    engine.pause();
    engine.skipSegment();
    engine.endEarly();
    engine.heartbeat();
    expect(engine.getSnapshot().status).toBe('completed');
    expect(saved).toHaveLength(1);
  });
});

describe('end during the final cooldown (issue #40)', () => {
  test('endEarly during the final cooldown finalizes and persists as completed', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(66); // 1s into the cooldown (65–75)
    engine.endEarly();
    expect(engine.getSnapshot().status).toBe('completed');
    await flush();
    expect(saved[0].status).toBe('completed');
    expect(saved[0].activeDurationS).toBe(66);
    expect(saved[0].segments).toHaveLength(5);
    expect(saved[0].segments[4]).toMatchObject({
      kind: 'cooldown',
      actualDurationS: 1,
      wasSkipped: false,
    });
  });

  test('endEarly while paused in the cooldown still completes', async () => {
    const { engine, tick, advance, saved } = makeEngine();
    engine.start(SESSION);
    tick(70);
    engine.pause();
    advance(100); // paused wall time is not active time
    engine.endEarly();
    expect(engine.getSnapshot().status).toBe('completed');
    await flush();
    expect(saved[0].status).toBe('completed');
    expect(saved[0].activeDurationS).toBe(70);
  });

  test('skipping into the cooldown then ending early completes', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(50); // 5s into the final run (45–65)
    engine.skipSegment(); // truncates it; the cooldown now starts at 50
    tick(2); // 2s into the cooldown
    engine.endEarly();
    expect(engine.getSnapshot().status).toBe('completed');
    await flush();
    expect(saved[0].status).toBe('completed');
  });

  test('endEarly after timeline exhaustion but before the next heartbeat completes', async () => {
    const { engine, advance, saved } = makeEngine();
    engine.start(SESSION);
    advance(80); // past the 75s total, with no heartbeat observing it
    engine.endEarly();
    expect(engine.getSnapshot().status).toBe('completed');
    await flush();
    expect(saved[0].status).toBe('completed');
    expect(saved[0].activeDurationS).toBe(75); // capped at the timeline (ADR 0007)
  });

  test('endEarly exactly at the cooldown boundary completes; the untouched cooldown row is dropped', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(65); // exactly at the cooldown's startsAt
    engine.endEarly();
    expect(engine.getSnapshot().status).toBe('completed');
    await flush();
    expect(saved[0].status).toBe('completed');
    expect(saved[0].segments).toHaveLength(4); // the 0-second cooldown row is filtered out
  });

  test('endEarly just before the cooldown stays partial', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(64); // 19s into the final run (45–65)
    engine.endEarly();
    expect(engine.getSnapshot().status).toBe('endedEarly');
    await flush();
    expect(saved[0].status).toBe('partial');
  });

  test('endCountsAsCompleted mirrors the engine rule on live snapshots (UI twin)', () => {
    const { engine, tick } = makeEngine();
    engine.start(SESSION);
    tick(64); // final run segment
    expect(endCountsAsCompleted(engine.getSnapshot())).toBe(false);
    tick(2); // 66 → in the cooldown
    expect(endCountsAsCompleted(engine.getSnapshot())).toBe(true);
  });
});

describe('clock anomalies (ADR 0007 invariants)', () => {
  test('a backwards clock jump never produces negative elapsed', () => {
    const { engine, advance } = makeEngine();
    engine.start(SESSION);
    advance(-500); // clock jumps back
    engine.heartbeat();
    expect(engine.getSnapshot().activeElapsedSeconds).toBeGreaterThanOrEqual(0);
    expect(engine.getSnapshot().status).toBe('running');
  });

  test('a forward jump can only end the session as completed, capped at the timeline', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(100_000);
    expect(engine.getSnapshot().status).toBe('completed');
    await flush();
    expect(saved[0].activeDurationS).toBe(75);
  });
});

describe('subscription', () => {
  test('subscribers are notified on change and can unsubscribe', () => {
    const { engine, tick } = makeEngine();
    let calls = 0;
    const unsubscribe = engine.subscribe(() => calls++);
    engine.start(SESSION);
    tick(1);
    expect(calls).toBeGreaterThanOrEqual(2);
    const before = calls;
    unsubscribe();
    tick(1);
    expect(calls).toBe(before);
  });

  test('getSnapshot is referentially stable between changes', () => {
    const { engine } = makeEngine();
    engine.start(SESSION);
    expect(engine.getSnapshot()).toBe(engine.getSnapshot());
  });
});

describe('cues (ADR 0007/0009)', () => {
  test('start prepares the session and announces the warm-up', () => {
    const { engine, cues, prepareCount } = makeEngine();
    engine.start(SESSION);
    expect(prepareCount()).toBe(1);
    expect(cues).toEqual(['warmupStart']);
  });

  test('each segment transition announces the entered segment cue', () => {
    const { engine, cues, tick } = makeEngine();
    engine.start(SESSION); // warmupStart @ index 0
    tick(10); // → run   (index 1)
    tick(20); // → walk  (index 2, now 30)
    expect(cues).toEqual(['warmupStart', 'startRun', 'startWalk']);
  });

  test('a transition is announced once, not on every heartbeat in the segment', () => {
    const { engine, cues, tick } = makeEngine();
    engine.start(SESSION);
    tick(12); // into run → startRun
    tick(1);
    tick(1);
    expect(cues.filter((c) => c === 'startRun')).toHaveLength(1);
  });

  test('the final run is announced as lastRun, not a generic startRun', () => {
    const { engine, cues, tick } = makeEngine();
    engine.start(SESSION);
    tick(10); // run   (index 1) → startRun
    tick(20); // walk  (index 2)
    tick(15); // run   (index 3, the last run) → lastRun
    expect(cues).toContain('lastRun');
    expect(cues.filter((c) => c === 'startRun')).toHaveLength(1);
  });

  test('halfway fires exactly once when elapsed crosses 50% of planned total', () => {
    const { engine, cues, tick } = makeEngine();
    engine.start(SESSION); // planned total 75 → halfway at 37.5s
    tick(37);
    expect(cues).not.toContain('halfway');
    tick(1); // 38 ≥ 37.5
    tick(1); // 39
    expect(cues.filter((c) => c === 'halfway')).toHaveLength(1);
  });

  // Pins the trigger contract behind issue #41: W3's halfway lands exactly on
  // a walk→run segment boundary, so one heartbeat announces BOTH cues, in
  // order. Handling that coincidence is the adapter's job (release-scheduler);
  // the engine must never drop one of them.
  test('halfway landing exactly on a segment boundary announces both cues in one heartbeat', () => {
    const { engine, cues, tick } = makeEngine();
    engine.start({
      key: 'w3d1',
      week: 3,
      day: 1,
      segments: [
        { kind: 'warmup', seconds: 10 },
        { kind: 'run', seconds: 10 },
        { kind: 'walk', seconds: 10 },
        { kind: 'run', seconds: 10 },
      ], // total 40 → halfway at 20, exactly the run→walk boundary
    });
    tick(20); // one heartbeat onto the boundary
    expect(cues).toEqual(['warmupStart', 'startWalk', 'halfway']);
  });

  test('a skip into a new segment announces the entered segment', () => {
    const { engine, cues, tick } = makeEngine();
    engine.start(SESSION);
    tick(12); // 2s into run → startRun
    engine.skipSegment(); // truncates run → walk
    expect(cues).toContain('startWalk');
  });

  test('pause and resume announce their cues', () => {
    const { engine, cues, tick } = makeEngine();
    engine.start(SESSION);
    tick(12);
    engine.pause();
    expect(cues).toContain('paused');
    engine.resume();
    expect(cues).toContain('resumed');
  });

  test('completion announces complete and does not hard-release (lets it speak)', async () => {
    const { engine, cues, releaseCount, tick } = makeEngine();
    engine.start(SESSION);
    tick(80); // timeline exhausted → completed
    await flush();
    expect(cues).toContain('complete');
    expect(releaseCount()).toBe(0);
  });

  test('ending during the cooldown announces complete and does not hard-release', () => {
    const { engine, cues, releaseCount, tick } = makeEngine();
    engine.start(SESSION);
    tick(66); // 1s into the cooldown → ending counts as completed (issue #40)
    engine.endEarly();
    expect(cues).toContain('complete');
    expect(releaseCount()).toBe(0);
  });

  test('ending early releases the session and announces no completion cue', () => {
    const { engine, cues, releaseCount, tick } = makeEngine();
    engine.start(SESSION);
    tick(12);
    engine.endEarly();
    expect(cues).not.toContain('complete');
    expect(releaseCount()).toBeGreaterThanOrEqual(1);
  });

  test('reset releases the session', () => {
    const { engine, releaseCount } = makeEngine();
    engine.start(SESSION);
    engine.reset();
    expect(releaseCount()).toBeGreaterThanOrEqual(1);
  });
});

describe('segmentEndsAt', () => {
  test('is the wall-clock end of the active segment at start', () => {
    const { engine } = makeEngine();
    engine.start(SESSION); // now = 1_000_000, warmup 10s
    expect(engine.getSnapshot().segmentEndsAt).toBe(1_000_000 + 10_000);
  });

  test('tracks elapsed within a segment', () => {
    const { engine, tick } = makeEngine();
    engine.start(SESSION);
    tick(12); // now = 1_012_000, 18s left in the run segment
    expect(engine.getSnapshot().segmentEndsAt).toBe(1_012_000 + 18_000);
  });

  test('recomputes after a skip', () => {
    const { engine, advance } = makeEngine();
    engine.start(SESSION);
    advance(5); // 5s into warmup, no heartbeat
    engine.skipSegment(); // truncates warmup, enters run at now = 1_005_000
    const s = engine.getSnapshot();
    expect(s.segmentIndex).toBe(1);
    expect(s.segmentEndsAt).toBe(1_005_000 + 20_000);
  });

  test('is null at idle and after completion', () => {
    const { engine, tick } = makeEngine();
    expect(engine.getSnapshot().segmentEndsAt).toBeNull();
    engine.start(SESSION);
    tick(75); // exhausts the 75s timeline
    expect(engine.getSnapshot().status).toBe('completed');
    expect(engine.getSnapshot().segmentEndsAt).toBeNull();
  });
});

describe('GPS fix ingestion (T12, ADR 0021)', () => {
  test('live distanceM equals a fresh smoothed fold of the same fixes (live == fresh fold)', () => {
    const { engine, feed } = makeEngine();
    engine.start(SESSION);
    WALK_TRACK.forEach(feed);
    const expected = smoothTrack(WALK_TRACK).distanceM;
    expect(expected).toBeGreaterThan(0);
    expect(engine.getSnapshot().distanceM).toBe(expected);
    expect(engine.getSnapshot().paceSecPerKm).toBeGreaterThan(0);
  });

  test('a fresh fold of the buffered points, timestamps through the run_points ISO round-trip, matches live distance (live == re-derived, ADR 0021 §3)', () => {
    const { engine, feed } = makeEngine();
    engine.start(SESSION);
    // Fractional-ms fixes: live folds the rounded timestamps, so only the buffered (rounded) stream re-folds equal.
    const track: LocationFix[] = Array.from({ length: 6 }, (_, i) => ({
      timestamp: FIX_START + i * 1000 + 0.4,
      lat: 59 + i * 0.000018,
      lng: 18,
      altitude: 42,
      accuracy: 5,
      speed: 2,
    }));
    track.forEach(feed);
    // Reconstruct exactly what save-run's rollupFromPoints feeds smoothTrackBySegment: int-ms → ISO → getTime.
    const refold = smoothTrackBySegment(
      engine.getBufferedPoints().map((p): SegmentedFix => ({
        timestamp: new Date(new Date(p.timestamp).toISOString()).getTime(),
        lat: p.lat,
        lng: p.lng,
        altitude: p.altitude,
        accuracy: p.accuracy,
        speed: p.speed,
        segmentSeq: p.segmentSeq,
      })),
    );
    expect(refold.distanceM).toBeGreaterThan(0);
    expect(refold.distanceM).toBe(engine.getSnapshot().distanceM);
  });

  test('each buffered point is tagged with the current full-timeline segment index + a monotonic seq', () => {
    const { engine, feed } = makeEngine();
    engine.start(SESSION);
    feed(fixAt(5, 59, 18)); // warmup [0,10) → index 0
    feed(fixAt(12, 59.00004, 18)); // run [10,30) → index 1
    const points = engine.getBufferedPoints();
    expect(points.map((p) => p.segmentSeq)).toEqual([0, 1]);
    expect(points.map((p) => p.seq)).toEqual([0, 1]);
  });

  test('the buffered timestamp is normalized to integer ms (survives the run_points ISO round-trip)', () => {
    const { engine, feed } = makeEngine();
    engine.start(SESSION);
    feed({ timestamp: FIX_START + 3500.7, lat: 59, lng: 18, altitude: 42, accuracy: 5, speed: 2 });
    const [point] = engine.getBufferedPoints();
    expect(Number.isInteger(point.timestamp)).toBe(true);
    expect(point.timestamp).toBe(Math.round(FIX_START + 3500.7));
  });

  test('a fix with accuracy > 50 m is rejected — not buffered, no distance', () => {
    const { engine, feed } = makeEngine();
    engine.start(SESSION);
    feed(fixAt(2, 59, 18, 60));
    expect(engine.getBufferedPoints()).toEqual([]);
    expect(engine.getSnapshot().distanceM).toBe(0);
  });

  test('a fix with null accuracy is rejected', () => {
    const { engine, feed } = makeEngine();
    engine.start(SESSION);
    feed({ timestamp: FIX_START + 2000, lat: 59, lng: 18, altitude: 42, accuracy: null, speed: 2 });
    expect(engine.getBufferedPoints()).toEqual([]);
  });

  test('no ingestion while paused', () => {
    const { engine, feed } = makeEngine();
    engine.start(SESSION);
    feed(fixAt(2, 59, 18));
    const countRunning = engine.getBufferedPoints().length;
    const distanceRunning = engine.getSnapshot().distanceM;
    engine.pause();
    feed(fixAt(4, 59.00004, 18));
    expect(engine.getSnapshot().status).toBe('paused');
    expect(engine.getBufferedPoints().length).toBe(countRunning);
    expect(engine.getSnapshot().distanceM).toBe(distanceRunning);
  });

  test('a duplicate-timestamp fix is buffered but adds no distance (smoother de-dupes on dt ≤ 0)', () => {
    const { engine, feed } = makeEngine();
    engine.start(SESSION);
    feed(fixAt(2, 59, 18));
    feed(fixAt(4, 59.00004, 18));
    const distanceBefore = engine.getSnapshot().distanceM;
    const countBefore = engine.getBufferedPoints().length;
    feed(fixAt(4, 59.00004, 18)); // same timestamp
    expect(engine.getSnapshot().distanceM).toBe(distanceBefore);
    expect(engine.getBufferedPoints().length).toBe(countBefore + 1); // full accuracy-passed stream is persisted
  });

  test('a fix on the completing heartbeat is dropped: finalize precedes ingest, so live and the re-fold both exclude it', () => {
    const { engine, feed } = makeEngine();
    engine.start(SESSION);
    feed(fixAt(30, 59, 18)); // mid-run → buffered
    const beforeCount = engine.getBufferedPoints().length;
    expect(beforeCount).toBeGreaterThan(0);
    feed(fixAt(80, 59.0004, 18)); // elapsed 80 ≥ total 75 → completes before ingest runs
    expect(engine.getSnapshot().status).toBe('completed');
    expect(engine.getBufferedPoints().length).toBe(beforeCount);
  });

  test('an ingestion throw is caught — timing and cues keep advancing', () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      const { engine, feed, cues } = makeEngine();
      engine.start(SESSION);
      feed(fixAt(2, 59, 18)); // one good fix
      const evil = {
        timestamp: FIX_START + 3000,
        lng: 18,
        altitude: 42,
        accuracy: 5,
        speed: 2,
        get lat(): number {
          throw new Error('smoother boom');
        },
      } as unknown as LocationFix;
      feed(evil); // throws while spreading the fix, inside the ingest try/catch
      feed(fixAt(12, 59.00004, 18)); // next good fix crosses into the run segment
      const snap = engine.getSnapshot();
      expect(snap.status).toBe('running');
      expect(snap.segmentIndex).toBe(1);
      expect(cues).toContain('startRun'); // cue path was never stalled
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(engine.getBufferedPoints().length).toBe(2); // evil fix mutated nothing
    } finally {
      console.warn = originalWarn;
    }
  });

  test('start() and reset() clear the ingest accumulator', () => {
    const { engine, feed } = makeEngine();
    engine.start(SESSION);
    WALK_TRACK.forEach(feed);
    expect(engine.getBufferedPoints().length).toBe(WALK_TRACK.length);
    expect(engine.getSnapshot().distanceM).toBeGreaterThan(0);

    engine.reset();
    expect(engine.getBufferedPoints()).toEqual([]);
    expect(engine.getSnapshot().distanceM).toBe(0);
    expect(engine.getSnapshot().paceSecPerKm).toBeNull();

    engine.start(SESSION);
    expect(engine.getBufferedPoints()).toEqual([]);
    expect(engine.getSnapshot().distanceM).toBe(0);
  });
});

describe('point persistence & lifecycle (T13)', () => {
  test('startRun opens the active row before any flush — run_points cannot precede it', async () => {
    const h = makeEngine({ deferStartRun: true });
    h.engine.start(SESSION);
    WALK_TRACK.forEach(h.feed);
    h.fireFlush();
    await flush();
    expect(h.flushes).toEqual([]);
    expect(h.engine.getBufferedPoints()).toHaveLength(WALK_TRACK.length); // batch waits, unharmed
    h.releaseStartRun();
    await flush();
    expect(h.calls[0]).toBe('startRun');
    expect(h.flushedSeqs()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(h.flushes[0].runId).toBe('run-1');
  });

  test('the flush persists ISO-stamped points, then drains the buffer', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    WALK_TRACK.forEach(h.feed);
    expect(h.armCount()).toBeGreaterThan(0);
    h.fireFlush();
    await flush();
    expect(h.flushedPoints()[0].timestamp).toBe(new Date(WALK_TRACK[0].timestamp).toISOString());
    expect(h.flushedSeqs()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(h.engine.getBufferedPoints()).toEqual([]);
  });

  test('the flushed snapshot carries the log plus watermarks and no track', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    WALK_TRACK.forEach(h.feed);
    h.fireFlush();
    await flush();
    const state = h.lastFlush().state;
    expect(state.sessionKey).toBe('w1d1');
    expect(state.events.map((e) => e.type)).toEqual(['start']);
    expect(state.lastAnnouncedIndex).toBe(0);
    expect(state.halfwayFired).toBe(false);
    expect(state.lastAcceptedFix?.timestamp).toBe(WALK_TRACK[WALK_TRACK.length - 1].timestamp);
    expect(state).not.toHaveProperty('points');
  });

  test('the cadence re-arms itself, so a paused run keeps re-stamping the snapshot', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    h.tick(5);
    h.engine.pause();
    const armedAtPause = h.armCount();
    h.fireFlush();
    await flush();
    // No heartbeat runs while paused, so only the flush itself can re-open the window.
    expect(h.armCount()).toBeGreaterThan(armedAtPause);
    h.fireFlush();
    await flush();
    expect(h.flushes.length).toBeGreaterThanOrEqual(2);
    expect(h.lastFlush().points).toEqual([]);
    expect(h.lastFlush().state.events.map((e) => e.type)).toEqual(['start', 'pause']);
  });

  test('a rejected flush retains the exact batch and re-sends it once, gap-free', async () => {
    const h = makeEngine();
    h.setFailFlush(true);
    const warnings = await withoutWarnings(async () => {
      h.engine.start(SESSION);
      WALK_TRACK.slice(0, 3).forEach(h.feed);
      h.fireFlush();
      await flush();
    });
    expect(warnings).toBeGreaterThanOrEqual(1);
    expect(h.flushes).toEqual([]);
    expect(h.engine.getBufferedPoints().map((p) => p.seq)).toEqual([0, 1, 2]);
    h.setFailFlush(false);
    h.feed(WALK_TRACK[3]);
    h.fireFlush();
    await flush();
    expect(h.flushedSeqs()).toEqual([0, 1, 2, 3]);
    expect(h.engine.getBufferedPoints()).toEqual([]);
  });

  test('a rejected flush from a superseded run never re-enters the new run buffer', async () => {
    const h = makeEngine();
    h.deferFlush();
    h.setFailFlush(true);
    await withoutWarnings(async () => {
      h.engine.start(SESSION);
      WALK_TRACK.forEach(h.feed);
      h.fireFlush();
      await flush();
      h.engine.reset();
      h.engine.start(SESSION);
      h.releaseFlush();
      await flush();
    });
    expect(h.engine.getBufferedPoints()).toEqual([]);
  });

  test('finalize flushes the tail, then finalizes, then clears the snapshot', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    h.feed(fixAt(30, 59, 18));
    h.tick(80);
    await flush();
    expect(h.calls[0]).toBe('startRun');
    expect(h.flushedSeqs()).toEqual([0]);
    expect(h.calls.lastIndexOf('flush')).toBeLessThan(h.calls.indexOf('finalizeRun'));
    expect(h.calls.at(-1)).toBe('clearSnapshot');
    expect(h.finalized[0].runId).toBe('run-1');
    expect(h.engine.getSnapshot().savedRunId).toBe('run-1');
    expect(h.schedulerStops()).toBeGreaterThanOrEqual(1);
  });

  test('the snapshot is cleared only after finalizeRun resolves', async () => {
    const h = makeEngine();
    h.deferFinalize();
    h.engine.start(SESSION);
    h.tick(80);
    await flush();
    expect(h.calls).toContain('finalizeRun');
    expect(h.calls).not.toContain('clearSnapshot');
    expect(h.engine.getSnapshot().savedRunId).toBeNull();
    h.releaseFinalize();
    await flush();
    expect(h.calls.at(-1)).toBe('clearSnapshot');
    expect(h.engine.getSnapshot().savedRunId).toBe('run-1');
  });

  test('a transient startRun failure is retried at the next cadence and the whole track still lands', async () => {
    const h = makeEngine({ failStartRunTimes: 1 });
    await withoutWarnings(async () => {
      h.engine.start(SESSION);
      WALK_TRACK.forEach(h.feed);
      await flush();
      h.fireFlush();
      await flush();
    });
    expect(h.calls.filter((c) => c === 'startRun')).toHaveLength(2);
    expect(h.flushedSeqs()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('a permanently failing startRun still persists the run, carrying the live distance', async () => {
    const h = makeEngine({ failStartRunTimes: Number.POSITIVE_INFINITY });
    await withoutWarnings(async () => {
      h.engine.start(SESSION);
      WALK_TRACK.forEach(h.feed);
      h.fireFlush();
      await flush();
      h.tick(80);
      await flush();
    });
    expect(h.flushes).toEqual([]);
    expect(h.calls).toContain('saveRun');
    expect(h.calls).not.toContain('finalizeRun');
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0].distanceM).toBeGreaterThan(0);
    expect(h.engine.getSnapshot().savedRunId).toBe('run-1');
  });

  test('location tracking follows the run, and reset+start leaves it on', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    await flush();
    expect(h.trackerCalls).toEqual(['start']);
    h.tick(80); // completes
    await flush();
    expect(h.trackerCalls).toEqual(['start', 'stop']);
    h.engine.reset();
    h.engine.start(SESSION); // the session screen's own sequence
    await flush();
    expect(h.trackerCalls).toEqual(['start', 'stop', 'stop', 'start']);
  });
});

describe('resume (T14, ADR 0021 §3)', () => {
  /** Run a live GPS-tracked session, flush it, and hand back exactly what the DB would return. */
  async function crashAfterFlush() {
    const live = makeEngine();
    live.engine.start(SESSION);
    WALK_TRACK.forEach(live.feed);
    const distanceM = live.engine.getSnapshot().distanceM;
    live.fireFlush();
    await flush();
    return {
      distanceM,
      state: live.lastFlush().state,
      points: live.flushedPoints().map(fromRunPoint),
    };
  }

  test('restore reproduces elapsed and the pre-crash live distance', async () => {
    const { distanceM, state, points } = await crashAfterFlush();
    const h = makeEngine();
    h.setNow(FIX_START + 20_000);
    expect(h.engine.restore({ runId: 'run-1', session: SESSION, state, points })).toBe(true);
    const s = h.engine.getSnapshot();
    expect(s.status).toBe('running');
    expect(s.sessionKey).toBe('w1d1');
    expect(s.activeElapsedSeconds).toBe(20);
    expect(s.segmentIndex).toBe(1);
    expect(distanceM).toBeGreaterThan(0);
    expect(s.distanceM).toBe(distanceM);
    expect(h.calls).not.toContain('startRun'); // the active row is reused, never duplicated
    await flush();
    expect(h.trackerCalls).toEqual(['start']);
  });

  test('restore continues seq from the persisted maximum and re-buffers nothing', async () => {
    const { state, points } = await crashAfterFlush();
    const h = makeEngine();
    h.setNow(FIX_START + 20_000);
    h.engine.restore({ runId: 'run-1', session: SESSION, state, points });
    expect(h.engine.getBufferedPoints()).toEqual([]);
    h.feed(fixAt(20, 59.0004, 18));
    expect(h.engine.getBufferedPoints().map((p) => p.seq)).toEqual([points.length]);
    h.fireFlush();
    await flush();
    expect(h.flushedSeqs()).toEqual([points.length]);
  });

  test('post-resume distance stays equal to a fresh re-fold of the whole track, across the dead gap', async () => {
    const { state, points } = await crashAfterFlush();
    const h = makeEngine();
    h.setNow(FIX_START + 40_000); // > MAX_GAP_S after the last persisted fix → the smoother resets
    h.engine.restore({ runId: 'run-1', session: SESSION, state, points });
    [0, 1, 2, 3].forEach((i) => h.feed(fixAt(40 + i, 59.0004 + i * 0.000018, 18)));
    const refold = smoothTrackBySegment(
      [...points, ...h.engine.getBufferedPoints()].map(toSegmented),
    );
    expect(refold.distanceM).toBeGreaterThan(0);
    expect(h.engine.getSnapshot().distanceM).toBe(refold.distanceM);
  });

  test('a resumed run finalizes into the same active row', async () => {
    const { state, points } = await crashAfterFlush();
    const h = makeEngine();
    h.setNow(FIX_START + 20_000);
    h.engine.restore({ runId: 'run-1', session: SESSION, state, points });
    h.tick(60); // active 80 > total 75
    await flush();
    expect(h.engine.getSnapshot().status).toBe('completed');
    expect(h.finalized[0].runId).toBe('run-1');
    expect(h.calls).not.toContain('startRun');
  });

  test('restore rebuilds a paused run with frozen elapsed', () => {
    const h = makeEngine();
    h.setNow(FIX_START + 100_000);
    const restored = h.engine.restore({
      runId: 'run-1',
      session: SESSION,
      state: stateAtStart({
        events: [
          { type: 'start', at: FIX_START },
          { type: 'pause', at: FIX_START + 12_000 },
        ],
        lastAnnouncedIndex: 1,
      }),
      points: [],
    });
    expect(restored).toBe(true);
    const s = h.engine.getSnapshot();
    expect(s.status).toBe('paused');
    expect(s.activeElapsedSeconds).toBe(12);
    expect(s.distanceM).toBe(0);
  });

  test('paused-ness comes from the last unmatched pause, not the last event (skip is legal while paused)', () => {
    const h = makeEngine();
    h.setNow(FIX_START + 100_000);
    h.engine.restore({
      runId: 'run-1',
      session: SESSION,
      state: stateAtStart({
        events: [
          { type: 'start', at: FIX_START },
          { type: 'pause', at: FIX_START + 12_000 },
          { type: 'skip', at: FIX_START + 13_000 },
        ],
        lastAnnouncedIndex: 1,
      }),
      points: [],
    });
    expect(h.engine.getSnapshot().status).toBe('paused');
    expect(h.engine.getSnapshot().activeElapsedSeconds).toBe(12);
    expect(h.engine.getSnapshot().segmentIndex).toBe(2); // the skip truncated the run segment
    h.engine.resume(); // and the run is not wedged: elapsed advances again
    h.tick(5);
    expect(h.engine.getSnapshot().activeElapsedSeconds).toBe(17);
  });

  test('restore honours the cue watermarks — no re-announcing what was already spoken', () => {
    const h = makeEngine();
    h.setNow(FIX_START + 20_000); // elapsed 20 → the already-announced run segment
    h.engine.restore({
      runId: 'run-1',
      session: SESSION,
      state: stateAtStart({ lastAnnouncedIndex: 1, halfwayFired: true }),
      points: [],
    });
    expect(h.cues).toEqual([]);
    h.tick(20); // 40s: into the walk, and past halfway (37.5s)
    expect(h.cues).toEqual(['startWalk']);
  });

  test('restore refuses a run whose timeline expired while the app was dead', () => {
    const h = makeEngine();
    h.setNow(FIX_START + 200_000);
    const restored = h.engine.restore({
      runId: 'run-1',
      session: SESSION,
      state: stateAtStart(),
      points: [],
    });
    expect(restored).toBe(false);
    expect(h.engine.getSnapshot().status).toBe('idle');
    expect(h.saved).toEqual([]);
  });

  test('restore refuses a log that never started and leaves the engine idle', () => {
    const h = makeEngine();
    const restored = h.engine.restore({
      runId: 'run-1',
      session: SESSION,
      state: stateAtStart({ events: [], lastAnnouncedIndex: -1 }),
      points: [],
    });
    expect(restored).toBe(false);
    expect(h.engine.getSnapshot().status).toBe('idle');
  });

  test('restore leaves a live run alone', () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    h.tick(12);
    const restored = h.engine.restore({
      runId: 'run-9',
      session: { ...SESSION, key: 'w1d2' },
      state: stateAtStart({ sessionKey: 'w1d2' }),
      points: [],
    });
    expect(restored).toBe(false);
    const s = h.engine.getSnapshot();
    expect(s.status).toBe('running');
    expect(s.sessionKey).toBe('w1d1');
    expect(s.activeElapsedSeconds).toBe(12);
  });

  test('isTimelineExhausted replays skips, so a shortened timeline expires earlier', () => {
    const events = [
      { type: 'start' as const, at: FIX_START },
      { type: 'skip' as const, at: FIX_START + 5_000 },
    ]; // warmup 10→5 ⇒ total 70
    expect(isTimelineExhausted(SESSION, events, FIX_START + 69_000)).toBe(false);
    expect(isTimelineExhausted(SESSION, events, FIX_START + 70_000)).toBe(true);
    expect(isTimelineExhausted(SESSION, [], FIX_START + 70_000)).toBe(false);
  });
});

describe('abandon (unresumable in-flight run)', () => {
  test('an expired run is finalized as partial into its own row, then the engine returns to idle', async () => {
    const h = makeEngine();
    h.setNow(FIX_START + 200_000);
    await h.engine.abandon({
      runId: 'run-1',
      session: SESSION,
      state: stateAtStart(),
      aliveUntil: FIX_START + 200_000,
    });
    expect(h.calls).not.toContain('startRun');
    expect(h.finalized).toHaveLength(1);
    expect(h.finalized[0].runId).toBe('run-1');
    expect(h.saved[0].status).toBe('partial');
    expect(h.saved[0].activeDurationS).toBe(75); // capped at the timeline (ADR 0007)
    expect(h.calls.at(-1)).toBe('clearSnapshot');
    expect(h.engine.getSnapshot().status).toBe('idle');
    await flush();
    expect(h.trackerCalls).toContain('stop');
  });

  test('abandoning inside the final cool-down is still partial — only the runner can complete a run', async () => {
    const h = makeEngine();
    h.setNow(FIX_START + 70_000); // elapsed 70 ∈ cooldown [65,75)
    await h.engine.abandon({
      runId: 'run-1',
      session: SESSION,
      state: stateAtStart(),
      aliveUntil: FIX_START + 70_000,
    });
    expect(h.saved[0].status).toBe('partial');
    expect(h.saved[0].activeDurationS).toBe(70);
    expect(h.cues).not.toContain('complete');
  });

  test('the record ends at the last flush, not at detection — the dead process tracked nothing', async () => {
    const h = makeEngine();
    h.setNow(FIX_START + 200_000); // noticed long after the process died
    await h.engine.abandon({
      runId: 'run-1',
      session: SESSION,
      state: stateAtStart(),
      aliveUntil: FIX_START + 18_000,
    });
    expect(h.saved[0].activeDurationS).toBe(18);
    expect(h.saved[0].endedAt).toBe(new Date(FIX_START + 18_000).toISOString());
    // Warmup [0,10) and the run it died inside — not the whole session.
    expect(h.saved[0].segments.map((s) => s.kind)).toEqual(['warmup', 'run']);
    expect(h.saved[0].segments[1].actualDurationS).toBe(8);
  });

  test('a paused run keeps its frozen elapsed — the flush stamp cannot shorten it further', async () => {
    const h = makeEngine();
    h.setNow(FIX_START + 200_000);
    await h.engine.abandon({
      runId: 'run-1',
      session: SESSION,
      state: stateAtStart({
        events: [
          { type: 'start', at: FIX_START },
          { type: 'pause', at: FIX_START + 12_000 },
        ],
      }),
      aliveUntil: FIX_START + 16_000,
    });
    expect(h.saved[0].activeDurationS).toBe(12);
  });

  test('abandon leaves a live run alone', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    await h.engine.abandon({
      runId: 'run-9',
      session: { ...SESSION, key: 'w1d2' },
      state: stateAtStart({ sessionKey: 'w1d2' }),
      aliveUntil: FIX_START,
    });
    expect(h.engine.getSnapshot().status).toBe('running');
    expect(h.engine.getSnapshot().sessionKey).toBe('w1d1');
    expect(h.finalized).toEqual([]);
  });
});

describe('barometer capture (spec §6)', () => {
  test('a reading delivered during a run reaches the flush', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    h.emitReading(readingAt(1, 1013.25));
    h.fireFlush();
    await flush();
    expect(h.flushedSamples()).toHaveLength(1);
    expect(h.flushedSamples()[0]).toMatchObject({
      seq: 0,
      at: FIX_START + 1000,
      pressureHpa: 1013.25,
      segmentSeq: 0, // the warmup the run is in — samples are tagged like points
    });
  });

  test('a source that throws on start cannot fail the run', async () => {
    const broken = fakeElevation();
    const h = makeEngine({
      elevation: { ...broken.source, start: () => Promise.reject(new Error('altimeter down')) },
    });
    const warnings = await withoutWarnings(async () => {
      h.engine.start(SESSION);
      WALK_TRACK.forEach(h.feed);
      h.fireFlush();
      await flush();
    });
    expect(warnings).toBeGreaterThanOrEqual(1);
    expect(h.engine.getSnapshot().status).toBe('running');
    expect(h.flushedSeqs()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('a source that throws on subscribe cannot stop the engine being built', async () => {
    const base = fakeElevation();
    const warnings = await withoutWarnings(async () => {
      const h = makeEngine({
        elevation: {
          ...base.source,
          onReading: () => {
            throw new Error('no fan-out');
          },
        },
      });
      h.engine.start(SESSION);
      h.tick(80);
      await flush();
      expect(h.engine.getSnapshot().status).toBe('completed');
      expect(h.saved).toHaveLength(1);
    });
    expect(warnings).toBeGreaterThanOrEqual(1);
  });

  test('elevation start/stop are ordered, so a slow stop cannot outlive the next start', async () => {
    const calls: string[] = [];
    const base = fakeElevation();
    const h = makeEngine({
      elevation: {
        ...base.source,
        start: async () => void calls.push('start'),
        // A real stop() crosses the native bridge; this one only has to settle later than the
        // following start() is issued.
        stop: async () => {
          await Promise.resolve();
          calls.push('stop');
        },
      },
    });
    h.engine.start(SESSION);
    await flush();
    h.engine.reset();
    h.engine.start(SESSION); // the session screen's own back-to-back sequence
    await flush();
    expect(calls).toEqual(['start', 'stop', 'start']);
  });

  test('the source is started on restore(), not only on start()', async () => {
    const h = makeEngine();
    h.setNow(FIX_START + 20_000);
    expect(
      h.engine.restore({ runId: 'run-1', session: SESSION, state: stateAtStart(), points: [] }),
    ).toBe(true);
    await flush();
    expect(h.elevationCalls).toEqual(['start']);
  });

  test('the source is stopped on reset() as well as finalize()', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    await flush();
    expect(h.elevationCalls).toEqual(['start']);
    h.tick(80); // timeline exhausted → finalize
    await flush();
    expect(h.elevationCalls).toEqual(['start', 'stop']);
    h.engine.reset();
    await flush();
    expect(h.elevationCalls).toEqual(['start', 'stop', 'stop']);
  });

  test('a reading that throws on access cannot fail the run', async () => {
    const h = makeEngine();
    const warnings = await withoutWarnings(async () => {
      h.engine.start(SESSION);
      h.emitReading({
        get pressureHpa(): number {
          throw new Error('hostile reading');
        },
      } as unknown as AltitudeReading);
      h.tick(80);
      await flush();
    });
    expect(warnings).toBeGreaterThanOrEqual(1);
    expect(h.engine.getSnapshot().status).toBe('completed');
    expect(h.saved).toHaveLength(1);
  });

  test('an elevation op that never settles cannot strand the stop that follows it', async () => {
    const base = fakeElevation();
    const calls: string[] = [];
    const h = makeEngine({
      nativeTimeoutMs: 10,
      elevation: {
        ...base.source,
        // entered, never settled — the shape a dropped native promise takes.
        start: () => new Promise<void>(() => void calls.push('start-entered')),
        stop: async () => void calls.push('stop'),
      },
    });
    const warnings = await withoutWarnings(async () => {
      h.engine.start(SESSION);
      h.tick(80);
      await settle(80);
    });
    expect(warnings).toBeGreaterThanOrEqual(1);
    expect(calls).toEqual(['start-entered', 'stop']);
  });

  test('a failed flush returns its rows with their original seq, never renumbered', async () => {
    const h = makeEngine();
    const warnings = await withoutWarnings(async () => {
      h.engine.start(SESSION);
      await flush(); // let the flush that follows startRun settle, so the buffers are clean
      h.emitReading(readingAt(1, 1013)); // seq 0
      h.emitReading(readingAt(2, Number.NaN)); // consumes seq 1 and is dropped: the gap is real
      h.emitReading(readingAt(3, 1012)); // seq 2
      h.setFailFlush(true);
      h.fireFlush();
      await flush();
      h.setFailFlush(false);
      h.fireFlush();
      await flush();
    });
    expect(warnings).toBeGreaterThanOrEqual(1);
    // Renumbering on retry would yield [3, 4] here and erase the dropped reading's evidence.
    expect(h.flushedSamples().map((s) => s.seq)).toEqual([0, 2]);
    const entrySeqs = h.flushedEntries().map((e) => e.seq);
    expect(entrySeqs).toEqual(entrySeqs.map((_, i) => i));
  });

  test('a resumed run continues its log seq instead of restarting it', async () => {
    const live = makeEngine();
    live.engine.start(SESSION);
    live.emitReading(readingAt(1, 1013));
    live.emitReading(readingAt(2, 1012));
    live.fireFlush();
    await flush();
    const written = live.lastFlush().state;
    expect(written.logSeq?.sampleSeq).toBe(2);
    // Through the real parser, as the composition root reads it back: without its leg the watermark
    // is undefined on every resume, indistinguishable from never having been written.
    const state = parseSnapshotState(JSON.parse(JSON.stringify(written)));
    expect(state?.logSeq).toEqual(written.logSeq);

    const h = makeEngine();
    h.setNow(FIX_START + 20_000);
    expect(h.engine.restore({ runId: 'run-1', session: SESSION, state: state!, points: [] })).toBe(
      true,
    );
    h.emitReading(readingAt(21, 1011));
    h.fireFlush();
    await flush();
    expect(h.flushedSamples().map((s) => s.seq)).toEqual([2]);
    expect(h.flushedEntries()[0].seq).toBe(written.logSeq!.entrySeq);
  });

  test('a pre-slice snapshot resumes from the stored maxima, never from zero', async () => {
    const h = makeEngine();
    h.setNow(FIX_START + 20_000);
    h.engine.restore({
      runId: 'run-1',
      session: SESSION,
      state: stateAtStart(), // written before `logSeq` existed
      points: [],
      logResume: { nextSampleSeq: 40, nextEntrySeq: 900, epochBase: 3 },
    });
    h.emitReading(readingAt(21, 1011));
    h.fireFlush();
    await flush();
    expect(h.flushedSamples()[0]).toMatchObject({ seq: 40, epoch: 4 });
    expect(h.flushedEntries()[0].seq).toBe(900);
  });

  test('an entry noted at finalize reaches the store even with no points pending', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    await flush(); // the cadence flush drains first, so only the finalize drain is left to carry it
    h.tick(80); // completes with no GPS fix ever ingested
    await flush();
    expect(h.engine.getBufferedPoints()).toEqual([]);
    // The completion cue is noted after the last cadence flush, so only the finalize drain can carry it.
    expect(
      h.flushedEntries().some((e) => e.kind === 'cue' && e.detailJson?.includes('complete')),
    ).toBe(true);
  });

  test("a reading taken in a run's last seconds is drained at finalize", async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    await flush(); // drains the log, so the reading below is the only thing pending
    h.emitReading(readingAt(11, 1013));
    h.engine.endEarly(); // no completion cue, so this sample is pending with no entry beside it
    await flush();
    expect(h.flushedSamples().map((s) => s.pressureHpa)).toEqual([1013]);
  });

  test('an accuracy-rejected fix is logged; a velocity-gated one is not, since it is persisted', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    h.feed(fixAt(2, 59, 18, 60)); // accuracy 60 m → rejected outright
    h.feed(fixAt(3, 61, 18)); // implausible jump: gated by the smoother, but still buffered
    h.fireFlush();
    await flush();
    const rejected = h.flushedEntries().filter((e) => e.kind === 'fix_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].detailJson).toBe(
      JSON.stringify({ at: FIX_START + 2000, accuracy: 60, altitudeAccuracy: null }),
    );
    expect(h.flushedSeqs()).toEqual([0]);
  });

  test('every flush attempt leaves an aliveness tick, with no GPS fix at all', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    await flush();
    h.fireFlush();
    await flush();
    h.engine.pause();
    h.fireFlush();
    await flush();
    expect(h.flushedEntries().filter((e) => e.kind === 'tick').length).toBeGreaterThanOrEqual(3);
  });

  test('start() and reset() clear the log, so no row crosses into another run', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    h.emitReading(readingAt(1, 1013));
    h.engine.reset();
    h.engine.start(SESSION);
    h.emitReading(readingAt(2, 1012));
    h.fireFlush();
    await flush();
    expect(h.flushedSamples().map((s) => s.at)).toEqual([FIX_START + 2000]);
    expect(h.flushedSamples()[0].seq).toBe(0);
  });
});

describe('finalize-time capture (spec §5.2, §6.3)', () => {
  function eventsOf(record: CompletedRunRecord): { type: string; at: number }[] {
    return JSON.parse(record.eventLogJson!) as { type: string; at: number }[];
  }

  test('the event log — including pause/resume timestamps — survives into the finalizeRun path', async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    h.tick(30);
    h.engine.pause();
    h.advance(10); // paused; wall clock moves, active elapsed does not
    h.engine.resume();
    h.tick(50); // 30 + 50 active seconds > total 75 → completes, capped
    await flush();
    expect(h.calls).toContain('finalizeRun');
    expect(h.calls).not.toContain('saveRun');
    const events = eventsOf(h.finalized[0].record);
    expect(events.map((e) => e.type)).toEqual(['start', 'pause', 'resume', 'end']);
    expect(events[0].at).toBe(FIX_START);
    expect(events[1].at).toBe(FIX_START + 30_000);
    expect(events[2].at).toBe(FIX_START + 40_000);
  });

  test('the event log survives finalize through the saveRun fallback path too — same shape, no active row', async () => {
    const h = makeEngine({ failStartRunTimes: Number.POSITIVE_INFINITY });
    await withoutWarnings(async () => {
      h.engine.start(SESSION);
      h.tick(30);
      h.engine.pause();
      h.engine.resume();
      h.tick(50);
      await flush();
    });
    expect(h.calls).toContain('saveRun');
    expect(h.calls).not.toContain('finalizeRun');
    const events = eventsOf(h.saved[0]);
    expect(events.map((e) => e.type)).toEqual(['start', 'pause', 'resume', 'end']);
    expect(events[1].at).toBe(FIX_START + 30_000);
    expect(events[2].at).toBe(FIX_START + 30_000); // resumed on the same tick it paused
  });

  test('the step count is queried with Date objects spanning the run, and noted into the log', async () => {
    const h = makeEngine();
    h.setStepCounterReturn(123);
    h.engine.start(SESSION);
    h.tick(80); // completes; the wall clock ran the full 80s even though elapsed caps at 75
    await flush();
    expect(h.stepCounterCalls).toHaveLength(1);
    const { start, end } = h.stepCounterCalls[0];
    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);
    expect(start.getTime()).toBe(FIX_START);
    expect(end.getTime()).toBe(FIX_START + 80_000);
    expect(
      h
        .flushedEntries()
        .some((e) => e.kind === 'pedometer' && e.detailJson === JSON.stringify({ steps: 123 })),
    ).toBe(true);
  });

  test('a step-count read failure cannot fail the run', async () => {
    const h = makeEngine({
      stepCounter: () => Promise.reject(new Error('motion denied')),
    });
    const warnings = await withoutWarnings(async () => {
      h.engine.start(SESSION);
      h.tick(80);
      await flush();
    });
    expect(warnings).toBeGreaterThanOrEqual(1);
    expect(h.engine.getSnapshot().status).toBe('completed');
    expect(h.saved).toHaveLength(1);
  });

  test("the finalized record carries this run's motion permission", async () => {
    const h = makeEngine();
    h.engine.start(SESSION);
    h.tick(80);
    await flush();
    expect(h.finalized[0].record.motionPermission).toBe('granted');
  });

  test('a motion-permission read failure cannot fail the run, and leaves the field absent', async () => {
    const broken = fakeElevation();
    const h = makeEngine({
      elevation: { ...broken.source, getPermissionStatus: () => Promise.reject(new Error('nope')) },
    });
    const warnings = await withoutWarnings(async () => {
      h.engine.start(SESSION);
      h.tick(80);
      await flush();
    });
    expect(warnings).toBeGreaterThanOrEqual(1);
    expect(h.engine.getSnapshot().status).toBe('completed');
    expect(h.finalized[0].record.motionPermission).toBeUndefined();
  });

  test('a step count that never settles still saves the run', async () => {
    const h = makeEngine({
      nativeTimeoutMs: 10,
      stepCounter: () => new Promise<number | null>(() => {}),
    });
    const warnings = await withoutWarnings(async () => {
      h.engine.start(SESSION);
      h.tick(80);
      await settle(80);
    });
    expect(warnings).toBeGreaterThanOrEqual(1);
    expect(h.calls).toContain('finalizeRun');
    expect(h.engine.getSnapshot().savedRunId).toBe('run-1');
    expect(
      h
        .flushedEntries()
        .some(
          (e) =>
            e.kind === 'pedometer' &&
            e.detailJson === JSON.stringify({ steps: null, timedOut: true }),
        ),
    ).toBe(true);
  });

  test('a motion-permission read that never settles still saves the run', async () => {
    const base = fakeElevation();
    const h = makeEngine({
      nativeTimeoutMs: 10,
      elevation: {
        ...base.source,
        getPermissionStatus: () => new Promise<MotionPermissionStatus>(() => {}),
      },
    });
    const warnings = await withoutWarnings(async () => {
      h.engine.start(SESSION);
      h.tick(80);
      await settle(80);
    });
    expect(warnings).toBeGreaterThanOrEqual(1);
    expect(h.calls).toContain('finalizeRun');
    expect(h.engine.getSnapshot().savedRunId).toBe('run-1');
    expect(h.finalized[0].record.motionPermission).toBeUndefined();
  });

  test('both reads resolve while the location keepalive is still held (ADR 0008)', async () => {
    let stopsWhenRead = -1;
    const h = makeEngine({
      // why the real-timer hop and not a microtask: `queueTracker` defers its stop by one microtask,
      // so a read that resolves synchronously observes zero stops whichever order finalize uses. A
      // native read takes real time — this measures what a *resolved* read sees, which is the point.
      stepCounter: async () => {
        await settle(0);
        stopsWhenRead = h.trackerCalls.filter((c) => c === 'stop').length;
        return 0;
      },
    });
    h.engine.start(SESSION);
    await flush();
    h.tick(80);
    await settle(20);
    expect(stopsWhenRead).toBe(0);
    expect(h.trackerCalls).toEqual(['start', 'stop']);
    expect(h.calls).toContain('finalizeRun');
  });

  test('a failing store spends one finalize flush, not the whole retry budget, with no points pending', async () => {
    const h = makeEngine();
    const warnings = await withoutWarnings(async () => {
      h.setFailFlush(true);
      h.engine.start(SESSION);
      await flush();
      h.tick(80);
      await flush();
    });
    expect(warnings).toBeGreaterThanOrEqual(1);
    // One cadence attempt from startRun, one from the finalize drain — the loop's five remaining
    // retries belong to points, and none are pending.
    expect(h.calls.filter((c) => c === 'flush')).toHaveLength(2);
    expect(h.calls).toContain('finalizeRun');
  });
});
