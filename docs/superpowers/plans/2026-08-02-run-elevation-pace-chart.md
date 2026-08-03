# Run Elevation & Pace Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a run-summary card charting pace against distance. (Elevation was deferred whole after Gate B — spec §3.6.)

**Architecture:** Elevation comes from `run_points.altitude`, which the app already persists for every accepted GPS fix — no new sensor, permission, native module, or schema change. A pure streaming reducer (`domain/elevation.ts`) smooths altitude and banks gain/loss with hysteresis; it mirrors `smoothFix`/`smoothTrack` (ADR 0021) so the barometer slice that follows plugs in as a second *source*, not a second implementation. The chart series is derived at display time from `run_points`, and nothing is stored. **Elevation is deferred whole** (spec §3.6): the reducer ships correct and tested but with no production caller at all, because measurement showed GPS altitude fabricates ~9.5 m of relief on flat ground — neither the line nor the totals are displayed.

**Tech Stack:** TypeScript ~6.0 (strict), Expo SDK 57, React Native 0.86, Drizzle + expo-sqlite, `victory-native` 41 (Skia/Reanimated/Gesture-Handler — all three already installed), `bun test`.

**Spec:** [`docs/superpowers/specs/2026-08-02-run-elevation-and-pace-chart-design.md`](../specs/2026-08-02-run-elevation-and-pace-chart-design.md)

## Global Constraints

