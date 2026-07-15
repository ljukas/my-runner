# Run countdown & progress bar: centisecond precision, exact-boundary advance

**Date:** 2026-07-15
**Branch:** `ll/stage-2-spoken-coach` (same PR)
**Components:** `src/components/skia-countdown.tsx`, `src/components/run-progress-bar.tsx`, `src/app/run.tsx`, `src/services/run-engine`

## Problem

Three related defects on the active run screen, all stemming from one root cause:

1. **Countdown advances at `0:01`, never shows `0:00`.** `run.tsx` samples the engine with `secondsLeft = Math.ceil(remaining)` and only re-renders on a 1 s `setInterval` heartbeat. While `remaining ∈ (0, 1]` the display reads `0:01`; the instant `remaining` crosses 0, `positionAt` has already moved to the next segment and `remaining` resets to that segment's full duration — so `0:00` is never displayed. There is no sub-second motion at all.
2. **No centiseconds.** The user wants the countdown accurate to hundredths (`M:SS.CC`).
3. **Progress bar stops ~one second short.** The last heartbeat before the boundary sets `progress = (total-1)/total ≈ 0.98` and starts a 1 s `withTiming`; the segment flips mid-animation and the fill jumps to the next segment (`≈ 0`) having never reached `1.0`.

Root cause: display and transition are driven by discrete 1 s samples plus `ceil`, and the segment advances before `0:00.00` is ever reached or drawn. The engine's `segmentSecondsRemaining` is already a precise float — the inaccuracy is entirely in the sampling/display layer.

## Feasibility notes (verified against installed versions)

- `number-flow-react-native@skia` `SkiaTimeFlow` natively supports a `centiseconds` (0–99) prop rendered as `.CC` after the seconds, **and** a mutually-exclusive `sharedValue: SharedValue<string>` worklet-driven ("scrubbing") mode that takes a pre-formatted time string and animates digit transitions on the UI thread. We use the `sharedValue` mode so the fast tick never touches the JS thread.
- `react-native-reanimated@4.5.0`: `withTiming(toValue, config, callback?)` where `AnimationCallback = (finished?: boolean, current?: AnimatableValue) => void` runs as a worklet on the UI thread. `useSharedValue`, `useDerivedValue`, `useAnimatedStyle`, `cancelAnimation`, `Easing`, `runOnJS` all exported. `withTiming`'s `duration` is real milliseconds driven by the frame clock.

## Approach: one animated value drives both leaves; its completion callback is the boundary

A single `remaining` `SharedValue<number>` (seconds) is the segment clock. Per segment it is seeded from the engine's authoritative value, then animated to `0` with a linear `withTiming` whose duration is the segment's remaining milliseconds. The animation's completion callback *is* the segment-advance trigger — so the value reaching `0`, the countdown showing `0:00.00`, the bar reaching `1.0`, and the logical advance are the **same event**. This eliminates the two-independent-clocks skew a separate `setTimeout` would introduce.

Both leaf components only *read* `remaining`; neither starts its own animation (that would double-fire the callback).

### Data flow

```
engine snapshot ──(segmentIndex, status change)──▶ useSegmentClock effect
   │                                                   │  reads runEngine.getSnapshot()
   │                                                   ▼
   │                              remaining.value = seed;  then
   │                              remaining.value = withTiming(0, {duration}, onDone)
   │                                                   │
   │                              ┌────────────────────┴─────────────────────┐
   │                              ▼ (read only)                               ▼ (read only)
   │                   SkiaCountdown                                RunProgressBar
   │                   useDerivedValue → "M:SS.CC"                  useAnimatedStyle → width
   │                   → SkiaTimeFlow sharedValue                   = clamp(1-remaining/total)
   │                              │
   │                              ▼ (worklet completes)
   └──── runEngine.heartbeat(segmentEndsAt) ◀── runOnJS(advanceAtBoundary)
```

## Changes

### 1. Engine (`src/services/run-engine/types.ts`, `engine.ts`)

Add `segmentEndsAt: number | null` to `RunSnapshot` — the epoch-ms wall-clock instant the current segment ends.

- In `refresh()`, when not `done`: `segmentEndsAt = now + pos.secondsRemaining * 1000`. When `done` or in `IDLE_SNAPSHOT`: `null`.
- Because `now` and `secondsRemaining` both come from the event-log-derived active elapsed, `segmentEndsAt` is valid until the next pause/resume/skip — each of which re-emits a fresh snapshot.
- The engine adds **no timers** and stays purely `now`-driven; `engine.test.ts` is unaffected except for new assertions.

`heartbeat(now)` already accepts an explicit `now`; `advanceAtBoundary` passes `segmentEndsAt` so the engine deterministically crosses the boundary even when the frame lands a hair early or late. `finalize()` still appends `end` using the real `this.clock()`, so persisted records stay Date.now-accurate.

### 2. `useSegmentClock` hook (new, `src/services/run-engine/use-segment-clock.ts` or co-located)

