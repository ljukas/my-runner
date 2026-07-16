# Run Summary Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the run-summary screen addressable by run id (openable from both the post-run flow and any Log row) and redesign it as a card dashboard.

**Architecture:** The summary becomes a pure params + DB read — it imports **no** `runEngine`. The run screen passes `{ id, celebrate }` params on `replace`; the Log tab passes `{ id }` on `navigate`. Engine `reset()` moves to the *start* of a run (in the session sheet, before `start()`), because `start()` is a no-op unless the engine is `idle` — this guarantees a fresh engine per run while keeping the summary engine-free and avoiding both the finish-effect redirect race and the unmount strict-mode hazard.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19.2, expo-router (typed routes), @expo/ui (SwiftUI), Uniwind (Tailwind v4 classes), Drizzle + expo-sqlite, Bun test.

## Global Constraints

- **Expo SDK 57 / RN 0.86 / React 19.2 / TS ~6.0** — newer than most training data; verify any API against the installed version, never memory (AGENTS.md).
- **iOS-only.** No Android/web forks; branch inline with `Platform` if ever needed.
- **Styling is Uniwind** — style with `className` on core RN components; `cn()` merges so caller `className` wins.
- **ADR 0013 component conventions** — style primitives live in `src/components/ui/`, domain components at `src/components/` root, compounds via `Object.assign` dot-notation; screens **compose only** (no file-local components, no raw RN `Text`/`Pressable` in screens — use `@/components/ui/text` and `Island.Button`).
- **The summary must not import `runEngine`.**
- **Typed-route params are strings** — `celebrate: '1'`, and `String(number)` for numeric tile values.
- **Maestro selectors are text-first** (ADR 0016) — target visible text with anchored regex.
- **Any visible-UI change is verified on the iOS simulator via Argent before it's done** (AGENTS.md, `.claude/rules/argent.md`).
- **Every commit message ends with the trailer:**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- Work happens on branch `ll/run-summary-revamp` (already created).
- **Typecheck prerequisite:** `bun run typecheck` needs the generated `.expo/types/router.d.ts`; if it errors on `@/global.css` or route types, run `bun expo start` on a free port once until that file appears, then kill it.
- **`bun run lint --fix`** auto-formats (Prettier + Uniwind class sort are lint errors per ADR 0014); run it before committing UI files.

## File Structure

**New files:**
- `src/domain/run-stats.ts` — pure aggregation of a run's segment rows into the three grid stats. Depends on nothing but `SegmentKind`.
- `src/domain/run-stats.test.ts` — unit tests (`bun test`).
- `src/components/ui/card.tsx` — rounded `bg-background-element` surface primitive.
- `src/components/ui/badge.tsx` — status pill primitive (tone variants).
- `src/components/stat-grid.tsx` — `StatGrid` + `StatGrid.Tile` compound (composes `Card` + `Text`).

**Modified files:**
- `src/domain/format.ts` — add `formatRunDate`.
- `src/domain/format.test.ts` — add a `formatRunDate` case.
- `src/app/run-summary.tsx` — full rewrite (params + DB read, card-dashboard layout, `dismissAll`, no engine).
- `src/app/run.tsx` — finish effect passes `{ id, celebrate }` params.
- `src/app/session/[key].tsx` — `runEngine.reset()` before `runEngine.start()`. *(Has a pre-existing cosmetic uncommitted edit near the layout `<View>`s — preserve it; only touch the `onPress`. `bun run lint --fix` will re-sort its classes.)*
- `src/app/(tabs)/log.tsx` — rows tappable → `router.navigate` to the summary.
- `.maestro/tests/complete-session.yaml`, `.maestro/tests/run-controls.yaml` — update summary assertions.
- `.maestro/tests/log-revisit.yaml` — new revisit flow.

---

### Task 1: `runStats` domain helper

**Files:**
- Create: `src/domain/run-stats.ts`
- Test: `src/domain/run-stats.test.ts`

**Interfaces:**
- Produces:
  - `interface RunStatsSegment { kind: SegmentKind; actualDurationS: number }`
  - `interface RunStats { timeRunningS: number; runIntervals: number; longestRunS: number }`
  - `function runStats(segments: RunStatsSegment[]): RunStats`

- [ ] **Step 1: Write the failing test**