- **Read AGENTS.md before touching anything.** Expo SDK 57 is newer than most training data — never rely on memorised Expo/React Native APIs; use Context7 (`resolve-library-id` → `query-docs`) for library questions.
- **Comments explain WHY, never WHAT** (AGENTS.md). No JSDoc restating types or architecture. Prior waves landed ~49% comment lines; do not repeat that. `// why:` one-liners at genuinely non-obvious sites only.
- **`domain/` is pure TypeScript** — no React, no Expo, no DB imports (ADR 0003 §1). It is covered by `bun test` and must run with no RN runtime.
- **Never `useLiveQuery` on `run_points`** (ADR 0004 §3). Read it imperatively via `loadRunFixes`.
- **Guarded files:** `src/db/migrations/` is owned by drizzle-kit — generate with `bun run db:generate`, never hand-edit. A `PreToolUse` hook will block you. Same for `CHANGELOG.md`, `ios/`, `bun.lock`, and the `version` field.
- **Package manager is Bun.** Use `bun expo install <pkg>`. If `"packageManager": "yarn@…"` appears in `package.json`, delete it before committing (corepack injects it; a committed value breaks EAS/CI).
- **Conventional Commits** for every commit (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- **Branch:** `ll/run-elevation-pace-chart` (already created, already holds the spec and the HealthKit ledger).
- **Reducer tuning is a per-source config, not a module constant** (spec §4.2, amended 2026-08-03). `GPS_ELEVATION_CONFIG = { medianWindow: 31, hysteresisM: 10 }` — measured, not guessed (spec §3.5). `PROFILE_SAMPLE_COUNT = 120` remains a seeded starting value. Tests assert *properties*, never these numbers.
- **Test fixtures for the reducer have two hard requirements** (spec §9.2), both learned the expensive way: noise fixtures use a **seeded PRNG, never a sinusoid** (a median filter annihilates a coherent sinusoid, so a sinusoidal fixture passes while the reducer banks hundreds of phantom metres); and climb fixtures are **padded with flat samples at both ends** (the trailing median warms up at the start but lags at the end, a 4.5 m artifact that otherwise lands in the assertion).
- **Gate everything on Task 1.** If the spike fails, stop and report — the slice reshapes.

> **Amended 2026-08-03 (first pass).** Elevation gain/loss totals and their storage are cut (spec §3.5). **Task 4 is removed**; Task 2's fixtures are rewritten; Task 7's card loses its header totals.
>
> **Amended 2026-08-03 (second pass, after Gate B).** Three adversarial reviewers found that §3.5's reasoning was inverted — hysteresis protects the totals, not the line — so **elevation is deferred whole** (spec §3.6) and this slice ships a **pace-only chart**. They also found two Criticals in already-committed code. Consequences:
> - **Task 2** keeps `domain/elevation.ts` (the barometer slice consumes it unchanged — spec §4.3) but must fix the **warm-up anchor defect** and test across ≥50 seeds, not 5.
> - **Task 3** drops elevation from `ProfilePoint` entirely and must fix the **pace boundary rule** (spec §5.2).
> - **Tasks 5–7** render one pace line, one axis; the hook loses `hasElevation`.
> - Task numbering is unchanged so briefs still extract by number.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/elevation.ts` | **Create.** Pure streaming altitude reducer. Shipped unconsumed — the barometer slice's foundation (spec §4.3). Must still be correct. |
| `src/domain/elevation.test.ts` | **Create.** Property tests — the noise-rejection guard is the important one. |
| `src/domain/run-profile.ts` | **Create.** Pure: fixes → resampled `{ distanceM, paceSecPerKm }[]`. |
| `src/domain/run-profile.test.ts` | **Create.** Bucketing, pace, distance preservation. |
| `src/hooks/use-run-track.ts` | **Rename + extend** `use-run-route.ts`. ONE imperative read of `run_points` feeding both the route geometry and the pace series, behind one `ready` (spec §4.4). Not a second hook — see Task 5. |
| `src/components/run-profile-chart.tsx` | **Create.** The ONLY file importing `victory-native`. One line, one axis. |
| `src/components/run-profile-card.tsx` | **Create.** Gating and accessibility. No totals — spec §3.5. |
| `src/app/runs/[runId]/index.tsx` | **Modify.** Compose the card between `RunStatGrid` and `SegmentBreakdown`. |
| `.maestro/tests/complete-session.yaml` | **Modify.** Assert the card's absence on a motionless run. |
| `docs/adr/0024-victory-native-charting.md` | **Create.** The official-tooling exception. |

---

### Task 1: Spike victory-native and prove the fingerprint is untouched

**This is a hard gate.** Nothing else starts until both halves pass.

**Files:**
- Modify: `package.json` (dependency only — never a script; script edits invalidate the native fingerprint)
- Create (temporary, deleted in Step 6): `src/app/spike-chart.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: a verified answer to two questions — (a) does `CartesianChart` mount and paint under Reanimated 4.5.1 / worklets 0.10.1, (b) is the `@expo/fingerprint` hash unchanged by the install. Also settles the pace-axis inversion mechanism used in Task 6.

- [ ] **Step 1: Record the fingerprint hash BEFORE installing**

```bash
APP_VARIANT=e2e bun -e "
require('@expo/fingerprint').createFingerprintAsync('.').then(r => console.log('BEFORE', r.hash));
"
```

Write the hash down. At the time of planning it was `91f6356cdc39c55bbb0eebd5e2f9f5d77bea570f`, but recompute rather than trusting that — the tree may have moved.

- [ ] **Step 2: Install victory-native**

```bash
bun expo install victory-native
```

Expected: `victory-native` appears in `dependencies` at `^41.x`. No new entry under `plugins` in `app.json` — it has no config plugin. If `bun` reports peer-dependency errors for `@shopify/react-native-skia`, `react-native-reanimated`, or `react-native-gesture-handler`, STOP: the spec's §3.1 compatibility table is wrong and the slice needs re-planning.

- [ ] **Step 3: Recompute the fingerprint and compare**

```bash
APP_VARIANT=e2e bun -e "
require('@expo/fingerprint').createFingerprintAsync('.').then(r => console.log('AFTER', r.hash));
"
```

Expected: **identical to Step 1.** victory-native ships no native module and no config plugin, and the root `package.json` is not itself a hashed source — only config-plugin packages and the react-native version are.

If the hash CHANGED, that is a real finding, not a blocker: record it, and note that every `e2e-refresh` after this must be a full rebuild rather than a repack. Continue.

- [ ] **Step 4: Write the throwaway spike screen**

```tsx
// src/app/spike-chart.tsx
import { matchFont } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { View } from 'react-native';
import { CartesianChart, Line } from 'victory-native';

const DATA = Array.from({ length: 40 }, (_, i) => ({
  distanceM: i * 100,
  paceSecPerKm: 300 + Math.sin(i / 4) * 40,
  elevationM: Math.sin(i / 6) * 25,
}));

export default function SpikeChart() {
  const font = useMemo(() => matchFont({ fontSize: 11 }), []);
  return (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
      <View style={{ height: 240 }}>
        <CartesianChart
          data={DATA}
          xKey="distanceM"
          yKeys={['paceSecPerKm', 'elevationM']}
          yAxis={[
            { yKeys: ['paceSecPerKm'], axisSide: 'left', font },
            { yKeys: ['elevationM'], axisSide: 'right', font },
          ]}
        >
          {({ points }) => (
            <>
              <Line points={points.paceSecPerKm} color="#AF52DE" strokeWidth={2} />
              <Line points={points.elevationM} color="#34C759" strokeWidth={2} />
            </>
          )}
        </CartesianChart>
      </View>
    </View>
  );
}
```

- [ ] **Step 5: Run it and verify on the simulator**

```bash
bun run start
```

Then load the `argent-react-native-app-workflow` and `argent-device-interact` skills, and open the route on the dev client:

```
open-url  runbrodev://spike-chart
```

Verify all four, with a `screenshot` as evidence:
1. Both lines paint.
2. Left and right axes render with different scales and visible tick labels.
3. No Reanimated/worklets error in the Metro logs (this is what the spike exists for).
4. Rotate the device (`rotate`) and confirm it repaints without crashing.

Then determine the **pace-axis inversion mechanism**: pace must read fast-at-top, so a lower sec/km belongs higher. Try a reversed `domain` tuple on the pace axis entry first (`domain: [max, min]`); if victory rejects it, fall back to plotting negated pace values with a tick formatter that re-negates for display. **Record which one worked — Task 6 depends on the answer.**

- [ ] **Step 6: Delete the spike and commit the dependency**

```bash
rm src/app/spike-chart.tsx
git add -- package.json bun.lock
git commit -m "build: add victory-native for the run profile chart"
```

Note `bun.lock` is hook-guarded against *edits* but is expected to change from a legitimate install; if the hook blocks the commit, commit `package.json` alone and report it.

- [ ] **Step 7: Report the gate result**

State explicitly: spike passed or failed, the before/after fingerprint hashes, and the chosen inversion mechanism. If the spike FAILED, stop here — the fallback is a hand-drawn Skia `Path` in `run-profile-chart.tsx` and the plan's Task 6 needs rewriting before continuing.

---

### Task 2: The elevation reducer

**Files:**
- Create: `src/domain/elevation.ts`
- Test: `src/domain/elevation.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports from `db/` or `services/`).
- Produces:
  - `interface AltitudeSample { timestamp: number; altitudeM: number | null }`
  - `type ElevationTrend = 'climbing' | 'descending' | 'flat'`
  - `interface ElevationConfig { medianWindow: number; hysteresisM: number }`
  - `const GPS_ELEVATION_CONFIG: ElevationConfig` — `{ medianWindow: 31, hysteresisM: 10 }`
  - `interface ElevationState { config: ElevationConfig; window: number[]; anchorM: number | null; gainM: number; lossM: number; trend: ElevationTrend }`
  - `interface ElevationStep { state: ElevationState; smoothedAltitudeM: number | null }` — the shipped shape; the duplicated `trend` field this once listed was dropped as it already rides on `state`
  - `interface ElevationRollup { gainM: number; lossM: number; seriesM: (number | null)[] }`
  - `createElevationState(config: ElevationConfig): ElevationState` — **required**, never defaulted
  - `elevationStep(state: ElevationState, sample: AltitudeSample): ElevationStep`
  - `elevationRollup(samples: readonly AltitudeSample[], config: ElevationConfig): ElevationRollup` — **required**

**Every bound below was measured against this exact implementation before the plan was written — they are observations, not guesses. If one fails, the implementation diverged from the brief; re-read it before touching a number.**

- [ ] **Step 1: Write the failing tests**

> **SUPERSEDED — the code that stood here is defective. Do not implement from it.**
> It looped `seed <= 5`, which spec §9.2 records as having *passed on seed luck*:
> all five seeds returned exactly 0.00 against a warm-up defect worth 22.38 m at
> worst, and seed 7 was the first to expose it. The shipped tests are
> `src/domain/elevation.test.ts` — 50 seeds (`NOISE_SEEDS`), reporting `{mean, worst}`.
> Read that file; it is the authority.
- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/domain/elevation.test.ts`
Expected: FAIL — `Cannot find module './elevation'`.

- [ ] **Step 3: Write the implementation**

> **SUPERSEDED — the code that stood here is defective. Do not implement from it.**
> It anchored on the first partial median with **no window-fill guard**, which is
> Gate B's Critical: GPS altitude is worst at fix acquisition, so one bad opening
> reading became both the anchor and the rebase base — 3.56 m mean phantom gain,
> 22.38 m worst, over 200 seeds, and a flat run drawn as a 30 m descent. The shipped
> reducer is `src/domain/elevation.ts`; its guard is the `window.length <
> config.medianWindow` early return. It also takes a **required** `ElevationConfig`
> (no GPS default) and imports `median` from `./math` rather than defining its own.
> Read that file; it is the authority.
- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/domain/elevation.test.ts`
Expected: PASS, all cases.

If a bound fails, the implementation has diverged from Step 3 — re-read it before adjusting any number. The two noise tests in particular encode spec §3.5's measured findings; changing either of their bounds changes what the app claims about its own accuracy, and is a spec decision, not an implementation one. Report rather than adjust.

- [ ] **Step 5: Gate and commit**

```bash
bun test && bun run typecheck && bun run lint
git add -- src/domain/elevation.ts src/domain/elevation.test.ts
git commit -m "feat: add the elevation reducer with per-source tuning"
```

---

### Task 3: The chart series

**Files:**
- Create: `src/domain/run-profile.ts`
- Test: `src/domain/run-profile.test.ts`

**Interfaces:**
- Consumes: `createSmootherState`, `smoothFix`, `MAX_GAP_S`, `type LocationFix` from `@/domain/geo`. **Not** `elevationRollup` — elevation is deferred whole (spec §3.6).
- Produces:
  - `type ProfilePoint = { distanceM: number; paceSecPerKm: number | null }`
  - `toRunProfile(fixes: readonly LocationFix[], bucketCount?: number): ProfilePoint[]` — the default is fix-density-derived, not `PROFILE_SAMPLE_COUNT`
  - `isDrawableProfile`, `paceRange`, `PROFILE_SAMPLE_COUNT = 120` (an upper bound)

- [ ] **Step 1: Write the failing tests**

> **SUPERSEDED — do not implement from it.** These tests assert `elevationM` on
> `ProfilePoint`, which the 2026-08-03 deferral removed (spec §3.6), and their
> loose pace bands (250–450 s/km) are exactly what let the 1/N boundary bias
> through. The shipped tests are `src/domain/run-profile.test.ts`, which pin the
> gap-excluded clock, proportional leg splitting, the adaptive bucket count, and
> `paceRange`. Read that file; it is the authority.
- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/domain/run-profile.test.ts`
Expected: FAIL — `Cannot find module './run-profile'`.

- [ ] **Step 3: Write the implementation**

> **SUPERSEDED — the code that stood here is defective and does not even compile.**
> Do not implement from it. Four distinct problems:
> 1. It folds `elevationRollup` and emits `elevationM` — elevation is deferred whole
>    (spec §3.6), so `ProfilePoint` carries `distanceM` and `paceSecPerKm` only.
> 2. It defaults `bucketCount = PROFILE_SAMPLE_COUNT`; the shipped count is derived
>    from fix density (`MIN_FIXES_PER_BUCKET`), so a 240 m run gets 16 buckets rather
>    than 120 with 86 of them null.
> 3. It uses the **naive `firstTimestamp` clock** — the defect spec §5.2 exists to
>    kill (267 s/km against a true 333, −41.3% on a 5-minute run), and it charges a
>    pause or GPS dropout to whichever bucket spans it, collapsing the genuine
>    run/walk separation to 3.8% of the axis. The shipped fold splits each leg's
>    metres *and* seconds across every bucket it crosses and skips any leg longer
>    than `MAX_GAP_S`.
> 4. It declares `Bucket.entryTimestamp` and then assigns `firstTimestamp`.
>
> The shipped series is `src/domain/run-profile.ts`. Read that file; it is the authority.
- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/domain/run-profile.test.ts`
Expected: PASS.

If the steady-pace band fails, print the actual paces before adjusting anything — a systematic offset means the per-bucket `meters` accumulation is dropping the first fix's delta, not that the band is wrong.

- [ ] **Step 5: Gate and commit**

```bash
bun test && bun run typecheck && bun run lint
git add -- src/domain/run-profile.ts src/domain/run-profile.test.ts
git commit -m "feat: derive the pace and elevation chart series from run points"
```

---

### Task 4: REMOVED (amended 2026-08-03)

**No work. Do not implement. Skip to Task 5.**

This task stored `elevation_gain_m` / `elevation_loss_m` on `runs`, generated the
migration, wired the finalize rollup in `src/db/save-run.ts`, and added
`formatElevationM`. All of it is cut.

**Why:** measurement during Task 2 showed GPS-derived elevation totals are
accurate in open sky and roughly 2× wrong in poor conditions, with no
window/threshold pair safe across both regimes (spec §3.5). The only consumer was
Task 7's card header, which is also cut. Storing a figure nothing displays would
mean committing a migration for data we know to be unreliable, then having to
decide at the barometer slice whether to trust, recompute, or discard every stored
GPS value.

ADR 0015 item 5's columns are deferred, not cancelled — the barometer slice adds
them, populated from a ~1 m-precision source, alongside the per-point barometric
altitude column and the `elevation_source` discriminator it needs anyway.

Task numbering is preserved so briefs still extract by number.

---

### Task 5: The hook

**Files:**
- Modify: `src/constants/theme.ts` (`StatColors`)
- Rename + extend: `src/hooks/use-run-route.ts` → `src/hooks/use-run-track.ts`

**Interfaces:**
- Consumes: `toRunProfile`, `isDrawableProfile`, `ProfilePoint` (Task 3); `loadRunFixes` from `@/db/run-points`; the existing route geometry helpers. NOTE: elevation is deferred (spec §3.6) — nothing exposes `hasElevation`.
- Produces:
  - `type RunTrack = { ready: false } | (ReadyRoute & { profile: ProfilePoint[] | null })`
  - `type RunRoute = { ready: false } | ReadyRoute` — the viewer's narrower view, with no `profile` field at all
  - `useRunTrack(runId, segments, loaded): RunTrack` and `useRunRoute(runId, segments, loaded, epsilon?): RunRoute`

- [ ] **Step 1: Write the hook**

> **SUPERSEDED — do not implement from it.** This creates a *second* hook beside
> `useRunRoute`, so both ran `loadRunFixes(runId)` plus a full smoother fold in the
> same render pass — two ~1800-row reads on the modal's first content frame — while
> gating on different predicates, which is what let a treadmill run be told it
> "didn't cover enough ground to map" above a chart drawn from that same rejected
> drift. Spec §4.4 replaced it with the merged `src/hooks/use-run-track.ts`: one
> read, one `ready`, route and profile derived together, the profile fold in its own
> `try` so it cannot take the map down. There is no `src/hooks/use-run-profile.ts`.
> Read `use-run-track.ts`; it is the authority.
- [ ] **Step 2: Verify and commit**

```bash
bun run typecheck && bun run lint
git add -- src/hooks/use-run-track.ts
git commit -m "feat: derive the route and the pace series from one run_points read"
```

---

### Task 6: The chart component

**Files:**
- Create: `src/components/run-profile-chart.tsx`

**Interfaces:**
- Consumes: `ProfilePoint` (Task 3); `useStatColors` from `@/hooks/use-theme`. Task 1 verified the axis-inversion mechanism: a reversed `domain: [max, min]` tuple on the pace axis entry.
- Produces: `<RunProfileChart points={ProfilePoint[]} />`

- [ ] **Step 1: Write the component**

> **SUPERSEDED — do not implement from it.** The reversed `domain` tuple is right and
> shipped, but this block is missing everything the gate review then found: axis
> colours (victory's defaults are hardcoded `#000000` labels, invisible on the
> dark-mode card), the app's own tick formatters (raw `400`/`450` where every other
> pace surface reads `6:40`), the `PixelRatio.getFontScale()` scaling of font, chart
> height and tick count, and the module-scope `Y_KEYS` identity that keeps victory's
> axis memos. The shipped chart is `src/components/run-profile-chart.tsx`. Read that
> file; it is the authority.
- [ ] **Step 2: Verify it compiles**

