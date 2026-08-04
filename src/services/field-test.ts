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
 * How an interrupted run's snapshot is settled at launch, or null when there is nothing
 * identifiable to settle (discard the snapshot). A capture claims no plan day, so the plan lookup
 * cannot resolve it — yet its `'active'` row is as real as any run's, and nothing else would ever
 * close it: no view lists an active row and there is no delete-run UI. `offerable: false` means
 * finalize it as `partial` without asking, because a capture spliced across two sensor epochs is
 * not the continuous measurement the protocol asks for. `planSession` is injected so this stays
 * free of `@/services/active-plan` and unit-testable, as `skipForFieldTest` below is.
 */
export function resumeDispositionOf(
  sessionKey: string,
  planSession: (key: string) => PlanSession | undefined,
): { session: PlanSession; offerable: boolean } | null {
  if (isFieldTestRun(sessionKey)) return { session: fieldTestSession(), offerable: false };
  const session = planSession(sessionKey);
  return session ? { session, offerable: true } : null;
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
