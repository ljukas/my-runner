# Session Sheet Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the `session/[key]` form sheet so it fits its content, groups its stats in a card with a legend, describes the run in one line, adds a Walking total, uses the high-contrast Beacon segment palette, and gives the Start button full width.

**Architecture:** Pure-TS domain helpers (`sessionSummary`, `durationWords`, `sessionWalkSeconds`) feed a recomposed screen that reuses existing ADR-0013 primitives (`Text`, `StatList`, `Island.Button`) plus one new domain component (`SegmentLegend`). The segment palette lives in `SegmentColors` (shared with the run screen), so the run screen's segment-name label is decoupled from it first to stay legible.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / expo-router, Uniwind (Tailwind v4) `className` styling, `@expo/ui` SwiftUI islands, Drizzle + expo-sqlite, Bun + `bun:test`.

**Spec:** `docs/superpowers/specs/2026-07-14-session-sheet-redesign-design.md`

## Global Constraints

- On-device only; no backend/accounts/analytics. This change is **JS-only** — no new deps, no `app.json`/native changes (so the E2E gate repacks JS, no native rebuild).
- Beacon palette hexes (verbatim): warm-up `#FF7A00`, run `#3c87f7` (unchanged), walk `#FFC400`, cool-down `#00B39A`.
- Summary copy is exact (see Task 1 tests) — uniform / single-run / irregular-fallback phrasings.
- Stat **values are never tinted** with segment colours (contrast); the legend carries the colour mapping.
- Styling is Uniwind `className` (ADR 0002); components follow ADR 0013 (domain components in `src/components/`, screens compose only, no raw RN `Text` in screens).
- Conventional Commits for every commit; the **PR title** must be `feat: …` (it becomes the squash commit and drives release-please).
- Verify visible UI on the iOS simulator via Argent before considering UI work done (AGENTS.md).

## Branch setup (before Task 1)

Create the feature branch via `superpowers:using-git-worktrees` at execution time (branch name suggestion: `ll/session-sheet-redesign`). The **first commit on the branch is the docs** — the already-written spec plus this plan:

```bash
git add docs/superpowers/specs/2026-07-14-session-sheet-redesign-design.md \
        docs/superpowers/plans/2026-07-14-session-sheet-redesign.md
git commit -m "docs: session sheet redesign spec + plan"
```

> Note (fresh worktree only): `bun run typecheck` needs the gitignored `expo-env.d.ts` and `.expo/types/router.d.ts`. Copy `expo-env.d.ts` from the main checkout and run `bun expo start` on a free port until `.expo/types/router.d.ts` appears, then kill it. Never copy `router.d.ts` between checkouts.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/plan.ts` | add `sessionWalkSeconds` (pure) |
| `src/domain/format.ts` | add `durationWords`, `sessionSummary` (pure) |
| `src/domain/plan.test.ts` / `format.test.ts` | unit coverage for the above |
| `src/app/run.tsx` | segment-name label → theme foreground (decouple from `SegmentColors`) |
| `src/constants/theme.ts` | `SegmentColors` → Beacon |
| `src/components/segment-legend.tsx` | **new** colour key for the segment bar |
| `src/app/session/[key].tsx` | recomposed sheet body |
| `src/app/_layout.tsx` | `session/[key]` sheet detents → `fitToContents` |

---

## Task 1: Domain helpers — walk seconds + run summary

**Files:**
- Modify: `src/domain/plan.ts`
- Modify: `src/domain/format.ts`
- Test: `src/domain/plan.test.ts`, `src/domain/format.test.ts`

**Interfaces:**
- Produces: `sessionWalkSeconds(session: PlanSession): number`; `durationWords(seconds: number): string`; `sessionSummary(session: PlanSession): string`.
- Consumes: existing `formatMinutes`, `PlanSession`, `SegmentKind` from `src/domain`.

- [ ] **Step 1: Write the failing tests**

In `src/domain/plan.test.ts`, extend the `./plan` import to include `sessionWalkSeconds`, then add:

```ts
describe('sessionWalkSeconds', () => {
  test('sums only walk segments', () => {
    expect(sessionWalkSeconds(getSession(NHS_PLAN, 'w2d1')!)).toBe(600); // 5 × 120s
  });
  test('is zero for a single continuous run', () => {
    expect(sessionWalkSeconds(getSession(NHS_PLAN, 'w5d3')!)).toBe(0);
  });
});
```

In `src/domain/format.test.ts`, change line 3 to
`import { durationWords, formatClock, formatMinutes, sessionSummary, sessionTitle } from './format';`,
add `import { NHS_PLAN, getSession } from './plan';`, then add:

```ts
describe('durationWords', () => {
  test('whole minutes read as minutes', () => {
    expect(durationWords(120)).toBe('2-minute');
    expect(durationWords(300)).toBe('5-minute');
    expect(durationWords(60)).toBe('1-minute');
  });
  test('sub-minute reads as seconds', () => {
    expect(durationWords(90)).toBe('90-second');
  });
});