Run: `bun run typecheck && bun run lint`
Expected: clean. `accessibilityElementsHidden` is deliberate — a Skia canvas carries no accessible content, and Task 7's card supplies the label.

- [ ] **Step 3: Commit**

```bash
git add -- src/components/run-profile-chart.tsx
git commit -m "feat: add the pace and elevation chart"
```

---

### Task 7: The card and its place on the summary

**Files:**
- Create: `src/components/run-profile-card.tsx`
- Modify: `src/app/runs/[runId]/index.tsx`

**Interfaces:**
- Consumes: `RunTrack` from `useRunTrack` (Task 5, passed in by the screen — the card runs no hook of its own); `RunProfileChart` (Task 6); `formatDistanceKm`, `formatPace`, `paceParts` from `@/domain/format`; `paceRange` from `@/domain/run-profile`; `hasMeasuredDistance` from `@/domain/run-stats`; `Card`, `Text`.
- Produces: `<RunProfileCard run={Run} track={RunTrack} />`

- [ ] **Step 1: Write the card**

> **SUPERSEDED — do not implement from it.** It calls the removed `useRunProfile`
> (see Task 5), and it gates only on that hook — where the shipped card takes the
> shared `RunTrack` and requires **both** the route-extent gate and
> `hasMeasuredDistance`, so a slow shuffle cannot chart a min/km line on a summary
> that withholds pace everywhere else. Its `label` also lacks the pace range, and
> must **not** regain the start-to-finish trend sentence: bucket means read "steady"
> for every session in an interval plan (spec §7.1). The shipped card is
> `src/components/run-profile-card.tsx`. Read that file; it is the authority.
- [ ] **Step 2: Compose it into the summary**

