import { describe, expect, test } from 'bun:test';

import type { CueId } from '@/domain/cues';
import { FREE_RUN_KEY, FREE_RUN_PLAN, scriptedPlan } from '@/domain/free-run';
import { EARTH_RADIUS_M, type LocationFix } from '@/domain/geo';
import type { PlanSession } from '@/domain/plan';
import type { CueService } from '@/services/cue-service/port';
import { createReadingHub } from '@/services/elevation/reading-hub';
import type { ElevationSource } from '@/services/elevation';
import type { LocationTracker } from '@/services/location-tracker/port';
import type { RunPoint, RunSnapshotState, RunStore } from '@/services/run-store/port';
import type { StepCounterSource } from '@/services/step-counter/port';
import { RunEngine } from './engine';
import type { PointBatchScheduler } from './point-batch-scheduler';
import type { CompletedRunRecord, FinalizeOutcome, RunLifecyclePersistence } from './types';

const DEG_PER_M = 180 / (Math.PI * EARTH_RADIUS_M);
const START_MS = 1_000_000;

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** 1 Hz northward fixes from the run's start, one leg per `[seconds, m/s]`, with seeded noise. */
function track(legs: readonly [number, number][]): LocationFix[] {
  const random = seededRandom(3);
  const fixes: LocationFix[] = [];
  let t = START_MS;
  let northM = 0;
  for (const [seconds, mps] of legs) {
    for (let s = 0; s < seconds; s += 1) {
      t += 1000;
      northM += mps;
      const noise = random() + random() + random() + random() - 2;
      fixes.push({
        timestamp: t,
        lat: 59 + (northM + noise) * DEG_PER_M,
        lng: 18,
        altitude: null,
        accuracy: 5,
        speed: null,
      });
    }
  }
  return fixes;
}

