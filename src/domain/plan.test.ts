import { describe, expect, test } from 'bun:test';

import {
  COMPRESSED_PLAN,
  NHS_PLAN,
  getSession,
  nextSessionKey,
  parseSessionKey,
  sessionTotalSeconds,
} from './plan';

// Run totals (seconds) from the design spec Appendix A.
const EXPECTED_RUN_SECONDS: Record<string, number> = {
  w1: 480, w2: 540, w3: 540, w4: 960,
  w5d1: 900, w5d2: 960, w5d3: 1200,
  w6d1: 1080, w6d2: 1200, w6d3: 1500,
  w7: 1500, w8: 1680, w9: 1800,
};

function runSeconds(key: string): number {
  return getSession(NHS_PLAN, key)!
    .segments.filter((s) => s.kind === 'run')
    .reduce((sum, s) => sum + s.seconds, 0);
}

describe('NHS_PLAN', () => {
  test('has 27 sessions with unique keys in plan order', () => {
    expect(NHS_PLAN).toHaveLength(27);
    const keys = NHS_PLAN.map((s) => s.key);
    expect(new Set(keys).size).toBe(27);
    const expected = [];
    for (let w = 1; w <= 9; w++) for (let d = 1; d <= 3; d++) expected.push(`w${w}d${d}`);
    expect(keys).toEqual(expected);
  });

  test('every session is bracketed by 5-min warmup and cooldown walks', () => {
    for (const s of NHS_PLAN) {
      expect(s.segments[0]).toEqual({ kind: 'warmup', seconds: 300 });
      expect(s.segments[s.segments.length - 1]).toEqual({ kind: 'cooldown', seconds: 300 });
      expect(s.segments.every((seg) => seg.seconds > 0)).toBe(true);
    }
  });

  test('run totals match the NHS plan table', () => {
    for (let d = 1; d <= 3; d++) {
      for (const w of [1, 2, 3, 4, 7, 8, 9]) {
        expect(runSeconds(`w${w}d${d}`)).toBe(EXPECTED_RUN_SECONDS[`w${w}`]);
      }
    }
    for (const key of ['w5d1', 'w5d2', 'w5d3', 'w6d1', 'w6d2', 'w6d3']) {
      expect(runSeconds(key)).toBe(EXPECTED_RUN_SECONDS[key]);
    }
  });

  test('weeks 1 and 2 end on a run before the cooldown', () => {
    for (const key of ['w1d1', 'w2d1']) {
      const segs = getSession(NHS_PLAN, key)!.segments;
      expect(segs[segs.length - 2].kind).toBe('run');
    }
  });

  test('W6R3 is the 25-minute continuous NHS run', () => {
    const segs = getSession(NHS_PLAN, 'w6d3')!.segments;
    expect(segs).toEqual([
      { kind: 'warmup', seconds: 300 },
      { kind: 'run', seconds: 1500 },
      { kind: 'cooldown', seconds: 300 },
    ]);
  });

  test('w1d1 totals 28.5 minutes', () => {
    // 300 warmup + 8×60 run + 7×90 walk + 300 cooldown (spec Appendix A)
    expect(sessionTotalSeconds(getSession(NHS_PLAN, 'w1d1')!)).toBe(1710);
  });
});

describe('COMPRESSED_PLAN', () => {
  test('mirrors NHS structure with seconds-long segments', () => {
    expect(COMPRESSED_PLAN).toHaveLength(27);
    for (let i = 0; i < 27; i++) {
      const nhs = NHS_PLAN[i];
      const dev = COMPRESSED_PLAN[i];
      expect(dev.key).toBe(nhs.key);
      expect(dev.segments.map((s) => s.kind)).toEqual(nhs.segments.map((s) => s.kind));
      for (let j = 0; j < dev.segments.length; j++) {
        expect(dev.segments[j].seconds).toBeGreaterThanOrEqual(2);
        expect(dev.segments[j].seconds).toBeLessThanOrEqual(nhs.segments[j].seconds);
      }
    }
  });

  test('compressed w1d1 finishes in well under a minute', () => {
    expect(sessionTotalSeconds(getSession(COMPRESSED_PLAN, 'w1d1')!)).toBeLessThanOrEqual(45);
  });
});

describe('progression', () => {
  test('nextSessionKey walks the plan in order and supports gaps', () => {
    expect(nextSessionKey(NHS_PLAN, new Set())).toBe('w1d1');
    expect(nextSessionKey(NHS_PLAN, new Set(['w1d1']))).toBe('w1d2');
    expect(nextSessionKey(NHS_PLAN, new Set(['w1d1', 'w1d3']))).toBe('w1d2');
    expect(nextSessionKey(NHS_PLAN, new Set(NHS_PLAN.map((s) => s.key)))).toBeNull();
  });

  test('parseSessionKey', () => {
    expect(parseSessionKey('w6d3')).toEqual({ week: 6, day: 3 });
    expect(parseSessionKey('nonsense')).toBeNull();
  });
});