In `src/app/runs/[runId]/index.tsx`, add the import:

```tsx
import { RunProfileCard } from '@/components/run-profile-card';
```

and place it between `RunStatGrid` and `SegmentBreakdown`:

```tsx
            <RunStatGrid run={run} segments={segments} />
            <RunProfileCard run={run} track={track} />
            <SegmentBreakdown segments={segments} />
```

- [ ] **Step 3: Verify on the simulator with a real recorded route**

```bash
bun run start
```

Load `argent-ios-simulator-setup` and `argent-device-interact`. Then, with the app running, feed the simulator a moving route — Maestro cannot do this, `simctl` can:

```bash
xcrun simctl location <udid> start --speed=2.8 --interval=1.0 59.3293,18.0686 59.3353,18.0686
```

Complete a compressed session, then on the summary confirm with a `screenshot`:
1. The card appears between the stat grid and the segment breakdown.
2. The pace line paints and reads **fast-at-top**; its values agree with the summary's own headline pace stat (they disagreed by 20% before the boundary rule was fixed).
3. The header reads `Pace` with `min/km · km`; the ticks are bare (`6:40`, `0.50`) with no repeated unit. **No gain/loss totals** — elevation is deferred whole (spec §3.6).
4. Contrast: the pace line and both axes are legible against the card in light and dark. Non-text graphics want 3:1.

