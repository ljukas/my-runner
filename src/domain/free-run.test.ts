import { describe, expect, test } from 'bun:test';

import { FREE_RUN_KEY, isFreeRun, runPolicy } from './free-run';
import { nextSessionKey, NHS_PLAN, parseSessionKey } from './plan';

describe('the free-run key', () => {
  test('can never be read as a plan day, so it never completes one (ADR 0023)', () => {
    expect(parseSessionKey(FREE_RUN_KEY)).toBeNull();
    expect(nextSessionKey(NHS_PLAN, new Set([FREE_RUN_KEY]))).toBe(NHS_PLAN[0].key);
  });

  test('is how a stored run is told apart', () => {
    expect(isFreeRun(FREE_RUN_KEY)).toBe(true);
    expect(isFreeRun('w1d1')).toBe(false);
  });
});

describe('runPolicy', () => {
  test('a plan run folds with no policy, exactly as before', () => {
    expect(runPolicy('w3d2', [{ fromMs: 0, toMs: 1 }])).toBeUndefined();
  });

  test('a free run folds with its pause rule', () => {
    expect(runPolicy(FREE_RUN_KEY, [])).toBeDefined();
  });
});