Owns the single `remaining` shared value and the sole `withTiming` + callback. Returns `remaining` for the leaves to read.

```ts
export function useSegmentClock(segmentIndex: number, status: EngineStatus) {
  const remaining = useSharedValue(0);
  useEffect(() => {
    const snap = runEngine.getSnapshot();           // fresh authoritative values
    cancelAnimation(remaining);
    if (status === 'running' && snap.segmentEndsAt != null) {
      remaining.value = snap.segmentSecondsRemaining;
      remaining.value = withTiming(
        0,
        { duration: snap.segmentSecondsRemaining * 1000, easing: Easing.linear },
        (finished) => {
          'worklet';
          if (finished) runOnJS(advanceAtBoundary)(snap.segmentEndsAt!);
        },
      );
    } else {
      // paused / idle / done: freeze at the authoritative value
      remaining.value = snap.segmentSecondsRemaining;
    }
  }, [segmentIndex, status, remaining]);
  return remaining;
}
```

- **Deps are `[segmentIndex, status]` only** — per-second heartbeats update `segmentSecondsRemaining` in the snapshot but must NOT restart the animation. Fresh values are read via `runEngine.getSnapshot()` inside the effect (which runs exactly at segment/status transitions, when those values are correct), sidestepping `exhaustive-deps`.
- `advanceAtBoundary = (endsAt: number) => runEngine.heartbeat(endsAt)`.
- Pause → `cancelAnimation` + freeze at `segmentSecondsRemaining`. Resume → status change re-runs the effect → re-seed + re-animate for the (pause-adjusted) remaining. Skip → segmentIndex change re-runs the effect.

### 3. `run.tsx`

- Call `const remaining = useSegmentClock(snapshot.segmentIndex, snapshot.status)` and pass `remaining` to both leaves alongside `color`, `segmentIndex`, and `segmentSecondsTotal`.
- **Keep the 1 s `setInterval` heartbeat** as the wall-clock safety net: it drives the footer `elapsed / total` text and the halfway cue, and re-syncs the engine after any JS stall or foreground. Advance is idempotent `positionAt` recomputation, so the completion callback and the 1 s tick can never skip or double-advance.
- Remove the now-dead `segmentProgress` / `ceil`-based `secondsLeft` display math. Keep a whole-second `minutes`/`seconds` derivation **only** for the countdown's accessibility label.

### 4. `SkiaCountdown` (`src/components/skia-countdown.tsx`)

- New props: `remaining: SharedValue<number>`, `color`, plus `minutes`/`seconds` (whole-second, for a11y only).
- `const clockString = useDerivedValue(() => formatMMSSCC(remaining.value))` (worklet) → feed `SkiaTimeFlow` via `sharedValue={clockString}` instead of `minutes`/`seconds`.
- `formatMMSSCC` worklet: `cs = Math.ceil(Math.max(0, remaining) * 100)` total centiseconds → `M:SS.CC`; `ceil` makes `0:00.00` appear only at exactly 0.
- Accessibility unchanged in spirit: wrapper `View` keeps `accessibilityLabel={`${minutes}:${pad(seconds)}`}` at whole-second granularity (updated ~1×/s from the snapshot) — VoiceOver reading hundredths would be noise.

### 5. `RunProgressBar` (`src/components/run-progress-bar.tsx`)

- New props: `remaining: SharedValue<number>`, `totalSeconds: number`, `color`, `segmentIndex`.
- Replace the `withTiming`/`Easing`/`prevSegment` machinery with `useAnimatedStyle(() => ({ width: clamp(0, 1, 1 - remaining.value / totalSeconds) * width }))`. Frame-driven from the shared value → already smooth, reaches exactly `1.0` at completion, then the next segment's re-seed resets it to `0` with no backward sweep. Freeze follows `remaining` automatically (it's frozen on pause).

## Testing

**Unit (`engine.test.ts`, `bun test`):** assert `segmentEndsAt` is `≈ now + remaining*1000` while running, `null` at idle/completion, and re-computed after a skip.

**On-device (Argent, per AGENTS.md — required for visible UI):**
1. Centiseconds tick smoothly (UI-thread; no JS jank).
2. Countdown reaches `0:00.00` and *then* advances to the next segment.
3. Progress bar visibly fills to full before resetting to the next segment.
4. Pause freezes both countdown and bar; resume continues from the frozen value.
5. Skip immediately re-targets both to the new segment.
6. **Risk to confirm:** `SkiaTimeFlow` `sharedValue` string path renders the `.CC` slot and `.` symbol as cleanly as the numeric `centiseconds` prop. If not, fall back to rendering `.CC` as a sibling `SkiaNumberFlow` (its own `sharedValue`) beside an `M:SS` `SkiaTimeFlow`.

## Out of scope

- True background execution (animation freezes when backgrounded; the 1 s heartbeat re-syncs on foreground). Full background running is ADR 0008, a later stage.
- Any change to cue timing, plan data, or persistence beyond the additive `segmentEndsAt` field.