Then re-check in dark mode and at a large text size:

```bash
xcrun simctl ui <udid> appearance dark
xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large
```

The app reads `PixelRatio.getFontScale()` at render, and the simulator's content
size does not reach a running JS bundle — **reload after changing it** or the
chart will paint at the old scale and the check proves nothing. At AX5 the
x-axis must thin to ~3 ticks; five would overrun the plot area.

Finally confirm the degradation path: a run recorded with location off shows **no** profile card and no layout gap.

- [ ] **Step 4: Verify and commit**

```bash
bun test && bun run typecheck && bun run lint
git add -- src/components/run-profile-card.tsx "src/app/runs/[runId]/index.tsx"
git commit -m "feat: show the pace and elevation profile on the run summary"
```

---

### Task 8: E2E cover and documentation

**Files:**
- Modify: `.maestro/tests/complete-session.yaml`
- Create: `docs/adr/0024-victory-native-charting.md`
- Modify: `docs/roadmap/README.md`, `docs/superpowers/specs/2026-07-31-stage-5-apple-health-design.md`, `AGENTS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code interfaces — the regression assertion and the written record.

- [ ] **Step 1: Add the absence assertion**

`complete-session.yaml` already asserts `"No route for this run"` at line 22, because Maestro cannot produce GPS motion (ADR 0001's 2026-07-31 amendment). Immediately after that line add:

```yaml
# The profile card is GPS-gated exactly as the route card is, so a motionless E2E run must not
# render it. Its absence is the only assertion this harness can make: no flow can produce
# movement, so no flow can prove the chart is correct (spec §9.3).
- assertNotVisible: "Pace"
```

- [ ] **Step 2: Run the affected flow**

Load the `e2e-refresh` skill and run `complete-session.yaml` through it. The skill fingerprint-gates the rebuild; if Task 1 Step 3 found the hash unchanged, this repacks in about a minute.

Expected: PASS. Report which flows you ran.

- [ ] **Step 3: Write ADR 0024**

Create `docs/adr/0024-victory-native-charting.md` following the house structure (`## Status`, `## Context`, `## Decision`, `## Consequences`, `## Alternatives considered`) — read ADR 0010 first, it is the closest precedent. Status: `Proposed — draft for review. Flip to Accepted on merge.`