describe('sessionSummary', () => {
  const summary = (key: string) => sessionSummary(getSession(NHS_PLAN, key)!);
  test('uniform alternating (W2)', () => {
    expect(summary('w2d1')).toBe('Alternates 90-second runs with 2-minute walks, 6 times.');
  });
  test('uniform alternating (W1)', () => {
    expect(summary('w1d1')).toBe('Alternates 1-minute runs with 90-second walks, 8 times.');
  });
  test('single continuous run (W5D3)', () => {
    expect(summary('w5d3')).toBe('One continuous 20-minute run.');
  });
  test('irregular fallback (W3)', () => {
    expect(summary('w3d1')).toBe('4 run intervals with walk recovery · 9 min running.');
  });
  test('irregular fallback (W6D1)', () => {
    expect(summary('w6d1')).toBe('3 run intervals with walk recovery · 18 min running.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/domain/plan.test.ts src/domain/format.test.ts`
Expected: FAIL — `sessionWalkSeconds`, `durationWords`, `sessionSummary` are not exported.

- [ ] **Step 3: Implement `sessionWalkSeconds`**

Append to `src/domain/plan.ts` (next to `sessionRunSeconds`):

```ts
export function sessionWalkSeconds(session: PlanSession): number {
  return session.segments.filter((s) => s.kind === 'walk').reduce((sum, s) => sum + s.seconds, 0);
}
```

- [ ] **Step 4: Implement `durationWords` + `sessionSummary`**

In `src/domain/format.ts`, change the plan import to
`import { parseSessionKey, type PlanSession, type SegmentKind } from './plan';`, then append:

```ts
/** Human words for a segment length: whole minutes as "N-minute", otherwise "N-second". */
export function durationWords(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}-minute` : `${seconds}-second`;
}

/** One-line description of a session's core intervals (warm-up/cool-down excluded). */
export function sessionSummary(session: PlanSession): string {
  const { segments } = session;
  const from = segments[0]?.kind === 'warmup' ? 1 : 0;
  const to = segments[segments.length - 1]?.kind === 'cooldown' ? segments.length - 1 : segments.length;
  const core = segments.slice(from, to);

  if (core.length === 1 && core[0].kind === 'run') {
    return `One continuous ${durationWords(core[0].seconds)} run.`;
  }

  const runs = core.filter((s) => s.kind === 'run');
  const walks = core.filter((s) => s.kind === 'walk');
  const alternating =
    core.length === runs.length + walks.length &&
    runs.length === walks.length + 1 &&
    core.every((s, i) => s.kind === (i % 2 === 0 ? 'run' : 'walk'));
  const uniform =
    alternating &&
    runs.every((s) => s.seconds === runs[0].seconds) &&
    walks.every((s) => s.seconds === walks[0].seconds);
  if (uniform) {
    return `Alternates ${durationWords(runs[0].seconds)} runs with ${durationWords(walks[0].seconds)} walks, ${runs.length} times.`;
  }

  const totalRun = runs.reduce((sum, s) => sum + s.seconds, 0);
  return `${runs.length} run intervals with walk recovery · ${formatMinutes(totalRun)} running.`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/domain/plan.test.ts src/domain/format.test.ts`
Expected: PASS (all new cases green; existing cases still green).

- [ ] **Step 6: Commit**

```bash
git add src/domain/plan.ts src/domain/format.ts src/domain/plan.test.ts src/domain/format.test.ts
git commit -m "feat: add session walk-seconds and run-summary domain helpers"
```

---

## Task 2: Keep the run-screen segment label legible

The run screen colours the current segment's **name** with `SegmentColors[kind]` (`run.tsx:65`). Beacon's walk-yellow (and, already, warm-up/cool-down) is illegible as text on the plain background. Decouple the label from the palette *before* changing the palette so there is no illegible interim. The gauge keeps the segment tint as the colour cue.

**Files:**
- Modify: `src/app/run.tsx`

- [ ] **Step 1: Replace the coloured label with a themed `Island.Text`**

In `src/app/run.tsx`, replace this block (lines ~64–67):

```tsx
          {/* Segment accent is a domain color (SegmentColors), not a theme tone — direct Text. */}
          <Text modifiers={[font({ textStyle: 'title2' }), foregroundColor(SegmentColors[kind])]}>
            {paused ? 'Paused' : SEGMENT_KIND_LABEL[kind]}
          </Text>
```

with:

```tsx
          {/* Segment name uses the theme foreground — segment colour would be illegible as text
              (e.g. walk-yellow on white). The gauge below carries the segment colour cue. */}
          <Island.Text modifiers={[font({ textStyle: 'title2' })]}>
            {paused ? 'Paused' : SEGMENT_KIND_LABEL[kind]}
          </Island.Text>
```

- [ ] **Step 2: Drop the now-unused `foregroundColor` import**

In the `@expo/ui/swift-ui/modifiers` import (top of `run.tsx`), remove `foregroundColor`. Keep `SegmentColors` (still used by the gauge `tint` at line ~79) and `font`. If `Text` from `@expo/ui/swift-ui` is no longer referenced anywhere else in the file, remove it from that import too; the `ConfirmationDialog.Message` still uses `<Text>`, so it must stay — verify before removing.

- [ ] **Step 3: Verify types and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS, no unused-import errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/run.tsx
git commit -m "fix: keep run-screen segment label legible independent of palette"
```

---

## Task 3: Adopt the Beacon segment palette

**Files:**
- Modify: `src/constants/theme.ts`

- [ ] **Step 1: Replace `SegmentColors`**

In `src/constants/theme.ts`, change the `SegmentColors` map to:

```ts
/** Segment-kind accents (Beacon palette), shared by the SegmentBar, legend, and run screen. */
export const SegmentColors: Record<SegmentKind, string> = {
  warmup: '#FF7A00',
  run: PRIMARY,
  walk: '#FFC400',
  cooldown: '#00B39A',
};
```

(`PRIMARY` is `#3c87f7` — run stays the app primary.)

- [ ] **Step 2: Verify types**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/constants/theme.ts
git commit -m "feat: adopt Beacon high-contrast segment palette"
```

---

## Task 4: `SegmentLegend` component

**Files:**
- Create: `src/components/segment-legend.tsx`

**Interfaces:**
- Produces: `SegmentLegend({ segments }: { segments: PlannedSegment[] })`.
- Consumes: `SegmentColors`, `SEGMENT_KIND_LABEL`, `PlannedSegment`/`SegmentKind`.

- [ ] **Step 1: Create the component**

```tsx
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SegmentColors } from '@/constants/theme';
import { SEGMENT_KIND_LABEL } from '@/domain/format';
import type { PlannedSegment, SegmentKind } from '@/domain/plan';

const ORDER: SegmentKind[] = ['warmup', 'run', 'walk', 'cooldown'];

/**
 * Colour key for the SegmentBar (ADR 0013 domain component). One swatch + label
 * per kind present in the session, in plan order — a single continuous-run week
 * shows no "Walk".
 */
export function SegmentLegend({ segments }: { segments: PlannedSegment[] }) {
  const present = new Set(segments.map((s) => s.kind));
  const kinds = ORDER.filter((kind) => present.has(kind));
  return (
    <View className="flex-row flex-wrap gap-x-4 gap-y-1">
      {kinds.map((kind) => (
        <View key={kind} className="flex-row items-center gap-1.5">
          <View
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: SegmentColors[kind] }}
          />
          <Text variant="footnote" tone="secondary">
            {SEGMENT_KIND_LABEL[kind]}
          </Text>
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/segment-legend.tsx
git commit -m "feat: add SegmentLegend colour key"
```

---

## Task 5: Recompose the session sheet + fit-to-content

**Files:**
- Modify: `src/app/session/[key].tsx`
- Modify: `src/app/_layout.tsx`

**Interfaces:**
- Consumes: `sessionSummary`, `sessionWalkSeconds` (Task 1), `SegmentLegend` (Task 4), existing `SegmentBar`, `StatList`, `Island.Button` (`fill`).

- [ ] **Step 1: Replace the screen body**

Replace the whole return of `src/app/session/[key].tsx` (and update imports) so the file reads:

```tsx
import { and, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { SegmentBar } from '@/components/segment-bar';
import { SegmentLegend } from '@/components/segment-legend';
import { StatList } from '@/components/stat-list';
import { Text } from '@/components/ui/text';
import { db } from '@/db/client';
import { runCompleted } from '@/db/queries';
import { runs } from '@/db/schema';
import { formatMinutes, sessionSummary, sessionTitle } from '@/domain/format';
import {
  getSession,
  sessionRunSeconds,
  sessionTotalSeconds,
  sessionWalkSeconds,
} from '@/domain/plan';
import { useActivePlan } from '@/services/active-plan';
import { runEngine } from '@/services/run-engine';

export default function SessionSheet() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const plan = useActivePlan();
  const session = getSession(plan, key);
  const { data: attempts, updatedAt } = useLiveQuery(
    db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.sessionKey, key), runCompleted)),
    [key],
  );

  if (!session) return <Redirect href="/" />;

  return (
    <View className="gap-6 bg-background px-6 pb-8 pt-8">
      <View className="gap-1.5">
        <Text variant="subtitle">{sessionTitle(session.key)}</Text>
        <Text variant="footnote" tone="secondary">
          {sessionSummary(session)}
        </Text>
      </View>
      <View className="gap-4 rounded-2xl bg-background-element p-4">
        <SegmentBar segments={session.segments} />
        <SegmentLegend segments={session.segments} />
        <View className="h-px bg-background-selected" />
        <StatList>
          <StatList.Row label="Total" value={formatMinutes(sessionTotalSeconds(session))} />
          <StatList.Row label="Running" value={formatMinutes(sessionRunSeconds(session))} />
          <StatList.Row label="Walking" value={formatMinutes(sessionWalkSeconds(session))} />
          <StatList.Row label="Completed" value={updatedAt ? `${attempts.length}×` : '—'} />
        </StatList>
      </View>
      <Island.Button
        fill
        label="Start session"
        onPress={() => {
          runEngine.start(session);
          router.push('/run');
        }}
      />
    </View>
  );
}
```

Key changes vs. today: root drops `flex-1` (required for `fitToContents`) and gains `pb-8`; title+summary grouped; card wraps bar + legend + hairline + stats; **Walking** row added; `Island.Button` gains `fill`.

- [ ] **Step 2: Set the sheet to fit its content**

In `src/app/_layout.tsx`, change the `session/[key]` screen options to:

```tsx
        <Stack.Screen
          name="session/[key]"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
          }}
        />
```

(Removes `sheetAllowedDetents: [0.5, 0.95]` and `sheetInitialDetentIndex: 0`. `'fitToContents'` is confirmed valid for SDK 57 form-sheet options.)

- [ ] **Step 3: Verify types and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/session/[key].tsx src/app/_layout.tsx
git commit -m "feat: redesign session sheet (fit-to-content, grouped card, summary, full-width CTA)"
```

---

## Task 6: Full verification & PR

**Files:** none (verification only); update selectors only if Maestro flags them.

- [ ] **Step 1: Unit + static gates**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all pass (new domain cases green).

- [ ] **Step 2: Simulator sweep (Argent)**

Load `argent-ios-simulator-setup` + `argent-react-native-app-workflow`. Boot the sim, run the dev client (`bun run ios` if not already installed), open the app, go to the plan list, and for each of these, open the sheet and screenshot:
- **W2 D1** (uniform): summary reads `Alternates 90-second runs with 2-minute walks, 6 times.`; sheet hugs content (no empty gap); grouped card with Beacon bar; legend shows Warm up / Run / Walk / Cool down; stats show Total / Running / Walking / Completed; Start button spans full width.
- **W5 D3** (single run): summary `One continuous 20-minute run.`; legend shows **no "Walk"**; Walking = `0 min`.
- **W3 D1** (irregular): summary `4 run intervals with walk recovery · 9 min running.`
Toggle the simulator between light and dark; confirm the palette reads well in both. Then open the **run screen** on a walk segment and confirm the "Walk" label is legible in light mode.

- [ ] **Step 3: E2E (Maestro)**

Run the session journey: `maestro test --include-tags session .maestro/` (or the Maestro MCP `run`). The added summary line and legend introduce new visible text — if any text-first selector now matches ambiguously, disambiguate per ADR 0016 (anchor the screen's unique heading; add `index`/`scrollUntilVisible` as needed) and re-run. Expected: session flow passes.

- [ ] **Step 4: Open the PR**

Push the branch and open a PR. Title (drives release-please): `feat: redesign session run sheet`. Body: summarize the four fixes, link the spec, and note it is JS-only (E2E repacks JS, no native rebuild). Do not push to `main` directly.

---

## Self-Review (completed while writing)

- **Spec coverage:** issue 1 → Task 5 (fitToContents + drop flex-1); issue 2 → Tasks 3 (palette) + 4 (legend) + 5 (card) + not-tinted stats; issue 3 → Task 1 (summary) + 5 (render); issue 4 → Task 5 (`fill`); run-screen fallout → Task 2; Walking stat → Tasks 1 + 5. All covered.
- **Placeholders:** none — every code/test step shows full code; every run step shows the command + expected result.
- **Type consistency:** `sessionSummary`/`sessionWalkSeconds`/`durationWords` signatures match between Task 1 and their call sites in Tasks 4–5; `SegmentLegend` prop shape matches its use in Task 5; `Island.Text`/`Island.Button` usages match the real component APIs.
