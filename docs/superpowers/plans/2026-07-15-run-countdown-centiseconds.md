# Run Countdown Centiseconds & Exact-Boundary Advance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active-run countdown accurate to centiseconds (`M:SS.CC`), advance segments exactly at `0:00.00`, and fill the progress bar to 100% before it resets.

**Architecture:** One Reanimated `SharedValue<number>` (seconds remaining) is the per-segment clock, driven by a single linear `withTiming(…, 0)` whose completion callback advances the run engine — so the value hitting 0, the countdown showing `0:00.00`, the bar reaching `1.0`, and the logical segment advance are the **same event**. Both leaf components (`SkiaCountdown`, `RunProgressBar`) only *read* that shared value on the UI thread; no React re-render on the fast path. The engine stays the single source of truth: it gains an additive `segmentEndsAt` epoch-ms field, the completion callback calls `runEngine.heartbeat(segmentEndsAt)` for a deterministic crossing, and the existing 1 s heartbeat remains as the wall-clock safety net (footer text, halfway cue, stall/foreground re-sync).

**Tech Stack:** Expo SDK 57 / RN 0.86 / React 19.2 / TS ~6.0. `react-native-reanimated@4.5.0` (`withTiming`, `useSharedValue`, `useAnimatedReaction`, `useAnimatedStyle`, `cancelAnimation`, `runOnJS`, `Easing`). `number-flow-react-native/skia` `SkiaTimeFlow` (worklet-driven `sharedValue: SharedValue<string>` mode). `@shopify/react-native-skia`. Tests: `bun test` (pure TS only).

## Global Constraints

- Read Expo SDK 57 docs before touching Expo/RN APIs — https://docs.expo.dev/versions/v57.0.0/ (AGENTS.md). Do not rely on memorized RN/Expo APIs.
- No backend/accounts/analytics; on-device only. This change is client-only.
- Styling is Uniwind (`className`) / `@expo/ui` SwiftUI islands (ADR 0005); the countdown and bar are RN views hosted via `RNHostView` — do not change that hosting.
- Run engine is a wall-clock, event-log state machine (ADR 0007): engine stays pure and `now`-driven; **no timers inside the engine**. `heartbeat(now)` already accepts an explicit `now`.
- `AnimationCallback = (finished?: boolean, current?: AnimatableValue) => void` and the `withTiming` callback runs as a worklet on the UI thread — call JS via `runOnJS`.
- `SkiaTimeFlow`'s `sharedValue` prop is typed `SharedValue<string>` (mutable), so feed it a `useSharedValue<string>` updated via `useAnimatedReaction` — **not** a `useDerivedValue` (that returns a read-only `DerivedValue`, which is not assignable).
- Commit messages: Conventional Commits, `feat:` scope, ending with the `Co-Authored-By` trailer this repo uses.
- All visible-UI changes must be verified on the iOS simulator via Argent before "done" (AGENTS.md + `.claude/rules/argent.md`).

---

### Task 1: Engine `segmentEndsAt` field

Adds the wall-clock boundary the UI needs to self-drive and to cross deterministically.

**Files:**
- Modify: `src/services/run-engine/types.ts` (add field to `RunSnapshot`)
- Modify: `src/services/run-engine/engine.ts` (`IDLE_SNAPSHOT`, both branches of `refresh()`)
- Test: `src/services/run-engine/engine.test.ts` (new `describe('segmentEndsAt', …)`)

