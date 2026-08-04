import { describe, expect, test } from 'bun:test';

import type { Run } from '@/db/schema';
import { FIELD_TEST_SESSION_KEY } from '@/services/field-test';
import { isHealthWritable } from './writable';

function row(overrides: Partial<Run> = {}): Pick<Run, 'sessionKey' | 'status' | 'healthkitSaved'> {
  return { sessionKey: 'w1d1', status: 'completed', healthkitSaved: false, ...overrides };
}

describe('isHealthWritable', () => {
  test('a finalized, unsaved plan run is writable', () => {
    expect(isHealthWritable(row())).toBe(true);
    expect(isHealthWritable(row({ status: 'partial' }))).toBe(true);
  });

  // Load-bearing regression: the backstop for the one write the app cannot undo (spec §8.0). Both
  // call sites gate too, but only this makes the invariant survive a future retry/backfill caller.
  test('a field-test capture is never writable, whatever its status', () => {
    expect(isHealthWritable(row({ sessionKey: FIELD_TEST_SESSION_KEY }))).toBe(false);
    expect(isHealthWritable(row({ sessionKey: FIELD_TEST_SESSION_KEY, status: 'partial' }))).toBe(
      false,
    );
  });

  test('an in-flight run is not writable — only a finalized one has an end to write', () => {
    expect(isHealthWritable(row({ status: 'active' }))).toBe(false);
  });

  test('an already-saved run is not writable, so HealthKit never gets it twice', () => {
    expect(isHealthWritable(row({ healthkitSaved: true }))).toBe(false);
  });
});