/** A free-run engine over recording fakes; the same shape as engine.test.ts's harness, pared down. */
function makeFreeRunEngine({
  thresholdMps = 2.05,
  startRunFails = false,
  holdStartRun = false,
}: { thresholdMps?: number; startRunFails?: boolean; holdStartRun?: boolean } = {}) {
  let now = START_MS;
  const calls: string[] = [];
  const finalized: CompletedRunRecord[] = [];
  const opened: string[] = [];
  const flushes: { points: RunPoint[]; state: RunSnapshotState }[] = [];
  const cues: CueId[] = [];
  let finalizeOutcome: FinalizeOutcome = 'saved';
  let savedId: string | null = 'run-1';
  let gateFlush: (() => void) | undefined;
  let deferFlush = false;
  let releaseStartRun: (() => void) | undefined;
  let failMark = false;
  let failDiscard = false;

  const persistence: RunLifecyclePersistence = {
    saveRun: async (record) => {
      calls.push('saveRun');
      finalized.push(record);
      return savedId;
    },
    startRun: async (sessionKey) => {
      opened.push(sessionKey);
      if (holdStartRun) await new Promise<void>((resolve) => (releaseStartRun = resolve));
      if (startRunFails) throw new Error('no row');
      return 'run-1';
    },
    finalizeRun: async (_runId, record) => {
      calls.push('finalizeRun');
      finalized.push(record);
      return finalizeOutcome;
    },
    discardRun: async () => {
      calls.push('discardRun');
      if (failDiscard) throw new Error('delete failed');
    },
  };
  const runStore: RunStore = {
    flush: async (_runId, points, _samples, _entries, state) => {
      calls.push(state.discarding ? 'flush:discarding' : 'flush');
      if (state.discarding && failMark) throw new Error('mark failed');
      if (deferFlush) {
        deferFlush = false; // holds back the one flush in flight, not the ones after it
        await new Promise<void>((resolve) => (gateFlush = resolve));
      }
      flushes.push({ points, state });
    },
    loadSnapshot: async () => null,
    clearSnapshot: async () => void calls.push('clearSnapshot'),
  };
  const tracker: LocationTracker = {
    requestPermission: async () => 'granted',
    getPermissionStatus: async () => 'granted',
    start: async () => {},
    stop: async () => {},
    onFix: () => () => {},
  };
  const hub = createReadingHub();
  const elevation: ElevationSource = {
    isAvailable: async () => true,
    requestPermission: async () => 'granted',
    getPermissionStatus: async () => 'granted',
    start: async () => {},
    stop: async () => {},
    onReading: hub.onReading,
  };
  const stepCounter: StepCounterSource = {
    start: async () => {},
    stop: async () => {},
    read: async () => 0,
  };
  const cue: CueService = {
    prepare: () => {},
    announce: (c) => void cues.push(c),
    release: () => {},
  };
  let fireFlush = (): void => {};
  const createScheduler = (flushNow: () => void): PointBatchScheduler => {
    fireFlush = flushNow;
    return { arm: () => {}, stop: () => {} };
  };

  const engine = new RunEngine({
    persistence,
    runStore,
    tracker,
    cue,
    elevation,
    stepCounter,
    clock: () => now,
    createScheduler,
    thresholdMps: () => thresholdMps,
  });
  return {
    engine,
    calls,
    finalized,
    opened,
    flushes,
    cues,
    setFinalizeOutcome: (o: FinalizeOutcome) => (finalizeOutcome = o),
    setSavedId: (id: string | null) => (savedId = id),
    releaseStartRun: () => releaseStartRun?.(),
    failMark: () => (failMark = true),
    failDiscard: () => (failDiscard = true),
    setNow: (ms: number) => (now = ms),
    deferFlush: () => (deferFlush = true),
    releaseFlush: () => gateFlush?.(),
    fireFlush: () => fireFlush(),
    feed: (fixes: readonly LocationFix[]) => {
      for (const fix of fixes) {
        now = fix.timestamp;
        engine.heartbeat(fix.timestamp, fix);
      }
    },
    at: (ms: number) => {
      now = ms;
      engine.heartbeat();
    },
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const PLAN: PlanSession = {
  key: 'w1d1',
  week: 1,
  day: 1,
  segments: [{ kind: 'run', seconds: 600 }],
};

describe('a free run, start to finish', () => {
  test('starts open, under the free-run key, with the learned threshold on record', async () => {
    const h = makeFreeRunEngine({ thresholdMps: 2.05 });
    h.engine.start(FREE_RUN_PLAN);
    await settled();
    expect(h.engine.getSnapshot()).toMatchObject({
      mode: 'open',
      status: 'running',
      sessionKey: FREE_RUN_KEY,
    });
    expect(h.opened).toEqual([FREE_RUN_KEY]);
    h.fireFlush();
    await settled();
    expect(h.flushes.at(-1)?.state.modeState).toEqual({ thresholdMps: 2.05 });
  });

  test('ended by the runner, it is saved as completed with its threshold, and congratulated', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[300, 2.6]]));
    h.engine.endEarly();
    await settled();
    expect(h.finalized[0]).toMatchObject({
      status: 'completed',
      segments: [],
      derived: { thresholdMps: 2.05 },
    });
    expect(h.cues).toContain('complete');
  });

  test('under a minute, it is deleted — never saved, never congratulated', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[40, 2.6]]));
    h.engine.endEarly();
    await settled();
    expect(h.calls).not.toContain('finalizeRun');
    expect(h.calls).toContain('discardRun');
    expect(h.cues).not.toContain('complete');
    expect(h.engine.getSnapshot().status).toBe('idle');
  });

  test('a discard marks the snapshot before the delete, then clears it', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[300, 2.6]]));
    h.engine.endEarly('discard');
    await settled();
    const order = h.calls.filter((c) => c !== 'flush');
    expect(order).toEqual(['flush:discarding', 'discardRun', 'clearSnapshot']);
    expect(h.calls).not.toContain('finalizeRun');
    expect(h.engine.getSnapshot().status).toBe('idle');
  });

  test('a discard waits for a flush already in flight, so nothing is written back after the delete', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[300, 2.6]]));
    await settled();
    h.deferFlush();
    h.fireFlush();
    await settled(); // the flush is now parked inside the store, mid-write
    h.engine.endEarly('discard');
    await settled();
    expect(h.calls).not.toContain('discardRun');
    h.releaseFlush();
    await settled();
    await settled();
    expect(h.calls).toContain('discardRun');
  });

  test('a finalize that found the run too short leaves the engine idle, with no summary to open', async () => {
    const h = makeFreeRunEngine();
    h.setFinalizeOutcome('discarded');
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[300, 2.6]]));
    h.engine.endEarly();
    await settled();
    expect(h.engine.getSnapshot()).toMatchObject({ status: 'idle', savedRunId: null });
    expect(h.cues).not.toContain('complete');
  });

  test('with no in-flight row, a save that found it too short leaves the engine idle', async () => {
    const h = makeFreeRunEngine({ startRunFails: true });
    h.setSavedId(null);
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[300, 2.6]]));
    h.engine.endEarly();
    await settled();
    await settled();
    expect(h.calls).toContain('saveRun');
    expect(h.engine.getSnapshot()).toMatchObject({ status: 'idle', savedRunId: null });
    expect(h.cues).not.toContain('complete');
  });

  test('a pause lands after every fix the run has counted, so the saved log keeps them', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    const fixes = track([[300, 2.6]]);
    h.feed(fixes.slice(0, -1));
    const ahead = fixes[fixes.length - 1];
    // a fix stamped half a second ahead of the wall clock, then a pause at the wall clock
    h.setNow(ahead.timestamp - 500);
    h.engine.heartbeat(ahead.timestamp - 500, ahead);
    h.engine.pause();
    h.setNow(ahead.timestamp + 60_000);
    h.engine.resume();
    h.engine.endEarly();
    await settled();
    const log: { type: string; at: number }[] = JSON.parse(h.finalized[0].eventLogJson!);
    expect(log.find((e) => e.type === 'pause')!.at).toBeGreaterThan(ahead.timestamp);
  });

  test('a discard while its row is still opening writes nothing back', async () => {
    const h = makeFreeRunEngine({ holdStartRun: true });
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[300, 2.6]]));
    h.engine.endEarly('discard');
    await settled();
    h.releaseStartRun();
    for (let i = 0; i < 4; i += 1) await settled();
    expect(h.calls).toEqual(['flush:discarding', 'discardRun', 'clearSnapshot']);
  });

  test('a discard whose mark fails still deletes the run', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[300, 2.6]]));
    await settled();
    h.failMark();
    h.engine.endEarly('discard');
    await settled();
    expect(h.calls.filter((c) => c !== 'flush')).toEqual([
      'flush:discarding',
      'discardRun',
      'clearSnapshot',
    ]);
  });

  test('a discard whose delete fails keeps the snapshot, so the next launch finishes it', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[300, 2.6]]));
    await settled();
    h.failDiscard();
    h.engine.endEarly('discard');
    await settled();
    expect(h.calls).toContain('discardRun');
    expect(h.calls).not.toContain('clearSnapshot');
    expect(h.engine.getSnapshot().status).toBe('idle');
  });
});