**Interfaces:**
- Produces: `RunSnapshot.segmentEndsAt: number | null` — epoch-ms instant the current segment ends while `running`; `null` when idle/paused-with-no-segment/completed/ended. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/run-engine/engine.test.ts` (uses the existing `makeEngine`/`tick`/`advance` helpers; `now` starts at `1_000_000`):

```ts
describe('segmentEndsAt', () => {
  test('is the wall-clock end of the active segment at start', () => {
    const { engine } = makeEngine();
    engine.start(SESSION); // now = 1_000_000, warmup 10s
    expect(engine.getSnapshot().segmentEndsAt).toBe(1_000_000 + 10_000);
  });

  test('tracks elapsed within a segment', () => {
    const { engine, tick } = makeEngine();
    engine.start(SESSION);
    tick(12); // now = 1_012_000, 18s left in the run segment
    expect(engine.getSnapshot().segmentEndsAt).toBe(1_012_000 + 18_000);
  });

  test('recomputes after a skip', () => {
    const { engine, advance } = makeEngine();
    engine.start(SESSION);
    advance(5); // 5s into warmup, no heartbeat
    engine.skipSegment(); // truncates warmup, enters run at now = 1_005_000
    const s = engine.getSnapshot();
    expect(s.segmentIndex).toBe(1);
    expect(s.segmentEndsAt).toBe(1_005_000 + 20_000);
  });

  test('is null at idle and after completion', () => {
    const { engine, tick } = makeEngine();
    expect(engine.getSnapshot().segmentEndsAt).toBeNull();
    engine.start(SESSION);
    tick(75); // exhausts the 75s timeline
    expect(engine.getSnapshot().status).toBe('completed');
    expect(engine.getSnapshot().segmentEndsAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/services/run-engine/engine.test.ts`
Expected: FAIL — the four new tests error (property `segmentEndsAt` is `undefined`, not the expected number/null).

- [ ] **Step 3: Add the field to the snapshot type**

In `src/services/run-engine/types.ts`, inside `interface RunSnapshot`, add the field right after `segmentSecondsTotal: number;`:

```ts
  segmentSecondsTotal: number;
  /** Epoch-ms the current segment ends while running; null when idle/done. */
  segmentEndsAt: number | null;
```

- [ ] **Step 4: Populate it in the engine**

In `src/services/run-engine/engine.ts`:

Add to `IDLE_SNAPSHOT` (after `segmentSecondsTotal: 0,`):

```ts
  segmentSecondsTotal: 0,
  segmentEndsAt: null,
```

In `refresh()`, the `pos.done` branch — add `segmentEndsAt: null,` (after `segmentSecondsTotal: …,`):

```ts
        segmentSecondsTotal: timeline[timeline.length - 1]?.effectiveSeconds ?? 0,
        segmentEndsAt: null,
        nextSegment: null,
```

In `refresh()`, the `else` (not-done) branch — add `segmentEndsAt` using the same `now` and `pos.secondsRemaining` already in scope (after `segmentSecondsTotal: segment.effectiveSeconds,`):

```ts
        segmentSecondsTotal: segment.effectiveSeconds,
        segmentEndsAt: now + pos.secondsRemaining * 1000,
        nextSegment: next ? { kind: next.kind, seconds: next.effectiveSeconds } : null,
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `bun test src/services/run-engine/engine.test.ts`
Expected: PASS (all, including the four new `segmentEndsAt` tests).

- [ ] **Step 6: Run the full unit suite (guard against whole-snapshot assertions)**

Run: `bun test`
Expected: PASS. If any pre-existing test compared a whole `RunSnapshot` with `toEqual`, add `segmentEndsAt` to its expected object; individual-field assertions need no change.

- [ ] **Step 7: Commit**

```bash
git add src/services/run-engine/types.ts src/services/run-engine/engine.ts src/services/run-engine/engine.test.ts
git commit -m "feat: engine exposes segmentEndsAt for the run clock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `formatCountdown` centisecond formatter

Pure worklet-safe formatter for the countdown string. Isolated so the correctness (`0:00.00` only at exactly zero) is unit-tested.

**Files:**
- Modify: `src/domain/format.ts` (add `formatCountdown`)
- Test: `src/domain/format.test.ts` (new `describe`, extend import)

**Interfaces:**
- Produces: `formatCountdown(remainingSeconds: number): string` → `"M:SS.CC"`. It carries a `'worklet'` directive so it can run inside a Reanimated reaction; the directive is an inert string literal under `bun test`. Consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

In `src/domain/format.test.ts`, extend the existing import line to include `formatCountdown`:

```ts
import {
  durationWords,
  formatClock,
  formatCountdown,
  formatMinutes,
  sessionSummary,
  sessionTitle,
} from './format';
```

Then append:

```ts
describe('formatCountdown', () => {
  test('renders m:ss.cc', () => {
    expect(formatCountdown(65)).toBe('1:05.00');
    expect(formatCountdown(9.99)).toBe('0:09.99');
    expect(formatCountdown(125.5)).toBe('2:05.50');
  });

  test('ceils to hundredths so 0:00.00 shows only at exactly zero', () => {
    expect(formatCountdown(0)).toBe('0:00.00');
    expect(formatCountdown(0.004)).toBe('0:00.01');
    expect(formatCountdown(59.999)).toBe('1:00.00');
  });

  test('never goes negative', () => {
    expect(formatCountdown(-3)).toBe('0:00.00');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/domain/format.test.ts`
Expected: FAIL — `formatCountdown` is not exported / not a function.

- [ ] **Step 3: Implement `formatCountdown`**

In `src/domain/format.ts`, add after `formatClock` (keep it near the other clock helper):

```ts
/**
 * `m:ss.cc` countdown with centiseconds, driven every frame on the UI thread.
 * Ceils to hundredths so `0:00.00` appears only at exactly zero. The `'worklet'`
 * directive lets it run inside a Reanimated reaction; it is an inert string
 * literal under `bun test`.
 */
export function formatCountdown(remainingSeconds: number): string {
  'worklet';
  const cs = Math.ceil(Math.max(0, remainingSeconds) * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/domain/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/format.ts src/domain/format.test.ts
git commit -m "feat: add formatCountdown centisecond clock formatter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `useSegmentClock` hook

The single owner of the driven shared value and the sole `withTiming` + boundary callback. A new, self-contained file; nothing imports it yet, so the build stays green and it is reviewable in isolation.

**Files:**
- Create: `src/services/run-engine/use-segment-clock.ts`

**Interfaces:**
- Consumes: `runEngine` (from `./index`), `RunSnapshot.segmentEndsAt` / `.segmentSecondsRemaining` / `.status` (Task 1), `EngineStatus` (from `./types`).
- Produces: `useSegmentClock(segmentIndex: number, status: EngineStatus): SharedValue<number>` — a shared value of **seconds remaining** for the current segment, animating to 0 and re-seeded on each segment/status change. Consumed by Task 4.

- [ ] **Step 1: Create the hook**

Create `src/services/run-engine/use-segment-clock.ts`:

```ts
import { useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  runOnJS,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { runEngine } from './index';
import type { EngineStatus } from './types';

/**
 * Advances the engine exactly at the segment boundary. Passing the boundary
 * timestamp makes the crossing deterministic regardless of frame timing;
 * `heartbeat` derives everything from the event log, so records stay correct.
 */
function advanceToBoundary(endsAt: number): void {
  runEngine.heartbeat(endsAt);
}

/**
 * The per-frame segment clock: one shared value (seconds remaining) driven by a
 * linear `withTiming` to 0 whose completion callback advances the run engine —
 * so the value hitting 0, the countdown reading 0:00.00, the bar reaching 1.0,
 * and the logical segment advance are the same event. Read-only for consumers;
 * both the countdown and the progress bar derive from it. Re-seeded from the
 * engine's authoritative snapshot on every segment or run-status change.
 */
export function useSegmentClock(segmentIndex: number, status: EngineStatus): SharedValue<number> {
  const remaining = useSharedValue(0);

  useEffect(() => {
    // Read fresh authoritative values here (not via deps) so per-second
    // heartbeats don't restart the animation; this effect only re-seeds on a
    // real segment/status transition.
    const snap = runEngine.getSnapshot();
    cancelAnimation(remaining);
    const remainingS = Math.max(0, snap.segmentSecondsRemaining);
    if (status === 'running' && snap.segmentEndsAt != null) {
      const endsAt = snap.segmentEndsAt;
      remaining.value = remainingS;
      remaining.value = withTiming(
        0,
        { duration: remainingS * 1000, easing: Easing.linear },
        (finished) => {
          'worklet';
          if (finished) runOnJS(advanceToBoundary)(endsAt);
        },
      );
    } else {
      // paused / idle / completed / endedEarly: freeze at the authoritative value
      remaining.value = remainingS;
    }
  }, [segmentIndex, status, remaining]);

  return remaining;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no errors). If a fresh clone/worktree errors on `@/global.css` or router types, start the dev server once to generate `.expo/types/router.d.ts` (AGENTS.md), then re-run.

- [ ] **Step 3: Lint**

Run: `bun run lint`
Expected: PASS. `exhaustive-deps` must not fire — the effect references only `segmentIndex`, `status`, and the stable `remaining`; the snapshot is read via `runEngine.getSnapshot()`, not a closure variable.

- [ ] **Step 4: Commit**

```bash
git add src/services/run-engine/use-segment-clock.ts
git commit -m "feat: add useSegmentClock hook driving the run clock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire the shared clock into the run screen

Reworks both leaf components to *read* the shared value and updates `run.tsx` to own the hook and pass it down. These change together (the prop contract couples them), so they land in one commit that ends green and is verified on-device. This is the task that fixes all three reported defects.

**Files:**
- Modify (rewrite): `src/components/skia-countdown.tsx`
- Modify (rewrite): `src/components/run-progress-bar.tsx`
- Modify: `src/app/run.tsx`

**Interfaces:**
- Consumes: `useSegmentClock` (Task 3), `formatCountdown` (Task 2), `RunSnapshot.segmentEndsAt` (Task 1).
- `SkiaCountdown` props → `{ remaining: SharedValue<number>; color: string; minutes: number; seconds: number }` (minutes/seconds are whole-second, accessibility-only).
- `RunProgressBar` props → `{ remaining: SharedValue<number>; totalSeconds: number; color: string }`.

- [ ] **Step 1: Rewrite `SkiaCountdown` to read the shared clock**

Replace the entire contents of `src/components/skia-countdown.tsx` with:

```tsx
import { Canvas, matchFont } from '@shopify/react-native-skia';
import { SkiaTimeFlow } from 'number-flow-react-native/skia';
import { useMemo } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useAnimatedReaction, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { formatCountdown } from '@/domain/format';

// Sized to fit `MM:SS.CC` (up to 8 tabular glyphs) within the run screen's
// content width on the narrowest target; tune on-device (Step 5).
const FONT_SIZE = 64;
const H_PADDING = 24; // matches the run screen VStack's horizontal padding
const CANVAS_HEIGHT = 120;
const BASELINE_Y = 86;

/**
 * The run screen's countdown, rendered with number-flow's Skia backend. Driven
 * entirely on the UI thread: a `useAnimatedReaction` formats the shared
 * `remaining` value into `M:SS.CC` and feeds `SkiaTimeFlow`'s worklet-driven
 * `sharedValue`, so the centiseconds roll at 60fps with no React re-render. A
 * React Native view (Skia `Canvas`) hosted in the SwiftUI tree via `RNHostView`
 * (ADR 0005).
 */
export function SkiaCountdown({
  remaining,
  color,
  minutes,
  seconds,
}: {
  remaining: SharedValue<number>;
  color: string;
  minutes: number;
  seconds: number;
}) {
  const width = useWindowDimensions().width - H_PADDING * 2;
  const font = useMemo(() => matchFont({ fontSize: FONT_SIZE, fontWeight: 'bold' }), []);
  // Seed the first paint from the whole-second props; the reaction drives it after.
  const clock = useSharedValue(`${minutes}:${String(seconds).padStart(2, '0')}.00`);
  useAnimatedReaction(
    () => remaining.value,
    (v) => {
      clock.value = formatCountdown(v);
    },
  );

  return (
    // Skia draws to a canvas VoiceOver can't read, so label the wrapper at
    // whole-second granularity (hundredths would be read as noise).
    <View
      style={{ width, height: CANVAS_HEIGHT }}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${minutes}:${String(seconds).padStart(2, '0')}`}
    >
      <Canvas style={{ flex: 1 }}>
        <SkiaTimeFlow
          sharedValue={clock}
          font={font}
          color={color}
          x={0}
          y={BASELINE_Y}
          width={width}
          textAlign="center"
          tabularNums
        />
      </Canvas>
    </View>
  );
}
```

- [ ] **Step 2: Rewrite `RunProgressBar` to read the shared clock**

Replace the entire contents of `src/components/run-progress-bar.tsx` with:

```tsx
import { useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

const TRACK_HEIGHT = 6;
// Matches the run screen VStack's horizontal padding so the bar spans the same
// width the SwiftUI Gauge did.
const H_PADDING = 24;

/**
 * The run screen's segment progress bar. Its fill is derived every frame on the
 * UI thread from the shared `remaining` value, so it sweeps smoothly and reaches
 * exactly 1.0 at the segment boundary; the next segment re-seeds `remaining`,
 * snapping the fill back to 0 with no backward sweep. A fixed-height RN view
 * hosted in the SwiftUI tree via `RNHostView` (ADR 0005); the fixed height keeps
 * segment changes from shifting the surrounding layout.
 */
export function RunProgressBar({
  remaining,
  totalSeconds,
  color,
}: {
  remaining: SharedValue<number>;
  totalSeconds: number;
  color: string;
}) {
  const width = useWindowDimensions().width - H_PADDING * 2;
  const fillStyle = useAnimatedStyle(() => {
    const progress = totalSeconds > 0 ? 1 - remaining.value / totalSeconds : 0;
    return { width: Math.min(1, Math.max(0, progress)) * width };
  });

  return (
    <View
      style={{
        width,
        height: TRACK_HEIGHT,
        borderRadius: TRACK_HEIGHT / 2,
        backgroundColor: 'rgba(120,120,128,0.2)',
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          { height: '100%', borderRadius: TRACK_HEIGHT / 2, backgroundColor: color },
          fillStyle,
        ]}
      />
    </View>
  );
}
```

- [ ] **Step 3: Wire `run.tsx`**

In `src/app/run.tsx`:

Add the hook import (with the other `@/` imports):

```tsx
import { useSegmentClock } from '@/services/run-engine/use-segment-clock';
```

Call the hook with the other hooks, **before** the `if (snapshot.status === 'idle')` early return (e.g. immediately after the second `useEffect`, around line 54):

```tsx
  const remaining = useSegmentClock(snapshot.segmentIndex, snapshot.status);
```

Delete the now-dead `segmentProgress` computation (the `const segmentProgress = …` block). Keep the `secondsLeft`/`minutes`/`seconds` derivation but retitle its comment, since it now feeds only the accessibility label:

```tsx
  const kind = snapshot.segmentKind ?? 'run';
  // Whole-second split for the countdown's accessibility label only; the visible
  // clock is driven on the UI thread from `remaining`.
  const secondsLeft = Math.max(0, Math.ceil(snapshot.segmentSecondsRemaining));
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
```

Replace the two hosted elements' props:

```tsx
          <RNHostView matchContents>
            <SkiaCountdown remaining={remaining} color={colors.text} minutes={minutes} seconds={seconds} />
          </RNHostView>
          <RNHostView matchContents>
            <RunProgressBar
              remaining={remaining}
              totalSeconds={snapshot.segmentSecondsTotal}
              color={SegmentColors[kind]}
            />
          </RNHostView>
```

Leave the 1 s `setInterval` heartbeat effect (`run.tsx:41-47`) unchanged — it remains the wall-clock safety net driving the footer and the halfway cue.

- [ ] **Step 4: Typecheck and lint**

Run: `bun run typecheck`
Expected: PASS. Confirm no unused-import errors — `run-progress-bar.tsx` no longer imports `useEffect`/`useRef`/`cancelAnimation`/`Easing`/`useSharedValue`/`withTiming`, and `run.tsx` no longer references `segmentProgress`.

Run: `bun run lint`
Expected: PASS.

- [ ] **Step 5: Verify on the iOS simulator (Argent)**

Follow `.claude/rules/argent.md` (skills: `argent-ios-simulator-setup`, `argent-react-native-app-workflow`, `argent-device-interact`). This is a native-free JS change, so the existing dev-client build is fine — start Metro and launch. Boot the simulator, launch the dev client (`myrunner://`), navigate Plan → a session → **Start run**, and verify against the design's acceptance criteria:

  1. **Centiseconds tick smoothly** (`M:SS.CC`), no JS-thread jank.
  2. **Advance at exactly `0:00.00`** — let the shortest segment (a 60–90 s run/walk) run out; the countdown reaches `0:00.00` and *then* moves to the next segment (it must not jump from `0:01`).
  3. **Progress bar fills to 100%** before it resets to the next segment (no "one second short").
  4. **Pause freezes** both the countdown and the bar; **Resume** continues from the frozen value.
  5. **Skip** immediately re-targets both to the new segment.
  6. **Layout:** the widest string (e.g. `30:00.00`) is centered and not clipped; take a screenshot. If it clips or looks too small, tune `FONT_SIZE` / `CANVAS_HEIGHT` / `BASELINE_Y` in `skia-countdown.tsx` and re-verify.
  7. **`.CC` rendering risk (design §Testing):** confirm `SkiaTimeFlow`'s `sharedValue` path renders the `.` and the two hundredths digits cleanly (tabular, no jitter). If it does not, fall back to rendering `.CC` as a sibling `SkiaNumberFlow` (its own `sharedValue`) beside an `M:SS` `SkiaTimeFlow`, then re-verify.

Capture a short screen recording or before/after screenshots as evidence (per `superpowers:verification-before-completion`).

- [ ] **Step 6: Commit**

```bash
git add src/components/skia-countdown.tsx src/components/run-progress-bar.tsx src/app/run.tsx
git commit -m "feat: drive run countdown & progress bar from a shared segment clock

Centisecond countdown, exact 0:00.00 boundary advance, and a bar that
fills to 100% before resetting.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Root-cause fixes (ceil/discrete sampling, advance-before-zero, bar one-second-short) → Task 4 (shared-clock drive) + Task 1 (exact boundary). ✓
- Centiseconds `M:SS.CC` → Task 2 (`formatCountdown`) + Task 4 (`SkiaTimeFlow sharedValue`). ✓
- Exact-boundary advance via `withTiming` completion callback → Task 3 (`useSegmentClock`) + Task 1 (`segmentEndsAt`, `heartbeat(endsAt)`). ✓
- Engine authoritative + 1 s safety net → Task 1 (pure, no timers) + Task 4 (keep the interval). ✓
- Unit test `segmentEndsAt` → Task 1 Step 1. On-device verification (6 criteria + `.CC` risk + layout) → Task 4 Step 5. ✓
- Out-of-scope items (background execution) untouched. ✓

**Placeholder scan:** none — every code step contains full code; commands have expected output.

**Type consistency:** `segmentEndsAt: number | null` defined in Task 1, consumed identically in Task 3. `useSegmentClock(segmentIndex, status)` signature and `SharedValue<number>` return match between Tasks 3 and 4. `SkiaCountdown`/`RunProgressBar` prop shapes declared in Task 4's Interfaces match their rewrites and the `run.tsx` call sites. `formatCountdown(number): string` matches between Tasks 2 and 4. `SkiaTimeFlow sharedValue` fed a mutable `useSharedValue<string>` (not `useDerivedValue`), per Global Constraints.
