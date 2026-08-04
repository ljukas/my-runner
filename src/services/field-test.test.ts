import { describe, expect, test } from 'bun:test';

import {
  FIELD_TEST_SESSION_KEY,
  fieldTestSession,
  isFieldTestRun,
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