describe('what the run screen reads off a free run', () => {
  test('a discard shows as ended at once, and leaves the idle snapshot saying so', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[300, 2.6]]));
    h.engine.endEarly('discard');
    expect(h.engine.getSnapshot().status).toBe('endedEarly');
    await settled();
    expect(h.engine.getSnapshot()).toMatchObject({ status: 'idle', lastOutcome: 'discarded' });
  });

  test('a run ended under a minute leaves the idle snapshot saying it was too short', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[40, 2.6]]));
    h.engine.endEarly();
    await settled();
    expect(h.engine.getSnapshot()).toMatchObject({ status: 'idle', lastOutcome: 'tooShort' });
  });

  test('a run its save found too short says so too', async () => {
    const h = makeFreeRunEngine();
    h.setFinalizeOutcome('discarded');
    h.engine.start(FREE_RUN_PLAN);
    h.feed(track([[300, 2.6]]));
    h.engine.endEarly();
    await settled();
    expect(h.engine.getSnapshot()).toMatchObject({ status: 'idle', lastOutcome: 'tooShort' });
  });

  test('the next run starts with no outcome', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.engine.endEarly('discard');
    await settled();
    h.engine.start(FREE_RUN_PLAN);
    expect(h.engine.getSnapshot().lastOutcome).toBeNull();
  });

  test('the count-up clock is anchored where active time began, and stops while paused', () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.at(START_MS + 10_000);
    expect(h.engine.getSnapshot().elapsedAnchorMs).toBe(START_MS);
    h.engine.pause();
    expect(h.engine.getSnapshot().elapsedAnchorMs).toBeNull();
    h.setNow(START_MS + 70_000);
    h.engine.resume();
    expect(h.engine.getSnapshot().elapsedAnchorMs).toBe(START_MS + 60_000);
  });
});

describe('a free run ends itself at its limits', () => {
  test('at 4 hours of active time', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.at(START_MS + 4 * 3_600_000);
    await settled();
    expect(h.finalized).toHaveLength(1);
    expect(h.cues).toContain('complete');
  });

  test('after 30 minutes stopped', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.feed(
      track([
        [120, 2.6],
        [1900, 0],
      ]),
    );
    await settled();
    expect(h.finalized).toHaveLength(1);
  });
});