`src/domain/run-stats.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';

import { runStats } from './run-stats';

describe('runStats', () => {
  test('sums running time, counts run intervals, finds the longest', () => {
    expect(
      runStats([
        { kind: 'warmup', actualDurationS: 300 },
        { kind: 'run', actualDurationS: 60 },
        { kind: 'walk', actualDurationS: 90 },
        { kind: 'run', actualDurationS: 60 },
        { kind: 'walk', actualDurationS: 90 },
        { kind: 'run', actualDurationS: 60 },
        { kind: 'cooldown', actualDurationS: 300 },
      ]),
    ).toEqual({ timeRunningS: 180, runIntervals: 3, longestRunS: 60 });
  });

  test('longest reflects varying run lengths', () => {
    expect(
      runStats([
        { kind: 'run', actualDurationS: 300 },
        { kind: 'walk', actualDurationS: 180 },
        { kind: 'run', actualDurationS: 480 },
      ]),
    ).toEqual({ timeRunningS: 780, runIntervals: 2, longestRunS: 480 });
  });

  test('no run segments yields zeroes', () => {
    expect(
      runStats([
        { kind: 'warmup', actualDurationS: 300 },
        { kind: 'cooldown', actualDurationS: 120 },
      ]),
    ).toEqual({ timeRunningS: 0, runIntervals: 0, longestRunS: 0 });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `bun test src/domain/run-stats.test.ts`
Expected: FAIL — cannot resolve `./run-stats` (module not found).

- [ ] **Step 3: Write the minimal implementation**

`src/domain/run-stats.ts`:
```ts
import type { SegmentKind } from './plan';

export interface RunStatsSegment {
  kind: SegmentKind;
  actualDurationS: number;
}

export interface RunStats {
  /** Total seconds spent in run-kind segments. */
  timeRunningS: number;
  /** Number of run-kind segments in the recorded run. */
  runIntervals: number;
  /** Longest single run-kind segment, in seconds (0 if none). */
  longestRunS: number;
}

