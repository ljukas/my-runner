# Pace Chart Standstill Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a stationary runner from making one distance bucket an unbounded pace outlier that the chart's y axis fits itself to.

**Architecture:** One rule inside the existing pace fold. `smoothFix` already reports how many metres each fix committed; a leg that committed none, inside a run of such legs longer than 3 s, is a stop and contributes no time to its bucket. A shorter run of non-committing legs is the smoother's deadband accrual, and its seconds carry forward onto the leg that finally commits. Nothing is trimmed, no threshold constant is introduced, and `toRunProfile`'s signature does not change.

**Tech Stack:** TypeScript (strict), Bun test runner, pure-domain code under `src/domain/` with no Expo or React Native imports.

**Spec:** [docs/superpowers/specs/2026-08-05-pace-chart-stationary-time-design.md](../specs/2026-08-05-pace-chart-stationary-time-design.md). Read §4–§6 before Task 1; §16 records six Criticals from adversarial review that shaped this design, and the plan's ordering exists to keep them fixed.

## Global Constraints

- **Comments are WHY-only.** Never restate the code, the signature, or the types. No JSDoc types (`@param {T}`, `@returns`). JSDoc an exported symbol only when its contract is not obvious from the signature — units, ranges, null semantics, side effects. Reference an ADR (`// per ADR 0021`) rather than re-explaining architecture. A prior wave of this codebase landed ~49% comment lines and that is the failure mode to avoid.
- **`src/domain/` must import no Expo or React Native package.** Importing one crashes Bun's parser on `react-native`'s Flow entry point the moment the module loads, which would make the whole suite unrunnable.
- **No new constant.** The accrual guard is derived: `NEAR_STATIONARY_DEADBAND_M / NEAR_STATIONARY_SPEED_MPS`. Introducing a tuned speed threshold is the specific mistake review found in the previous revision (§16).
- **`toRunProfile(fixes, bucketCount?) => ProfilePoint[]` keeps its exact signature and return type.** No `RunProfile` wrapper, no `ProfileStop`.
- **Conventional Commits** on every commit (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- Run `bun test src/domain/run-profile.test.ts` after every code step. Run `bun run typecheck` and `bun run lint` before the final commit of each task.
- **Never edit** `CHANGELOG.md`, `src/db/migrations/`, `.expo/types/`, `ios/`, `bun.lock`, or the `version` field — a `PreToolUse` hook blocks these.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/domain/geo.ts` | GPS smoothing; owns `acceptedDeltaMeters` and the two near-stationary constants | unchanged (read only) |
| `src/domain/run-profile.ts` | The pace fold. Gains an internal leg model, the stop rule, and one new export | modify |
| `src/domain/run-profile.test.ts` | Pace fold suite | modify (1 test reversed, ~8 added) |
| `src/hooks/use-run-track.ts` | Loads fixes once, serves the route map and the profile | modify (carry the excluded seconds) |
| `src/components/run-profile-card.tsx` | The card, its heading, and the VoiceOver label | modify (disclosure line + label) |
| `src/components/run-profile-chart.tsx` | The victory-native chart | **unchanged** |
| `docs/superpowers/specs/2026-08-02-run-elevation-and-pace-chart-design.md` | Prior spec whose §5.2 this reverses | modify (amendment) |

Task 1 is pure domain and self-contained. Task 2 is the reversal, kept separate because a reviewer may reasonably want to gate on it alone. Task 3 wires the number through two files. Task 4 is the spec amendment.

---

## Task 1: The stop rule in the pace fold

**Files:**
- Modify: `src/domain/run-profile.ts` (replace the fold loop at lines 38–87; the `legMeters <= 0` branch at 66–70 is deleted)
- Test: `src/domain/run-profile.test.ts`

**Interfaces:**
- Consumes: from `./geo` — `createSmootherState()`, `smoothFix(state, fix) => { state, acceptedDeltaMeters, smoothedPoint, restarted }`, `MAX_GAP_S` (30), `NEAR_STATIONARY_DEADBAND_M` (1.5), `NEAR_STATIONARY_SPEED_MPS` (0.5), `type LocationFix`.
- Produces:
  - `toRunProfile(fixes: readonly LocationFix[], bucketCount?: number): ProfilePoint[]` — signature unchanged.
  - `excludedStandstillSeconds(fixes: readonly LocationFix[]): number` — total seconds excluded as standstill; `0` when none. Task 3 consumes this.
  - `ProfilePoint`, `PROFILE_SAMPLE_COUNT`, `isDrawableProfile`, `paceRange` — all unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/run-profile.test.ts`. Note `phasedRun`, `straightRun`, `bandContrast`, `STEADY_PACE_SEC_PER_KM`, `RUN_MPS` and `WALK_MPS` already exist in this file — do not redefine them.

```ts
describe('toRunProfile standstill', () => {
  test('a mid-run stop no longer poles its bucket, whatever its length', () => {
    // why lengths: today a stop's bucket grows without bound with the stop, because a distance
    // bucket divides seconds by metres and the metres stop arriving (spec §2).
    const slowest = [25, 60, 144].map((stopS) => {
      const profile = toRunProfile(
        phasedRun([
          { seconds: 300, mps: 3 },
          { seconds: stopS, mps: 0 },
          { seconds: 300, mps: 3 },
        ]),
        20,
      );
      const paces = profile
        .map((point) => point.paceSecPerKm)
        .filter((pace): pace is number => pace !== null);
      return Math.max(...paces);
    });

    for (const pace of slowest) {
      expect(pace).toBeLessThan(STEADY_PACE_SEC_PER_KM * 1.2);
    }
    // The bound does not move with the stop's length — that is the property, not the value.
    expect(Math.max(...slowest) - Math.min(...slowest)).toBeLessThan(1);
  });

  test('a stationary head or tail no longer flattens the chart', () => {
    const clean = bandContrast(toRunProfile(w1d1()));
    const withHead = bandContrast(
      toRunProfile(phasedRun([{ seconds: 45, mps: 0 }, ...w1d1Phases()])),
    );
    const withTail = bandContrast(
      toRunProfile(phasedRun([...w1d1Phases(), { seconds: 170, mps: 0 }])),
    );

    expect(clean).toBeGreaterThan(0.8);
    expect(withHead).toBeGreaterThan(0.8);
    expect(withTail).toBeGreaterThan(0.8);
  });

  test('a walker slower than the deadband is not reported faster than they ran', () => {
    // why this is the assertion that matters: dropping the deadband's accrual seconds instead of
    // carrying them reports a 0.4 m/s walker at 10:26 /km against a true 41:40 (spec §5 case 3).
    for (const mps of [0.4, 0.5, 0.6, 0.8, 1.1, 1.4]) {
      const profile = toRunProfile(straightRun(600, mps));
      const paces = profile
        .map((point) => point.paceSecPerKm)
        .filter((pace): pace is number => pace !== null);

      expect(paces).toHaveLength(profile.length);
      const median = [...paces].sort((a, b) => a - b)[Math.floor(paces.length / 2)];
      expect(median).toBeCloseTo(1000 / mps, -1);
    }
  });

  test('a leg that committed distance is never excluded', () => {
    // The previous design deleted a leg at 1.90 m/s as standstill (spec §16). This pins that a
    // moving run loses no time at all: its mean pace must equal the untouched steady case.
    const profile = toRunProfile(straightRun(600, 1.4));
    expect(meanPace(profile)).toBeCloseTo(1000 / 1.4, -1);
  });

  test('the buckets still sum to the run distance', () => {
    // why: an excluded leg committed nothing, so there are no metres to lose — conservation is
    // exact, not approximate (spec §6).
    const fixes = phasedRun([
      { seconds: 200, mps: 3 },
      { seconds: 60, mps: 0 },
      { seconds: 200, mps: 3 },
    ]);
    const profile = toRunProfile(fixes, 20);
    const width = smoothTrack(fixes).distanceM / 20;
    expect(profile.at(-1)!.distanceM + width / 2).toBeCloseTo(smoothTrack(fixes).distanceM, 9);
  });

  test('excludedStandstillSeconds reports the stop and nothing else', () => {
    const moving = straightRun(600, 3);
    expect(excludedStandstillSeconds(moving)).toBe(0);

    const stopped = phasedRun([
      { seconds: 200, mps: 3 },
      { seconds: 60, mps: 0 },
      { seconds: 200, mps: 3 },
    ]);
    const excluded = excludedStandstillSeconds(stopped);
    expect(excluded).toBeGreaterThan(50);
    expect(excluded).toBeLessThanOrEqual(60);
  });

  test('a bare gap is unmeasured, not a standstill', () => {
    // why: a gap leg commits nothing either, but it is already skipped by MAX_GAP_S and must not
    // be counted as excluded standstill or terminate-and-carry accrual across itself.
    expect(excludedStandstillSeconds(w1d1(240))).toBe(0);
  });
});
```

Add this helper beside `w1d1` (it exists so the two new fixtures can prepend and append phases without duplicating the shape):

```ts
/** W1D1's phases, for fixtures that need to bracket them with a standstill. */
function w1d1Phases(): Phase[] {
  const phases: Phase[] = [{ seconds: 300, mps: WALK_MPS }];
  for (let interval = 0; interval < 8; interval += 1) {
    phases.push({ seconds: 60, mps: RUN_MPS });
    phases.push({ seconds: 90, mps: WALK_MPS });
  }
  phases.push({ seconds: 300, mps: WALK_MPS });
  return phases;
}
```

Then change `w1d1` to build on it, so the shape lives once:

```ts
function w1d1(gapAfterFirstRunS = 0): LocationFix[] {
  const phases = w1d1Phases();
  if (gapAfterFirstRunS > 0) phases[1] = { ...phases[1], gapAfterS: gapAfterFirstRunS };
  return phasedRun(phases);
}
```

Extend the import at the top of the test file to include the new export:

```ts
import {
  excludedStandstillSeconds,
  isDrawableProfile,
  paceRange,
  PROFILE_SAMPLE_COUNT,
  toRunProfile,
  type ProfilePoint,
} from './run-profile';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/domain/run-profile.test.ts`

Expected: the new `toRunProfile standstill` block fails. `excludedStandstillSeconds` is not exported yet, so expect a `TypeError: excludedStandstillSeconds is not a function` or an import error, plus failures on the stop-bound and slow-walker cases.

Also expected at this point: **`'a standstill with fixes still counts as time — only gaps are excluded'` still passes**, because the implementation has not changed yet. Task 2 handles it.

- [ ] **Step 3: Replace the fold in `src/domain/run-profile.ts`**

Extend the existing `./geo` import:

```ts
import {
  createSmootherState,
  MAX_GAP_S,
  NEAR_STATIONARY_DEADBAND_M,
  NEAR_STATIONARY_SPEED_MPS,
  smoothFix,
  type LocationFix,
} from './geo';
```

Add above `toRunProfile`:

```ts
// why derived and not chosen: the longest the smoother's deadband can legitimately hold distance
// for a runner still moving at the measurable floor. A tuned speed threshold here deleted the
// chart outright for slow walkers — see the slice design §16.
const ACCRUAL_GUARD_S = NEAR_STATIONARY_DEADBAND_M / NEAR_STATIONARY_SPEED_MPS;

interface Leg {
  fromM: number;
  toM: number;
  seconds: number;
  committedM: number;
  /** False for a gap or a non-monotonic timestamp: unmeasured, which is not the same as stopped. */
  measured: boolean;
}

function legsOf(fixes: readonly LocationFix[]): { legs: Leg[]; total: number } {
  let state = createSmootherState();
  let cumulative = 0;
  const walked = fixes.map((fix) => {
    const step = smoothFix(state, fix);
    state = step.state;
    cumulative += step.acceptedDeltaMeters;
    return {
      distanceM: cumulative,
      timestamp: fix.timestamp,
      committedM: step.acceptedDeltaMeters,
    };
  });

  const legs: Leg[] = [];
  for (let i = 1; i < walked.length; i += 1) {
    const seconds = (walked[i].timestamp - walked[i - 1].timestamp) / 1000;
    legs.push({
      fromM: walked[i - 1].distanceM,
      toM: walked[i].distanceM,
      seconds,
      committedM: walked[i].committedM,
      measured: seconds > 0 && seconds <= MAX_GAP_S,
    });
  }
  return { legs, total: cumulative };
}

/**
 * Which legs fall inside a stop: a run of measured legs that committed nothing, lasting longer
 * than the deadband could legitimately hold. A shorter run is accrual, and its time is carried
 * rather than dropped (`toRunProfile`).
 */
function stoppedLegs(legs: readonly Leg[]): boolean[] {
  const stopped = new Array<boolean>(legs.length).fill(false);
  let index = 0;
  while (index < legs.length) {
    if (!legs[index].measured || legs[index].committedM > 0) {
      index += 1;
      continue;
    }
    let end = index;
    let seconds = 0;
    while (end < legs.length && legs[end].measured && legs[end].committedM === 0) {
      seconds += legs[end].seconds;
      end += 1;
    }
    if (seconds > ACCRUAL_GUARD_S) for (let i = index; i < end; i += 1) stopped[i] = true;
    index = end;
  }
  return stopped;
}

/** Seconds the pace fold discarded as standstill, for the card to disclose. 0 when the runner never stopped. */
export function excludedStandstillSeconds(fixes: readonly LocationFix[]): number {
  const { legs } = legsOf(fixes);
  const stopped = stoppedLegs(legs);
  return legs.reduce((sum, leg, index) => (stopped[index] ? sum + leg.seconds : sum), 0);
}
```

Replace the body of `toRunProfile` from the `let state = createSmootherState();` line through the end of the `for` loop (lines 38–81) with:

```ts
  const { legs, total } = legsOf(fixes);
  if (total <= 0) return [];
  const stopped = stoppedLegs(legs);

  const width = total / bucketCount;
  const meters = new Array<number>(bucketCount).fill(0);
  const seconds = new Array<number>(bucketCount).fill(0);
  let heldSeconds = 0;

  // Legs are split across the buckets they cross so a long one cannot step over a bucket and
  // leave it empty; both measurements behind this are in the pace chart design §5.2.
  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    // why the reset: a gap is unmeasured time, so it cannot carry accrued seconds across itself.
    if (!leg.measured) {
      heldSeconds = 0;
      continue;
    }
    if (stopped[i]) continue;

    const legMeters = leg.toM - leg.fromM;
    if (legMeters <= 0) {
      heldSeconds += leg.seconds;
      continue;
    }

    const legSeconds = leg.seconds + heldSeconds;
    heldSeconds = 0;
    const first = bucketAt(leg.fromM, width, bucketCount);
    const last = bucketAt(leg.toM, width, bucketCount);
    for (let bucket = first; bucket <= last; bucket += 1) {
      const overlap = Math.min(leg.toM, (bucket + 1) * width) - Math.max(leg.fromM, bucket * width);
      if (overlap <= 0) continue;
      meters[bucket] += overlap;
      seconds[bucket] += legSeconds * (overlap / legMeters);
    }
  }
```

Leave the closing `return meters.map(...)` exactly as it is. Update `toRunProfile`'s JSDoc: replace the sentence about folding distance with one line noting that a standstill's time is excluded per the slice design §4, and delete nothing else.

- [ ] **Step 4: Run the tests**

Run: `bun test src/domain/run-profile.test.ts`

Expected: the new `toRunProfile standstill` block passes. Exactly **one** pre-existing test now fails — `'a standstill with fixes still counts as time — only gaps are excluded'` at its `expect(Math.max(...paces)).toBeGreaterThan(STEADY_PACE_SEC_PER_KM * 1.2)` line, receiving ~389.9 against the asserted >400. This is verified expected behaviour, not a regression; Task 2 reverses it. All other tests in the file must pass.

If any *other* pre-existing test fails, stop and report — that is a real regression.

- [ ] **Step 5: Commit**

```bash
git add src/domain/run-profile.ts src/domain/run-profile.test.ts
git commit -m "feat: exclude standstill time from the pace chart's buckets"
```

---

## Task 2: Reverse the standstill test the prior spec pinned

**Files:**
- Modify: `src/domain/run-profile.test.ts:210-226` (the test `'a standstill with fixes still counts as time — only gaps are excluded'`)

**Interfaces:**
- Consumes: `toRunProfile` from Task 1. Nothing new.
- Produces: a green suite.

This is its own task because it reverses a decision an earlier spec made deliberately, and a reviewer should be able to gate on that alone.

- [ ] **Step 1: Replace the test**

The existing test asserts the behaviour this slice removes. Replace it wholesale with one that pins the new rule *and* the property the old test never covered — that the stop stays at its own position in the series (the spec's §15 notes this was previously unpinned):

```ts
  test('a standstill with fixes is excluded, and only slows the bucket it happened in', () => {
    // Reverses the pace chart design's §5.2 decision that such a standstill must slow its bucket.
    // Measured there: a 6 s stop cost its bucket 2:49 /km, and the fixes keep arriving at ~1 Hz so
    // MAX_GAP_S never sees it (slice design §2, §3).
    const stalled = toRunProfile(
      phasedRun([
        { seconds: 300, mps: 3 },
        { seconds: 25, mps: 0 },
        { seconds: 300, mps: 3 },
      ]),
      20,
    );
    const paces = stalled
      .map((point) => point.paceSecPerKm)
      .filter((pace): pace is number => pace !== null);

    expect(Math.max(...paces)).toBeLessThan(STEADY_PACE_SEC_PER_KM * 1.2);
    expect(Math.min(...paces)).toBeCloseTo(STEADY_PACE_SEC_PER_KM, -1);

    // The stop is at the halfway point, so any residual slowness belongs to the middle of the
    // series and the first and last buckets must be untouched.
    expect(stalled[0].paceSecPerKm).toBeCloseTo(STEADY_PACE_SEC_PER_KM, -1);
    expect(stalled.at(-1)!.paceSecPerKm).toBeCloseTo(STEADY_PACE_SEC_PER_KM, -1);
  });
```

- [ ] **Step 2: Run the full domain suite**

Run: `bun test`

Expected: PASS, every test, no failures.

- [ ] **Step 3: Typecheck and lint**

Run: `bun run typecheck && bun run lint`

Expected: both clean. If `typecheck` fails on `@/global.css` or route typings, that is the known fresh-worktree gap — start the dev server once (`bun expo start`, kill it as soon as `.expo/types/router.d.ts` appears) and re-run.

- [ ] **Step 4: Commit**

```bash
git add src/domain/run-profile.test.ts
git commit -m "test: pin that a standstill with fixes is excluded from pace"
```

---

## Task 3: Disclose the excluded time on the card

**Files:**
- Modify: `src/hooks/use-run-track.ts` (the `RunTrack` type near line 36 and `foldProfile` at 65–73)
- Modify: `src/components/run-profile-card.tsx` (the label at 29–35, the heading row at 43–55)

**Interfaces:**
- Consumes: `excludedStandstillSeconds(fixes) => number` from Task 1; `formatClock` from `@/domain/format`.
- Produces: `RunTrack.excludedStandstillS: number` on the ready branch. No other consumer of this hook changes.

Why the card and not the chart: the chart is a Skia canvas with no accessible content, and the divergence being disclosed is a property of the series, not of the drawing. `run-profile-chart.tsx` is not touched in this task or any other.

- [ ] **Step 1: Write the failing check**

There is no unit test for these two files — both are RN components/hooks, and `bun test` cannot import them (a React Native import crashes Bun's parser). Verification is the simulator pass in Step 5. Before editing, confirm what the label reads today so the change is visible:

Run: `grep -n "Pace profile over" src/components/run-profile-card.tsx`

Expected: one hit, at the `label` array.

- [ ] **Step 2: Carry the number through the hook**

In `src/hooks/use-run-track.ts`, extend the import from `@/domain/run-profile`:

```ts
import {
  excludedStandstillSeconds,
  isDrawableProfile,
  toRunProfile,
  type ProfilePoint,
} from '@/domain/run-profile';
```

Change `RunTrack`'s ready branch to carry the seconds beside the profile:

```ts
export type RunTrack =
  | { ready: false }
  | (ReadyRoute & {
      /** The pace series, or null when it is absent, unstrokable (spec §8), or failed to fold. */
      profile: ProfilePoint[] | null;
      /** Seconds the fold discarded as standstill; the card discloses it (slice design §9). */
      excludedStandstillS: number;
    });
```

Change `foldProfile` to return both, keeping its existing try/catch semantics — a throw must still leave the route map alive:

```ts
function foldProfile(fixes: readonly SegmentedFix[]): {
  points: ProfilePoint[] | null;
  excludedStandstillS: number;
} {
  try {
    const points = toRunProfile(fixes);
    return {
      points: isDrawableProfile(points) ? points : null,
      excludedStandstillS: excludedStandstillSeconds(fixes),
    };
  } catch (error) {
    console.warn('[use-run-track] pace fold failed; keeping the route', error);
    return { points: null, excludedStandstillS: 0 };
  }
}
```

Then update `useTrack`'s ready-branch construction to spread the two fields — read the surrounding code and set `profile` from `.points` and `excludedStandstillS` from `.excludedStandstillS`, leaving the `withProfile` gate and the route fields exactly as they are.

- [ ] **Step 3: Add the disclosure to the card**

In `src/components/run-profile-card.tsx`, extend the imports:

```ts
import { formatClock, formatDistanceKm, formatPace, paceParts } from '@/domain/format';
```

Destructure the new field and build the disclosure. Replace the `label` block with:

```ts
  const range = paceRange(track.profile);
  const excluded = track.excludedStandstillS >= 1 ? formatClock(track.excludedStandstillS) : null;
  const label = [
    `Pace profile over ${formatDistanceKm(run.distanceM)}.`,
    range &&
      `The chart spans ${paceParts(range.fastestSecPerKm).value} to ${formatPace(range.slowestSecPerKm)}.`,
    excluded && `Excludes ${excluded} standing.`,
  ]
    .filter(Boolean)
    .join(' ');
```

Then add the line under the heading row, after the existing `</View>` that closes it and before the chart's wrapper:

```tsx
      {/* why on the card and not the chart: excluding standing time makes this series disagree with
          the summary's own Avg Pace, by exactly this much. Disclosed rather than left silent
          (slice design §9). */}
      {excluded ? (
        <Text variant="caption" tone="secondary">
          Excludes {excluded} standing
        </Text>
      ) : null}
```

- [ ] **Step 4: Typecheck and lint**

Run: `bun run typecheck && bun run lint`

Expected: both clean. `lint` includes Prettier and Uniwind class sorting as errors; `bun run lint --fix` auto-formats.

- [ ] **Step 5: Verify on the simulator**

Load the `verify` skill and follow it. Any change to visible UI or copy must be confirmed on the iOS simulator before this task is done.

What to check on a finished run's summary, reached from the History tab:
1. A run with no standing shows **no** disclosure line — the card looks exactly as it does today.
2. A run with standing shows `Excludes M:SS standing` in caption/secondary under the `Pace` heading.
3. The chart's line still spans the full width of the plot — the x extent must equal the run's distance, not less.
4. VoiceOver label: confirm the card's `accessibilityLabel` now ends with the `Excludes …` sentence, via `describe`.

Seeding a run with standing on a simulator needs GPS motion that then stops. Drive the simulator's own route engine, which does work (per AGENTS.md), and simply stop it mid-run:

```bash
xcrun simctl location <udid> start --speed=2.8 --interval=1.0 59.3293,18.0686 59.3353,18.0686
# let the run record, then:
xcrun simctl location <udid> clear
# leave the app recording for ~30 s before finishing the run
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-run-track.ts src/components/run-profile-card.tsx
git commit -m "feat: disclose standstill time excluded from the pace chart"
```

---

## Task 4: Amend the prior spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-02-run-elevation-and-pace-chart-design.md` (§5.2, the paragraph ending *"A stop without a pause (a traffic light the runner ran through) still counts — that is real elapsed time, and only a bare gap is unmeasured."*)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add the amendment**

Append to the end of that §5.2 bullet, keeping the original sentence in place so the reversal is legible rather than hidden:

```markdown
  **Amended 2026-08-06 — a standstill *with* fixes is now excluded too.** The
  sentence above assumed a bucket could absorb a stop. Measured on four field
  captures: it cannot. A 6 s stop cost its bucket **2:49 /km** (23.04 m over
  22.55 s against its own walking pace of 11:53), and one capture's 173-second
  tail produced a **125:36 /km** bucket that took 98% of the axis. The
  `MAX_GAP_S` guard cannot see any of it, because iOS keeps delivering fixes
  while the phone stands still — **1 leg in 5,865 exceeded 30 s** across the
  four runs, median inter-fix 1.00 s whether moving or stationary. The rule is
  now stated on a leg's own committed distance rather than on wall clock, in
  [the standstill slice](2026-08-05-pace-chart-stationary-time-design.md); the
  run's elapsed time is still reported in full by `RunStatGrid`, and the card
  discloses the difference.
```

- [ ] **Step 2: Check the cross-reference resolves**

Run: `ls docs/superpowers/specs/2026-08-05-pace-chart-stationary-time-design.md`

Expected: the file exists (both specs sit in the same directory, so the relative link is bare-filename).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-02-run-elevation-and-pace-chart-design.md
git commit -m "docs: amend the pace chart spec's standstill decision"
```

---

## Task 5: Pre-PR review

**Files:** none modified unless a reviewer finds something.

- [ ] **Step 1: Run the gate**

```bash
bun test && bun run typecheck && bun run lint
```

Expected: all three clean.

- [ ] **Step 2: Run the review subagents**

Dispatch both, on the diff against `main`:
- `adr-compliance-reviewer` — this diff touches `src/domain/`, `src/hooks/` and `src/components/`, so ADR 0021 (smoothing), ADR 0013 (component conventions) and ADR 0024 (charting containment) all govern it.
- `comment-density-auditor` — Task 1 adds the most comment-prone code in the slice.

- [ ] **Step 3: Confirm no E2E anchor moved**

Run: `grep -rn "Pace" .maestro/`

Expected: no flow asserts on the pace card's text. If one does, the new `Excludes …` line may need an anchor update — report it rather than editing a flow silently.

No new Maestro flow is added: GPS motion is unreachable by Maestro (ADR 0001, 2026-07-31 amendment), so the behaviour this slice changes cannot be driven from a flow.

- [ ] **Step 4: Open the PR**

Title must be Conventional Commits — it becomes the squash commit and drives release-please:

```
feat: exclude standing time from the pace chart's buckets
```

Body should state: the defect (a distance bucket divides seconds by metres, so a stationary runner is an unbounded pole), the rule (a leg that committed no distance inside a >3 s run contributes no time; a shorter run is deadband accrual and carries forward), the measured result (band contrast 0.02→0.20 on the worst capture, its axis 125:36→16:22), the known limitation (§6 — a wandering stand is only partly caught, inheriting ADR 0021's open item), and that it reverses the prior spec's §5.2 with the amendment in Task 4.

---

## Self-Review

**Spec coverage.** §4 and §5's rule → Task 1 Step 3. §5 case 3's carry-forward → Task 1, tested by the slow-walker case. §6's properties → Task 1's tests (stop-length independence, slow-walker safety, never-excludes-a-committing-leg, exact conservation). §7's metric → `bandContrast`, already in the suite, used by the head/tail test. §8 (no marker) → nothing to build. §9's disclosure → Task 3. §10's unchanged data model → enforced by Global Constraints and by Task 1's `Produces` block. §11 (rendering unchanged) → `run-profile-chart.tsx` appears in no task. §12's label → Task 3 Step 3. §13's degradation → the `total <= 0` early return kept in Task 1, and `foldProfile`'s try/catch kept in Task 3. §14's test list → Task 1 and Task 2. §15's reversal → Task 2 and Task 4. §16 is history, nothing to build. §17 is out of scope by definition.

One spec line with no task, deliberately: §14's suggestion of a decimated capture fixture. It is written as "worth reconsidering later", not a requirement, and committing route-derived data needs its own decision.

**Placeholder scan.** No TBD/TODO. Every code step carries the actual code. Task 3 Step 2's final instruction ("update `useTrack`'s ready-branch construction") is the one place that says *what* rather than showing it — deliberate, because that constructor's exact shape depends on the `withProfile` gate the implementer will be reading, and quoting it here risks a stale paste. The types it must satisfy are fully specified above it.

**Type consistency.** `excludedStandstillSeconds` is spelled identically in Task 1 (definition, `Produces`), the test import, Task 3's hook import and Task 3's `foldProfile`. `ACCRUAL_GUARD_S`, `Leg`, `legsOf`, `stoppedLegs` are internal and used only within Task 1. `RunTrack.excludedStandstillS` is the field name in both the type and the card's destructuring. `formatClock` is imported in Task 3 and exists in `@/domain/format` (verified — `paceParts` uses it). `w1d1Phases` is defined and used only in Task 1. `Phase`, `phasedRun`, `straightRun`, `bandContrast`, `meanPace`, `STEADY_PACE_SEC_PER_KM`, `RUN_MPS`, `WALK_MPS`, `smoothTrack` all already exist in the test file — none are redefined.