It must record: that AGENTS.md prefers Expo-official packages and this is a deliberate exception, exactly as ADR 0010 made one for react-native-maps; that all three peers were already installed so nothing new reaches the native layer; the measured before/after fingerprint hashes from Task 1; the single-import containment rule and the hand-drawn Skia fallback; and the Reanimated 4 risk with the spike result that settled it.

- [ ] **Step 3b: Amend ADR 0015 with the measurement**

ADR 0015 asserted GPS altitude is too noisy to sum. This slice *quantified* it. Add a dated amendment carrying spec §3.5's table — **549.5 m** phantom gain at ±10 m untuned, **92.5 m** even at the tuned GPS config when noise reaches ±25 m, and the finding that the settings which suppress that also report zero loss on a real 40 m descent. Measure over **50 seeds**, never 5, and re-measure after the warm-up fix: the pre-fix figures (537 / ~85 / a 2.5 m banked gain at ±10 m) are what the first pass published and they no longer hold. State the conclusion plainly: no single window/threshold pair is safe across regimes, which is why the displayed totals were cut and deferred to the barometer slice. Record that item 5's columns move to that slice. Leave item 7 (background barometer delivery) open — this slice produced no device evidence for it.

- [ ] **Step 4: Update the roadmap row**

In `docs/roadmap/README.md`, the row is titled **"Run pace & elevation profile"** with status **In progress** (pace slice building; elevation deferred to the barometer slice) — pace is what actually ships here, and elevation is deliberately not on the map. Link this spec and plan.