/** Aggregates a completed run's stored segments into the summary's grid stats. */
export function runStats(segments: RunStatsSegment[]): RunStats {
  const runs = segments.filter((s) => s.kind === 'run');
  return {
    timeRunningS: runs.reduce((sum, s) => sum + s.actualDurationS, 0),
    runIntervals: runs.length,
    longestRunS: runs.reduce((max, s) => Math.max(max, s.actualDurationS), 0),
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `bun test src/domain/run-stats.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/run-stats.ts src/domain/run-stats.test.ts
git commit -m "feat: add run-stats domain helper for summary tiles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `formatRunDate` helper

**Files:**
- Modify: `src/domain/format.ts`
- Test: `src/domain/format.test.ts`

**Interfaces:**
- Produces: `function formatRunDate(iso: string, locale?: string): string` → e.g. `"Thu, Jan 1"`.

- [ ] **Step 1: Write the failing test**

Add to `src/domain/format.test.ts` — extend the existing import from `'./format'` to include `formatRunDate`, then append this block:
```ts
describe('formatRunDate', () => {
  test('formats an ISO timestamp as weekday, month day', () => {
    expect(formatRunDate('2026-01-01T12:00:00.000Z', 'en-US')).toBe('Thu, Jan 1');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `bun test src/domain/format.test.ts`
Expected: FAIL — `formatRunDate is not a function` (not exported yet).

- [ ] **Step 3: Write the minimal implementation**

Append to `src/domain/format.ts`:
```ts
/** Run date for the summary header, e.g. "Thu, Jan 1". Locale-dependent (device locale by default). */
export function formatRunDate(iso: string, locale?: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `bun test src/domain/format.test.ts`
Expected: PASS. *(If the runtime's Intl renders a different exact string, adjust the expectation to match — the format spec is weekday-short / month-short / numeric-day.)*

- [ ] **Step 5: Commit**

```bash
git add src/domain/format.ts src/domain/format.test.ts
git commit -m "feat: add formatRunDate helper for the run summary header

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `Card` and `Badge` UI primitives

**Files:**
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/badge.tsx`

**Interfaces:**
- Produces:
  - `Card(props: ViewProps)` — rounded `bg-background-element` surface; caller `className` wins.
  - `Badge(props: { label: string; tone?: 'positive' | 'neutral'; className?: string })` — pill.

- [ ] **Step 1: Create `src/components/ui/card.tsx`**

```tsx
import { View, type ViewProps } from 'react-native';

import { cn } from '@/lib/cn';

/**
 * A rounded surface (ADR 0013 primitive) — the repeated `bg-background-element`
 * card idiom (session sheet, run summary). Caller `className` merges last via cn().
 */
export function Card({ className, ...props }: ViewProps) {
  return <View className={cn('rounded-2xl bg-background-element p-4', className)} {...props} />;
}
```

- [ ] **Step 2: Create `src/components/ui/badge.tsx`**

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

/**
 * A small status pill (ADR 0013). `tone` colours the label; the surface is the
 * neutral element background in both cases.
 */
const badgeLabelVariants = cva('font-semibold', {
  variants: {
    tone: {
      positive: 'text-primary',
      neutral: 'text-foreground-secondary',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export type BadgeProps = { label: string; className?: string } & VariantProps<
  typeof badgeLabelVariants
>;

export function Badge({ label, tone, className }: BadgeProps) {
  return (
    <View className={cn('self-start rounded-full bg-background-element px-2.5 py-1', className)}>
      <Text variant="footnote" className={cn(badgeLabelVariants({ tone }))}>
        {label}
      </Text>
    </View>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `bun run typecheck && bun run lint --fix`
Expected: no type errors; lint clean (formatting applied).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/card.tsx src/components/ui/badge.tsx
git commit -m "feat: add Card and Badge ui primitives

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `StatGrid` component

**Files:**
- Create: `src/components/stat-grid.tsx`

**Interfaces:**
- Consumes: `Card` (Task 3), `Text` (`@/components/ui/text`).
- Produces: `StatGrid` (root) with `StatGrid.Tile({ label: string; value: string })` — a 2-column wrapping grid of stat tiles.

- [ ] **Step 1: Create `src/components/stat-grid.tsx`**

```tsx
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

/**
 * A two-column grid of stat tiles (ADR 0013 domain component) for the run
 * summary. Tiles wrap, so adding more later (distance, pace) grows the grid.
 */
function StatGridRoot({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap justify-between gap-y-2">{children}</View>;
}

function StatGridTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="w-[48%]">
      <Text className="text-3xl font-bold" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      <Text variant="footnote" tone="secondary" className="mt-1 uppercase tracking-wide">
        {label}
      </Text>
    </Card>
  );
}

export const StatGrid = Object.assign(StatGridRoot, { Tile: StatGridTile });
```

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bun run lint --fix`
Expected: no type errors; lint clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/stat-grid.tsx
git commit -m "feat: add StatGrid component for the run summary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Addressable summary + run-screen handoff + redesign

This is the core, atomic change: the run screen and session sheet stop relying on the summary to own engine state, and the summary is rewritten to read params + DB. These land together because any split leaves a broken intermediate (the old summary reads the engine, which we're decoupling).

**Files:**
- Modify: `src/app/run.tsx:52-55`
- Modify: `src/app/session/[key].tsx:61-68`
- Rewrite: `src/app/run-summary.tsx`

**Interfaces:**
- Consumes: `runStats` (Task 1), `formatRunDate` (Task 2), `Card`/`Badge` (Task 3), `StatGrid` (Task 4), `SegmentBar`/`SegmentLegend` (existing), `sessionTitle`/`formatClock` (existing).
- Route contract: `/run-summary?id=<runId>&celebrate=<'1'|absent>`. `id` selects the run; `celebrate === '1'` shows the fresh-finish line.

- [ ] **Step 1: Update the run screen's finish effect to pass params**

In `src/app/run.tsx`, replace the effect at lines 52-55:
```tsx
  useEffect(() => {
    // Hand the run id + a fresh-finish flag to the summary via params; the
    // summary is engine-free and reads only these. `replace` so Back never
    // returns to the finished run. `savedRunId` is null only on save failure,
    // which the summary renders as its "couldn't be saved" state.
    if (finished && saveSettled) {
      router.replace({
        pathname: '/run-summary',
        params: { id: snapshot.savedRunId ?? '', celebrate: '1' },
      });
    }
  }, [finished, saveSettled, snapshot.savedRunId, router]);
```
*(If typed routes reject the object form, use the string `` `/run-summary?id=${snapshot.savedRunId ?? ''}&celebrate=1` ``.)*

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Reset the engine before starting a run**

In `src/app/session/[key].tsx`, update the `Island.Button` `onPress` (lines 61-68) — add `runEngine.reset()` before `start()`:
```tsx
        onPress={() => {
          // The engine's start() no-ops unless idle, so reset any prior
          // finished run here (its state lingers harmlessly until now — no
          // screen reads it between runs). This is why the summary no longer
          // needs to reset the engine on "Done".
          runEngine.reset();
          runEngine.start(session);
          // Replace, not push: the run screen is a full-screen modal, so the
          // session sheet must leave the stack — otherwise the lingering
          // formSheet bleeds into the accessibility tree behind the run/summary
          // modals and occludes their controls (e.g. the summary's "Done").
          router.replace('/run');
        }}
```
*(Leave the pre-existing cosmetic edits elsewhere in this file intact.)*

- [ ] **Step 4: Rewrite `src/app/run-summary.tsx`**

Replace the entire file with:
```tsx
import { asc, eq } from 'drizzle-orm';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Island } from '@/components/island';
import { SegmentBar } from '@/components/segment-bar';
import { SegmentLegend } from '@/components/segment-legend';
import { StatGrid } from '@/components/stat-grid';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { db } from '@/db/client';
import { runSegments, runs } from '@/db/schema';
import { formatClock, formatRunDate, sessionTitle } from '@/domain/format';
import { runStats } from '@/domain/run-stats';

type RunRow = typeof runs.$inferSelect;
type SegmentRow = typeof runSegments.$inferSelect;
type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'ready'; run: RunRow; segments: SegmentRow[] };

export default function RunSummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, celebrate } = useLocalSearchParams<{ id?: string; celebrate?: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!id) {
      setState({ status: 'missing' });
      return;
    }
    let active = true;
    void (async () => {
      const [[run], segments] = await Promise.all([
        db.select().from(runs).where(eq(runs.id, id)),
        db.select().from(runSegments).where(eq(runSegments.runId, id)).orderBy(asc(runSegments.seq)),
      ]);
      if (!active) return;
      setState(run ? { status: 'ready', run, segments } : { status: 'missing' });
    })();
    return () => {
      active = false;
    };
  }, [id]);

  let content: ReactNode;
  if (state.status === 'loading') {
    content = <Text tone="secondary">Loading…</Text>;
  } else if (state.status === 'missing') {
    content = (
      <Text tone="secondary">
        {id ? "This run isn't available." : 'This run could not be saved. Sorry about that.'}
      </Text>
    );
  } else {
    const { run, segments } = state;
    const completed = run.status === 'completed';
    const stats = runStats(segments);
    const barSegments = segments.map((s) => ({ kind: s.kind, seconds: s.actualDurationS }));
    content = (
      <View className="gap-4">
        {celebrate === '1' ? (
          <Text variant="smallBold" tone="primary">
            {completed ? 'Nice work! 🎉' : 'Good effort! 💪'}
          </Text>
        ) : null}
        <View className="flex-row items-start justify-between">
          <View className="gap-0.5">
            <Text variant="largeTitle">{sessionTitle(run.sessionKey)}</Text>
            <Text tone="secondary">{formatRunDate(run.startedAt)}</Text>
          </View>
          <Badge
            tone={completed ? 'positive' : 'neutral'}
            label={completed ? 'Completed' : 'Partial'}
          />
        </View>
        <StatGrid>
          <StatGrid.Tile label="Time running" value={formatClock(stats.timeRunningS)} />
          <StatGrid.Tile label="Run intervals" value={String(stats.runIntervals)} />
          <StatGrid.Tile label="Active time" value={formatClock(run.activeDurationS)} />
          <StatGrid.Tile label="Longest run" value={formatClock(stats.longestRunS)} />
        </StatGrid>
        <Card className="gap-3">
          <SegmentBar segments={barSegments} />
          <SegmentLegend segments={barSegments} />
        </Card>
      </View>
    );
  }

  // SwiftUI Island.Button (not an RN pill): an RN Pressable below an Island host
  // is painted but dropped from the a11y tree (host frame occludes it), leaving
  // "Done" invisible to VoiceOver and Maestro. `fill` brings its own sized host.
  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      {content}
      <View className="mt-auto pt-6">
        <Island.Button fill label="Done" onPress={() => router.dismissAll()} />
      </View>
    </View>
  );
}
```

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint --fix`
Expected: no type errors; lint clean.

- [ ] **Step 6: Verify on the iOS simulator (Argent)**

With the dev client installed and Metro running (`bun run start`, or `bun expo start` if already installed), use Argent (`.claude/rules/argent.md`): boot the sim, `launch-app`, then:
1. Complete a session end-to-end → confirm the summary shows the celebratory line ("Nice work! 🎉"), the session title + date, the four stat tiles (Time running / Run intervals / Active time / Longest run), the segment bar + legend, and **Done pinned to the bottom edge**.
2. Tap **Done** → returns to the plan list.
3. Start **another** session → confirm the run actually starts (proves `reset()`-before-`start()` works; a regression here would leave the engine stuck `completed`).
4. End a run early → summary shows "Good effort! 💪" + a "Partial" badge.
Expected: all pass; use `describe` before any tap (never guess coordinates).

- [ ] **Step 7: Commit**

```bash
git add src/app/run-summary.tsx src/app/run.tsx "src/app/session/[key].tsx"
git commit -m "feat: addressable run summary with card-dashboard redesign

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Open the summary from Log rows

**Files:**
- Modify: `src/app/(tabs)/log.tsx`

**Interfaces:**
- Consumes: the `/run-summary?id=` route (Task 5). Log passes **no** `celebrate`, so revisits show the neutral header (no celebratory line).

- [ ] **Step 1: Make each run row tap through to its summary**

In `src/app/(tabs)/log.tsx`:
1. Add imports:
```tsx
import { useRouter } from 'expo-router';
import { contentShape, font, monospacedDigit, onTapGesture, shapes } from '@expo/ui/swift-ui/modifiers';
```
   *(Merge with the existing `font`/`monospacedDigit` import from `@expo/ui/swift-ui/modifiers` — do not duplicate the line.)*
2. Inside `LogScreen`, add `const router = useRouter();`.
3. Add tap modifiers to the row `HStack` (the one keyed by `run.id`):
```tsx
          <HStack
            key={run.id}
            spacing={12}
            modifiers={[
              contentShape(shapes.rectangle()),
              onTapGesture(() =>
                router.navigate({ pathname: '/run-summary', params: { id: run.id } }),
              ),
            ]}
          >
```
   `contentShape(shapes.rectangle())` makes the whole row (including the `Spacer` gap) hittable; `navigate` (not `push`) avoids stacking duplicate modals on repeat taps.

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bun run lint --fix`
Expected: no type errors; lint clean.

- [ ] **Step 3: Verify the revisit path on the simulator (Argent)**

With at least one completed run in the Log: open the Log tab, `describe` the list, tap a run row → the summary opens with **no** celebratory line (neutral header), correct stats for that run, and **Done returns to the Log tab** (not the plan list). Tapping the same row twice must not stack two summaries.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(tabs)/log.tsx"
git commit -m "feat: open run summary from Log rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Update E2E flows + full verification

**Files:**
- Modify: `.maestro/tests/complete-session.yaml:10`
- Modify: `.maestro/tests/run-controls.yaml:29`
- Create: `.maestro/tests/log-revisit.yaml`

- [ ] **Step 1: Update the completed-run assertion**

In `.maestro/tests/complete-session.yaml`, the post-finish assertion currently reads `text: "Workout complete.*"`. Change it to the new celebratory line:
```yaml
      text: "Nice work.*"
```
Leave the following `- tapOn: "Done"` unchanged.

- [ ] **Step 2: Update the partial-run assertions**

In `.maestro/tests/run-controls.yaml`, the assertion `text: "Good effort!"` still matches the new copy ("Good effort! 💪") as a substring, but anchor it to be explicit:
```yaml
      text: "Good effort.*"
```
The later `- assertVisible: "Partial"` still holds (the status badge reads "Partial").

- [ ] **Step 3: Add a Log-revisit flow**

Create `.maestro/tests/log-revisit.yaml`. Reuse the existing helpers to reach a state with one completed run, then revisit it from Log. **Ground every selector with the Maestro MCP `inspect_screen` tool against the running `e2e-simulator` build before finalizing** (ADR 0016) — the draft below encodes the intended assertions:
```yaml
appId: se.lukaslindqvist.runbro.e2e
tags:
  - session
---
- runFlow: ../helpers/launch-and-onboard.yaml
- runFlow: ../helpers/start-first-session.yaml
# Finish the (compressed) session.
- extendedWaitUntil:
    visible:
      text: "Nice work.*"
    timeout: 20000
- tapOn: "Done"
# Revisit from the Log tab.
- tapOn: "Log"
- tapOn:
    text: "Week 1 · Day 1"
# The revisit header is neutral — the celebratory line must be absent.
- assertVisible:
    text: "Week 1 · Day 1"
- assertNotVisible:
    text: "Nice work.*"
- assertVisible: "Time running"
- tapOn: "Done"
- assertVisible:
    text: "No runs yet|Week 1"
```
*(Confirm the `start-first-session.yaml` helper leaves you on the finished session and that "Log" is the tab's visible label via `inspect_screen`; adjust anchors to match.)*

- [ ] **Step 4: Run the full Maestro suite**

Prereqs: booted simulator + the `e2e-simulator` build installed (`bun run e2e:build` if needed).
Run: `bun run e2e`
Expected: all flows pass (onboarding, session, run-controls, log-revisit).

- [ ] **Step 5: Full unit + type + lint gate**

Run: `bun test && bun run typecheck && bun run lint`
Expected: all pass, lint clean.

- [ ] **Step 6: Commit**

```bash
git add .maestro/tests/complete-session.yaml .maestro/tests/run-controls.yaml .maestro/tests/log-revisit.yaml
git commit -m "test: update e2e summary assertions and add log revisit flow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Addressable via `id` param → Tasks 5 (route contract, run-screen replace) + 6 (Log navigate). ✓
- `celebrate` fresh-finish line → Task 5. ✓
- Engine decoupling / `reset()` relocation → Task 5 (session sheet reset-before-start; run screen no longer resets; summary imports no engine). ✓ *(Relocated to the run's **start** rather than the run screen's unmount — the spec's unmount approach hits a React strict-mode remount hazard against the run screen's `idle → Redirect` guard; reset-before-`start()` achieves the same "engine-free summary" and "fresh engine per run" guarantees without it. Documented in Architecture.)*
- Done → `dismissAll()` only → Task 5. ✓
- Card-dashboard layout (celebratory line, header + badge, 2×2 grid, segment card, Done pinned to safe-area) → Task 5. ✓
- Stat tiles: Time running / Run intervals / Active time / Longest run → Tasks 1 + 5. ✓
- New units: `ui/badge`, `ui/card`, `stat-grid`, `domain/run-stats` (+tests), `formatRunDate` → Tasks 1–4. ✓
- Missing/not-found + save-failed empty states → Task 5 (`missing` state, `id`-present vs absent copy). ✓
- Testing: unit (Tasks 1–2), Maestro update + revisit flow (Task 7), simulator verification (Tasks 5–6). ✓
- Map slot left empty (no teaser) → Task 5 layout omits it. ✓

**2. Placeholder scan:** No TBD/TODO. The only "verify against the running build" note is on the E2E selectors, which is a genuine ADR-0016 grounding requirement, not a code placeholder; the draft YAML and all code blocks are complete.

**3. Type consistency:** `runStats` returns `{ timeRunningS, runIntervals, longestRunS }` (Task 1) and Task 5 consumes exactly those. `RunStatsSegment { kind, actualDurationS }` matches the `{ kind, seconds: actualDurationS }` mapping used for `SegmentBar`/`SegmentLegend` (those take `PlannedSegment { kind, seconds }`). `Badge` `tone: 'positive' | 'neutral'` (Task 3) matches Task 5's usage. `StatGrid.Tile({ label, value })` (Task 4) matches Task 5's calls (all `value` are strings — `formatClock(...)` and `String(...)`). Route params `{ id, celebrate }` are strings in every producer/consumer.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-16-run-summary-revamp.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — I execute the tasks in this session using executing-plans, batching with checkpoints for your review.

Which approach?
