import { describe, expect, test } from 'bun:test';

import type { CueId } from '@/domain/cues';
import type { PlanSession } from '@/domain/plan';
import type { CueService } from '@/services/cue-service/port';
import { RunEngine } from './engine';
import type { CompletedRunRecord, RunPersistence } from './types';

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
  const fakeCue = makeFakeCue();
  const engine = new RunEngine({ persistence, clock: () => now, cue: fakeCue.cue });
  return {
    engine,
    saved,
    cues: fakeCue.cues,
    prepareCount: fakeCue.prepareCount,
    releaseCount: fakeCue.releaseCount,
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
    const engine = new RunEngine({ persistence, clock: () => now, cue: makeFakeCue().cue });
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