- [ ] **Step 5: Record the HealthKit finding in the Stage 5 spec**

In `docs/superpowers/specs/2026-07-31-stage-5-apple-health-design.md` §3.1, retitle "Four limitations, all confirmed in the Swift" to five and add the quantity-metadata blocker, citing `ios/Helpers.swift:428` and `ios/QuantityTypeModule.swift:263` and pointing at `docs/healthkit-capability-ledger.md` for the full evidence. Also correct the share-description citation from `app.plugin.ts:44-47` to `:44-50`.

- [ ] **Step 6: Update AGENTS.md**

Add ADR 0024 to the ADR list, and extend the Architecture section's current-state paragraph to mention `domain/elevation.ts` and the summary's profile card.

- [ ] **Step 7: Full gate and commit**

```bash
bun test && bun run typecheck && bun run lint && bunx expo-doctor
git add -- .maestro/tests/complete-session.yaml docs AGENTS.md
git commit -m "docs: ADR 0024 and the elevation profile record"
```

- [ ] **Step 8: Pre-PR review**

Run the two review subagents over the branch diff, and address what they raise:

```
adr-compliance-reviewer   # ADRs 0003, 0004, 0013, 0015, 0021 govern these files
comment-density-auditor   # the repo's WHY-not-WHAT convention
```

