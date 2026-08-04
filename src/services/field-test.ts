import type { PlanSession } from '@/domain/plan';

/**
 * Field-test captures (spec §8.0). A capture must not be a plan session: it would fire cues during
 * a stationary capture, mark a training day complete, and write a permanent Apple Health workout —
 * none of it reversible, since the app has no delete-run UI. The mechanism is the session key
 * alone: no plan day claims it, so the completion projection has nothing to mark.
 */
export const FIELD_TEST_SESSION_KEY = 'field-test';

/**
 * Gated per EAS profile (`preview`'s `env`), never `__DEV__` — `__DEV__` is false in `preview`,
 * which is the build the captures are actually taken with. Mirrors `isE2EBuild()` (services/e2e.ts).
 */
export function isFieldTestBuild(): boolean {
  return process.env.EXPO_PUBLIC_FIELD_TEST === '1';
}

export function isFieldTestRun(sessionKey: string): boolean {
  return sessionKey === FIELD_TEST_SESSION_KEY;
}

/** One long `walk` segment (60 min): no transitions to announce, nothing to skip (spec §8.0). */
export function fieldTestSession(): PlanSession {
  return {
    key: FIELD_TEST_SESSION_KEY,
    week: 0,
    day: 0,
    segments: [{ kind: 'walk', seconds: 3600 }],
  };
}

/**
 * Wraps a Health-sync callback so a field-test capture is never written to Apple Health (spec
 * §8.0) — the app has no way to undo it. `sessionKeyOf` is injected (rather than reading the DB
 * here) so this stays free of `@/db` and unit-testable; the composition root supplies the real
 * runId→sessionKey lookup.
 */
export function skipForFieldTest(
  sessionKeyOf: (runId: string) => string | undefined,
  sync: (runId: string) => void | Promise<unknown>,
): (runId: string) => void | Promise<unknown> {
  return (runId) => {
    if (isFieldTestRun(sessionKeyOf(runId) ?? '')) return;
    return sync(runId);
  };
}