describe('an interrupted free run', () => {
  const stateOf = (h: ReturnType<typeof makeFreeRunEngine>) => h.flushes.at(-1)!.state;

  test('resumes under its own threshold, with its distance', async () => {
    const before = makeFreeRunEngine({ thresholdMps: 2.3 });
    before.engine.start(FREE_RUN_PLAN);
    before.feed(track([[300, 2.6]]));
    before.fireFlush();
    await settled();
    const points = before.flushes
      .flatMap((f) => f.points)
      .map((p) => ({ ...p, timestamp: Date.parse(p.timestamp) }));

    const after = makeFreeRunEngine({ thresholdMps: 9 }); // the learner must not be asked again
    const resumed = after.engine.restore({
      runId: 'run-1',
      plan: { mode: 'open', key: FREE_RUN_KEY },
      state: stateOf(before),
      points,
    });
    expect(resumed).toBe(true);
    expect(after.engine.getSnapshot().distanceM).toBeCloseTo(
      before.engine.getSnapshot().distanceM,
      6,
    );
    after.fireFlush();
    await settled();
    expect(stateOf(after).modeState).toEqual({ thresholdMps: 2.3 });
  });

  test('resumed after a long downtime, the time it was dead is a pause, not stopped time', async () => {
    const before = makeFreeRunEngine();
    before.engine.start(FREE_RUN_PLAN);
    before.feed(track([[300, 2.6]]));
    before.fireFlush();
    await settled();
    const points = before.flushes
      .flatMap((f) => f.points)
      .map((p) => ({ ...p, timestamp: Date.parse(p.timestamp) }));

    const after = makeFreeRunEngine();
    const revivedAt = START_MS + 300_000 + 45 * 60_000;
    after.setNow(revivedAt);
    expect(
      after.engine.restore({
        runId: 'run-1',
        plan: FREE_RUN_PLAN,
        state: stateOf(before),
        points,
        aliveUntil: START_MS + 300_000,
      }),
    ).toBe(true);
    after.at(revivedAt + 1000);
    await settled();
    expect(after.finalized).toEqual([]);
    expect(after.engine.getSnapshot().status).toBe('running');
    expect(after.engine.getSnapshot().activeElapsedSeconds).toBeLessThan(310);
  });

  test('near its cap, a downtime does not use up the rest of its 4 hours', async () => {
    const before = makeFreeRunEngine();
    before.engine.start(FREE_RUN_PLAN);
    const aliveUntil = START_MS + 3.9 * 3_600_000;
    before.at(aliveUntil);
    before.fireFlush();
    await settled();

    const after = makeFreeRunEngine();
    after.setNow(aliveUntil + 30 * 60_000);
    expect(
      after.engine.restore({
        runId: 'run-1',
        plan: FREE_RUN_PLAN,
        state: stateOf(before),
        points: [],
        aliveUntil,
      }),
    ).toBe(true);
  });

  test('abandoned at launch, it is saved as completed, silently', async () => {
    const before = makeFreeRunEngine();
    before.engine.start(FREE_RUN_PLAN);
    before.feed(track([[300, 2.6]]));
    before.fireFlush();
    await settled();

    const after = makeFreeRunEngine();
    await after.engine.abandon({
      runId: 'run-1',
      plan: { mode: 'open', key: FREE_RUN_KEY },
      state: stateOf(before),
      aliveUntil: START_MS + 300_000,
    });
    expect(after.finalized[0]?.status).toBe('completed');
    expect(after.cues).not.toContain('complete');
  });
});

describe('what a free run cannot do, and what a plan run cannot', () => {
  test('a free run has nothing to skip', () => {
    const h = makeFreeRunEngine();
    h.engine.start(FREE_RUN_PLAN);
    h.engine.skipSegment();
    h.fireFlush();
    expect(h.engine.getSnapshot().status).toBe('running');
  });

  test('a plan run cannot be discarded', async () => {
    const h = makeFreeRunEngine();
    h.engine.start(scriptedPlan(PLAN));
    h.engine.endEarly('discard');
    await settled();
    expect(h.calls).not.toContain('discardRun');
    expect(h.engine.getSnapshot().status).toBe('running');
  });
});