Then report: which flows passed, the fingerprint result, the spike outcome, any text anchors this change introduced, and anything left open.

---

## Self-Review

**Spec coverage.** §2 decisions → Tasks 2–7; §3.1 spike and fingerprint → Task 1; §3.2 existing altitude data → Task 3; §4.2 reducer with the three load-bearing properties → Task 2 (each has a test); §4.3 "keep the module correct anyway" → Task 2's warm-up fix; §4.4 the merged one-read hook → Task 5; §5.1 rebasing → Task 2; §5.2 bucketed pace → Task 3; §5.3 hysteresis → Task 2; §5.4 axis inversion → Tasks 1 and 6; §6 storage — **nothing to build**, Task 4 is removed; §7.1 card and a11y → Task 7; §7.2 chart → Task 6; §8 degradation → Tasks 5 (`ready: false`, and the pace fold's own `try`), 7 (the extent gate and `hasMeasuredDistance`); §9.1 gate → Task 1; §9.2 unit set → Tasks 2–3; §9.3 E2E → Task 8; §9.4 manual → Task 7 Step 3; §10 docs → Task 8.

**Gap found and closed (original pass):** §8's "run finalized before this shipped" row had no explicit coverage. After the 2026-08-03 amendment it needs none — nothing is stored, so the series is re-derived from `run_points` for every run alike and there is no old/new distinction.

**Amendment pass (2026-08-03, first):** spec §3.5 covered by Task 2's noise tests; §2's "no totals" by Task 4's removal; §4.2's per-source config by Task 2's `ElevationConfig` test; §6's "no storage" by Task 4 being empty.

**Amendment pass (2026-08-03, second — post Gate B):** spec §3.6's deferral covered by Tasks 3/5/6/7 dropping elevation; §4.3's "keep the module correct anyway" by Task 2's warm-up fix; §5.2's boundary rule by Task 3's proportional leg splitting and gap exclusion.

**Amendment pass (2026-08-03, third — post Gate D).** The two passes above rewrote these headers but left the task *bodies* carrying the defective code they describe, so an agent extracting Task 2 or 3 by number would have re-introduced both Gate B Criticals. **Every code block that no longer matches shipped code now carries a `SUPERSEDED` note naming the shipped file and the defect it was fixed for** — Tasks 2 (Steps 1, 3), 3 (Steps 1, 3), 5, 6 and 7 (Step 1). Task 1's spike block is deliberately left intact: it is a throwaway file, and its two-line chart is what verified the dual-axis mechanism for the barometer slice (spec §3.1). Interface lists, the File Structure table, Task 7's verification steps and this Self-Review are corrected in place rather than superseded.

**Placeholders:** none. Every code step carries runnable code; the one branch point (axis inversion) names both concrete paths and which task decides.

**Type consistency:** `AltitudeSample`, `ElevationConfig`, `GPS_ELEVATION_CONFIG`, `ElevationState`, `ElevationRollup.seriesM` and `ProfilePoint` are spelled identically across Tasks 2–7. The hook types are `RunTrack` / `RunRoute` (Task 5); `RunProfile` and `useRunProfile` do **not** exist — the superseded blocks that name them are marked as such at each site.
