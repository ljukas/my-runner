import { describe, expect, test } from 'bun:test';

import type { PlanSession } from '@/domain/plan';
import { RunEngine } from './engine';
import type { CompletedRunRecord, RunPersistence } from './types';

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

function makeEngine() {
  let now = 1_000_000;
  const saved: CompletedRunRecord[] = [];
  let failSave = false;
  const persistence: RunPersistence = {
    saveRun: async (record) => {
      if (failSave) throw new Error('db down');
      saved.push(record);
      return 'run-1';
    },
  };
  const engine = new RunEngine({ persistence, clock: () => now });
  return {
    engine,
    saved,
    setFailSave: (v: boolean) => (failSave = v),
    tick: (seconds: number) => {
      now += seconds * 1000;
      engine.heartbeat();
    },
    advance: (seconds: number) => (now += seconds * 1000),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(30);
    engine.pause();
    engine.resume();
    tick(50); // active 80 > 75 → done, capped at 75
    expect(engine.getSnapshot().status).toBe('completed');
    expect(engine.getSnapshot().activeElapsedSeconds).toBe(75);
    await flush();
    expect(engine.getSnapshot().savedRunId).toBe('run-1');
    const record = saved[0];
    expect(record.sessionKey).toBe('w1d1');
    expect(record.status).toBe('completed');
    expect(record.activeDurationS).toBe(75);
    expect(record.segments).toHaveLength(5);
    expect(record.segments.map((s) => s.actualDurationS)).toEqual([10, 20, 15, 20, 10]);
    expect(record.startedAt).toBe(new Date(1_000_000).toISOString());
  });

  test('endEarly persists a partial run: reached segments only, last one truncated', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(12); // 2s into segment 1 (run)
    engine.endEarly();
    expect(engine.getSnapshot().status).toBe('endedEarly');
    await flush();
    const record = saved[0];
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

  test('a failed save surfaces saveFailed', async () => {
    const { engine, tick, setFailSave } = makeEngine();
    setFailSave(true);
    engine.start(SESSION);
    tick(80);
    await flush();
    expect(engine.getSnapshot().saveFailed).toBe(true);
    expect(engine.getSnapshot().savedRunId).toBeNull();
  });

  test('a slow save from a superseded run never stamps a later run', async () => {
    let resolveSave: ((id: string) => void) | undefined;
    const persistence: RunPersistence = {
      saveRun: () => new Promise<string>((resolve) => (resolveSave = resolve)),
    };
    let now = 1_000_000;
    const engine = new RunEngine({ persistence, clock: () => now });
    engine.start(SESSION);
    now += 80_000;
    engine.heartbeat(); // completes run A; its save stays pending
    expect(engine.getSnapshot().status).toBe('completed');
    engine.reset();
    engine.start({ ...SESSION, key: 'w1d2' });
    resolveSave!('run-A');
    await flush();
    const s = engine.getSnapshot();
    expect(s.savedRunId).toBeNull();
    expect(s.sessionKey).toBe('w1d2');
    expect(s.status).toBe('running');
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
