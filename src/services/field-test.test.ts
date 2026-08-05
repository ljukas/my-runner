import { describe, expect, test } from 'bun:test';

import type { PlanSession } from '@/domain/plan';
import {
  FIELD_TEST_SESSION_KEY,
  fieldTestSession,
  isFieldTestRun,
  resumeDispositionOf,
  skipForFieldTest,
} from './field-test';

describe('field test', () => {
  test('its session key is not one any plan day claims, so completion has nothing to mark', () => {
    expect(FIELD_TEST_SESSION_KEY).toBe('field-test');
    expect(FIELD_TEST_SESSION_KEY).not.toMatch(/^w\d+d\d+$/);
  });

  test('isFieldTestRun identifies a capture and nothing else', () => {
    expect(isFieldTestRun(FIELD_TEST_SESSION_KEY)).toBe(true);
    expect(isFieldTestRun('w1d1')).toBe(false);
  });

  test('the session is one long segment, so there are no transitions to announce', () => {
    const session = fieldTestSession();
    expect(session.segments).toHaveLength(1);
    expect(session.segments[0].seconds).toBeGreaterThanOrEqual(3600);
  });

  test('the session key matches no plan-day pattern, and its own key round-trips', () => {
    const session = fieldTestSession();
    expect(session.key).toBe(FIELD_TEST_SESSION_KEY);
    expect(isFieldTestRun(session.key)).toBe(true);
  });
});

describe('resumeDispositionOf (crash recovery, spec §8.0)', () => {
  const W1D1: PlanSession = {
    key: 'w1d1',
    week: 1,
    day: 1,
    segments: [{ kind: 'warmup', seconds: 300 }],
  };
  const plan = (key: string) => (key === W1D1.key ? W1D1 : undefined);

  // Load-bearing: without this branch the launch discards the capture's snapshot and orphans its
  // `'active'` row.
  test("a capture's snapshot resolves to its own session, so its interrupted run can be finalized", () => {
    const disposition = resumeDispositionOf(FIELD_TEST_SESSION_KEY, plan);
    expect(disposition?.session).toEqual(fieldTestSession());
  });

  test('a capture is never offered back to the runner — it is finalized as partial instead', () => {
    expect(resumeDispositionOf(FIELD_TEST_SESSION_KEY, plan)?.offerable).toBe(false);
  });

  test('the capture branch never consults the plan (no plan day claims its key)', () => {
    let lookups = 0;
    resumeDispositionOf(FIELD_TEST_SESSION_KEY, (key) => {
      lookups++;
      return plan(key);
    });
    expect(lookups).toBe(0);
  });

  test('a plan day resolves to its plan session and is offered as before', () => {
    expect(resumeDispositionOf('w1d1', plan)).toEqual({ session: W1D1, offerable: true });
  });

  test('a key neither the plan nor a capture claims is nothing to settle', () => {
    expect(resumeDispositionOf('w99d9', plan)).toBeNull();
  });
});

describe('skipForFieldTest (health-sync gate, spec §8.0)', () => {
  test('skips the sync for a field-test run — the sync callback is never called', () => {
    let calls = 0;
    const gated = skipForFieldTest(
      () => FIELD_TEST_SESSION_KEY,
      () => void calls++,
    );
    void gated('run-1');
    expect(calls).toBe(0);
  });

  test('calls the sync for an ordinary plan run, forwarding the runId', () => {
    const seen: string[] = [];
    const gated = skipForFieldTest(
      () => 'w1d1',
      (runId) => void seen.push(runId),
    );
    void gated('run-1');
    expect(seen).toEqual(['run-1']);
  });

  test('forwards the sync return value (so a caller awaiting a Promise still can)', async () => {
    const gated = skipForFieldTest(
      () => 'w1d1',
      (runId) => Promise.resolve(`synced:${runId}`),
    );
    await expect(gated('run-7')).resolves.toBe('synced:run-7');
  });

  // Load-bearing regression: an unfindable row (bad runId, or a read that failed and returned
  // undefined) must fail OPEN — sync still runs — rather than silently losing every ordinary run's
  // Health sync to a lookup miss.
  test('a lookup miss (undefined sessionKey) does not skip the sync', () => {
    let calls = 0;
    const gated = skipForFieldTest(
      () => undefined,
      () => void calls++,
    );
    void gated('run-1');
    expect(calls).toBe(1);
  });
});
