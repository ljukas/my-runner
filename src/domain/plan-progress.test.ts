import { describe, expect, test } from 'bun:test';

import { FREE_RUN_KEY } from './free-run';
import { NHS_PLAN } from './plan';
import { nextRunLabel, planCardDetail, planProgress, weekTitle } from './plan-progress';

const keys = (...k: string[]) => new Set(k);
const allKeys = new Set(NHS_PLAN.map((s) => s.key));

describe('planProgress', () => {
  test('a fresh plan: nine weeks of three, nothing done, w1d1 next', () => {
    const p = planProgress(NHS_PLAN, keys());
    expect(p.total).toBe(27);
    expect(p.done).toBe(0);
    expect(p.next?.key).toBe('w1d1');
    expect(p.weeks.map((w) => w.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p.weeks.every((w) => w.sessions.length === 3 && w.done === 0)).toBe(true);
  });

  test('next is the first gap in plan order, not the session after the latest', () => {
    const p = planProgress(NHS_PLAN, keys('w1d1', 'w1d3'));
    expect(p.next?.key).toBe('w1d2');
    expect(p.weeks[0].done).toBe(2);
    expect(p.done).toBe(2);
  });

  test('keys outside the plan count for nothing', () => {
    const p = planProgress(NHS_PLAN, keys(FREE_RUN_KEY, 'w99d1'));
    expect(p.done).toBe(0);
    expect(p.next?.key).toBe('w1d1');
  });

  test('a finished plan has no next session', () => {
    const p = planProgress(NHS_PLAN, allKeys);
    expect(p.done).toBe(27);
    expect(p.next).toBeNull();
  });
});

describe('copy', () => {
  test('weekTitle', () => {
    const p = planProgress(NHS_PLAN, keys('w1d1'));
    expect(weekTitle(p.weeks[0])).toBe('Week 1 · 1/3');
    expect(weekTitle(p.weeks[1])).toBe('Week 2 · 0/3');
  });

  test('planCardDetail across the plan', () => {
    expect(planCardDetail(planProgress(NHS_PLAN, keys()))).toBe('9 weeks · 27 runs');
    expect(planCardDetail(planProgress(NHS_PLAN, keys('w1d1')))).toBe('1 of 27 runs done');
    expect(planCardDetail(planProgress(NHS_PLAN, keys('w1d1', 'w1d2')))).toBe('2 of 27 runs done');
    expect(planCardDetail(planProgress(NHS_PLAN, allKeys))).toBe(
      'Plan complete · all 27 runs done',
    );
  });

  test('nextRunLabel names the next session, or nothing when the plan is done', () => {
    expect(nextRunLabel(planProgress(NHS_PLAN, keys()))).toBe('Up next: Week 1 · Day 1');
    expect(nextRunLabel(planProgress(NHS_PLAN, keys('w1d1')))).toBe('Up next: Week 1 · Day 2');
    expect(nextRunLabel(planProgress(NHS_PLAN, allKeys))).toBeNull();
  });
});
