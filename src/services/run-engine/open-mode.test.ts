import { describe, expect, test } from 'bun:test';

import { FREE_RUN_KEY } from '@/domain/free-run';
import { EARTH_RADIUS_M, type LocationFix } from '@/domain/geo';
import { modeFor, type RunMode } from './mode';
import type { RunEvent } from './types';

const DEG_PER_M = 180 / (Math.PI * EARTH_RADIUS_M);
const OPEN = { mode: 'open', key: FREE_RUN_KEY } as const;

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** 1 Hz northward fixes from t = 1 s, one leg per `[seconds, m/s]`, with ±~1 m of seeded noise. */
function track(legs: readonly [number, number][], fromMs = 0, fromNorthM = 0): LocationFix[] {
  const random = seededRandom(5);
  const fixes: LocationFix[] = [];
  let t = fromMs;
  let northM = fromNorthM;
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

const START: RunEvent[] = [{ type: 'start', at: 0 }];

function openMode(): RunMode {
  return modeFor(OPEN, { thresholdMps: () => 2.1 });
}

function feed(mode: RunMode, fixes: readonly LocationFix[], events: readonly RunEvent[] = START) {
  for (const fix of fixes) mode.ingest(fix, events);
}

describe('OpenMode — the rules a free run lives by', () => {
  test('has no plan cues, no skip, may be discarded, and coaches (it is not a field test)', () => {
    const mode = openMode();
    expect(mode).toMatchObject({
      kind: 'open',
      key: FREE_RUN_KEY,
      canSkip: false,
      canDiscard: true,
      cuesSuppressed: false,
    });
    expect(mode.takeCues(START, 600)).toEqual([]);
  });

  test('is never done by itself while moving', () => {
    const mode = openMode();
    feed(mode, track([[600, 2.6]]));
    expect(mode.position(START, 600, 600_000)).toEqual({ done: false, segmentSeq: 0 });
  });

  test('ends at 4 hours of active time, as a limit', () => {
    expect(openMode().position(START, 4 * 3600, 4 * 3_600_000)).toEqual({
      done: true,
      origin: 'limit',
    });
  });

  test('ends after 30 minutes stopped, and not a minute sooner', () => {
    const mode = openMode();
    const fixes = track([
      [120, 2.6],
      [1900, 0],
    ]);
    // the stop is confirmed and backdated to ~120 s
    feed(
      mode,
      fixes.filter((f) => f.timestamp <= 1_900_000),
    );
    expect(mode.position(START, 1_900, 1_900_000).done).toBe(false);
    feed(
      mode,
      fixes.filter((f) => f.timestamp > 1_900_000),
    );
    expect(mode.position(START, 2_020, 2_020_000)).toEqual({ done: true, origin: 'limit' });
  });

  test('a GPS loss alone never ends the run: only a stop the fixes measured does', () => {
    const mode = openMode();
    feed(mode, track([[120, 2.6]]));
    expect(mode.position(START, 3_600, 3_600_000).done).toBe(false);
    const once = openMode();
    feed(once, track([[1, 2.6]]));
    expect(once.position(START, 1_802, 1_802_000).done).toBe(false);
  });

  test('sparse fixes while standing still add up to no measured stop', () => {
    const mode = openMode();
    const sparse = Array.from(
      { length: 53 },
      (_, i) => track([[1, 0]], 300_000 + i * 45_000, 780)[0],
    );
    feed(mode, [...track([[300, 2.6]]), ...sparse]);
    expect(mode.position(START, 2_700, 2_700_000).done).toBe(false);
  });

  test('does not count paused time as stopped', () => {
    const mode = openMode();
    const events: RunEvent[] = [
      ...START,
      { type: 'pause', at: 600_000 },
      { type: 'resume', at: 2_400_000 },
    ];
    feed(
      mode,
      track([
        [120, 2.6],
        [480, 0],
      ]),
      events,
    );
    // stopped from ~120 s to 600 s (8 min), paused 30 min, then 5 more stopped minutes
    expect(mode.position(events, 900, 2_700_000).done).toBe(false);
  });

  test('a GPS gap while stopped does not restart the stopped clock', () => {
    const mode = openMode();
    feed(mode, [
      ...track([
        [120, 2.6],
        [600, 0],
      ]),
      // 2 minutes with no fix, still standing where the run stopped
      ...track([[1260, 0]], 840_000, 120 * 2.6),
    ]);
    // measured: ~600 s before the gap and 1 260 s after it — the gap itself is not counted
    expect(mode.position(START, 2_100, 2_100_000)).toEqual({ done: true, origin: 'limit' });
  });

  test('counts no stopped time from before the run began', () => {
    const mode = openMode();
    const events: RunEvent[] = [{ type: 'start', at: 60_000 }];
    // standing still from before the start: a cached fix, then the first minutes of the run
    feed(mode, track([[1_830, 0]]), events);
    expect(mode.position(events, 1_770, 1_830_000).done).toBe(false);
  });

  test('a timer-only run is ended only by the cap', () => {
    expect(openMode().position(START, 3 * 3600, 3 * 3_600_000).done).toBe(false);
  });
});

describe('OpenMode — its live view', () => {
  test('waits for GPS before its first fix', () => {
    expect(openMode().view(START, 30, 30_000)).toMatchObject({
      mode: 'open',
      motion: null,
      gpsStale: true,
      rollingPaceSecPerKm: null,
    });
  });

  test('shows the motion and a rolling pace while running', () => {
    const mode = openMode();
    feed(mode, track([[120, 2.6]]));
    const view = mode.view(START, 120, 120_000);
    expect(view).toMatchObject({ motion: 'run', gpsStale: false });
    // 2.6 m/s is 384.6 s/km
    expect(view.mode === 'open' && view.rollingPaceSecPerKm).toBeCloseTo(384.6, -1);
  });

  test('shows no pace before the first kind is confirmed, while the label waits for GPS', () => {
    const mode = openMode();
    feed(mode, track([[5, 2.6]]));
    expect(mode.view(START, 5, 5_000)).toMatchObject({ motion: null, rollingPaceSecPerKm: null });
  });

  test('shows no pace while stopped', () => {
    const mode = openMode();
    feed(
      mode,
      track([
        [120, 2.6],
        [120, 0],
      ]),
    );
    expect(mode.view(START, 240, 240_000)).toMatchObject({
      motion: 'stopped',
      rollingPaceSecPerKm: null,
    });
  });

  test('calls GPS stale after 10 s with no speed, and shows no pace then', () => {
    const mode = openMode();
    feed(mode, track([[120, 2.6]]));
    expect(mode.view(START, 125, 125_000)).toMatchObject({ gpsStale: false });
    expect(mode.view(START, 131, 131_000)).toMatchObject({
      gpsStale: true,
      rollingPaceSecPerKm: null,
    });
  });

  test('says when ending now would discard the run, rounding as the save does', () => {
    expect(openMode().view(START, 59, 59_000)).toMatchObject({ endDiscards: true });
    expect(openMode().view(START, 59.5, 59_500)).toMatchObject({ endDiscards: false });
    expect(openMode().view(START, 60, 60_000)).toMatchObject({ endDiscards: false });
  });

  test('shows no pace once GPS has gone quiet', () => {
    const mode = openMode();
    feed(mode, track([[120, 2.6]]));
    expect(mode.view(START, 200, 200_000)).toMatchObject({ rollingPaceSecPerKm: null });
  });
});

describe('OpenMode — how it ends', () => {
  test('is saved as completed however it ended, carrying its threshold', () => {
    const mode = openMode();
    for (const origin of ['runner', 'limit', 'abandon'] as const) {
      expect(
        mode.finalize({
          events: START,
          endAt: 600_000,
          requested: 'endedEarly',
          origin: origin,
          intent: 'save',
        }),
      ).toMatchObject({
        kind: 'completed',
        outcome: 'save',
        segments: [],
        derived: { thresholdMps: 2.1 },
      });
    }
  });

  test('a discard the runner chose is a discard', () => {
    expect(
      openMode().finalize({
        events: START,
        endAt: 600_000,
        requested: 'endedEarly',
        origin: 'runner',
        intent: 'discard',
      }).outcome,
    ).toBe('discard');
  });

  test('a run under a minute is a discard, so it is never congratulated', () => {
    expect(
      openMode().finalize({
        events: START,
        endAt: 59_000,
        requested: 'endedEarly',
        origin: 'runner',
        intent: 'save',
      }).outcome,
    ).toBe('discard');
    expect(
      openMode().finalize({
        events: START,
        endAt: 60_000,
        requested: 'endedEarly',
        origin: 'runner',
        intent: 'save',
      }).outcome,
    ).toBe('save');
  });

  test('rounds to the minimum as the saved duration does, so 59.5 s is kept', () => {
    expect(
      openMode().finalize({
        events: START,
        endAt: 59_500,
        requested: 'endedEarly',
        origin: 'runner',
        intent: 'save',
      }).outcome,
    ).toBe('save');
  });

  test('ends at the 4-hour instant, even when finalized later', () => {
    const final = openMode().finalize({
      events: START,
      endAt: 5 * 3_600_000,
      requested: 'endedEarly',
      origin: 'abandon',
      intent: 'save',
    });
    expect(final).toMatchObject({ endAt: 4 * 3_600_000, elapsedS: 4 * 3600 });
  });

  test('persists its threshold, with neutral plan fields an older parser still accepts', () => {
    expect(openMode().stateFields()).toEqual({
      lastAnnouncedIndex: -1,
      halfwayFired: false,
      modeState: { thresholdMps: 2.1 },
    });
  });

  test('resumes under the threshold its snapshot carried, never asking the learner again', () => {
    let asked = 0;
    const deps = { thresholdMps: () => (asked += 1) && 9 };
    const saved = { lastAnnouncedIndex: -1, halfwayFired: false, modeState: { thresholdMps: 2.3 } };
    expect(modeFor(OPEN, deps, saved).stateFields().modeState).toEqual({ thresholdMps: 2.3 });
    expect(asked).toBe(0);
  });

  test('a garbage saved threshold falls back to the learner instead of orphaning the run', () => {
    const saved = { lastAnnouncedIndex: -1, halfwayFired: false, modeState: { thresholdMps: 'x' } };
    const mode = modeFor(OPEN, { thresholdMps: () => 2.3 }, saved);
    expect(mode.stateFields().modeState).toEqual({ thresholdMps: 2.3 });
  });

  test('notes the threshold it starts with', () => {
    expect(openMode().startNote()).toEqual({
      kind: 'motion_threshold',
      detail: { thresholdMps: 2.1 },
    });
  });

  test('is resumable for 4 hours after its last flush', () => {
    expect(openMode().resumeWindowMs()).toBe(4 * 3_600_000);
  });
});

describe('OpenMode — the kilometre cue (ADR 0026 §7)', () => {
  // why a take after every fix: the engine takes cues at each running refresh
  function cuesOver(mode: RunMode, fixes: readonly LocationFix[], events = START) {
    return fixes.flatMap((fix) => {
      mode.ingest(fix, events);
      return mode.takeCues(events, fix.timestamp / 1000);
    });
  }

  test('fires once per kilometre, carrying the kilometre and its pace', () => {
    const cues = cuesOver(openMode(), track([[800, 2.6]]));
    expect(cues.map((c) => c.cue)).toEqual(['kilometre', 'kilometre']);
    expect(cues.map((c) => c.data?.km)).toEqual([1, 2]);
    for (const { data } of cues) expect(data?.paceSecPerKm).toBeCloseTo(1000 / 2.6, -1);
  });

  test('is silent short of a kilometre, and for a timer-only run', () => {
    expect(cuesOver(openMode(), track([[350, 2.6]]))).toEqual([]);
    expect(openMode().takeCues(START, 3600)).toEqual([]);
  });

  test('leaves a stop out of the pace', () => {
    const cues = cuesOver(
      openMode(),
      track([
        [200, 2.6],
        [120, 0],
        [250, 2.6],
      ]),
    );
    expect(cues).toHaveLength(1);
    // why a bound and not equality: the stop's first ~8 s count as running until the dwell
    // confirms it (spec §9); with the whole stop counted this would be ~505 s/km
    expect(cues[0].data?.paceSecPerKm).toBeGreaterThan(1000 / 2.6);
    expect(cues[0].data?.paceSecPerKm).toBeLessThan(1000 / 2.6 + 15);
  });

  test('leaves a pause out of the pace', () => {
    const events: RunEvent[] = [
      { type: 'start', at: 0 },
      { type: 'pause', at: 200_500 },
      { type: 'resume', at: 320_000 },
    ];
    const fixes = [...track([[200, 2.6]]), ...track([[250, 2.6]], 320_000, 520)];
    const cues = cuesOver(openMode(), fixes, events);
    expect(cues).toHaveLength(1);
    expect(cues[0].data?.paceSecPerKm).toBeCloseTo(1000 / 2.6, -1);
  });

  test('announces the latest kilometre once when several were crossed between refreshes', () => {
    const mode = openMode();
    feed(mode, track([[800, 2.6]]));
    expect(mode.takeCues(START, 800).map((c) => c.data?.km)).toEqual([2]);
    expect(mode.takeCues(START, 801)).toEqual([]);
  });

  test('announces nothing a resume re-folded, then the next kilometre as usual', () => {
    const fixes = track([[800, 2.6]]);
    const resumed = openMode();
    feed(resumed, fixes.slice(0, 500));
    resumed.caughtUp();
    expect(resumed.takeCues(START, 500)).toEqual([]);
    const next = cuesOver(resumed, fixes.slice(500));
    expect(next.map((c) => c.data?.km)).toEqual([2]);
    expect(next[0].data?.paceSecPerKm).toBeCloseTo(1000 / 2.6, -1);
  });
});
