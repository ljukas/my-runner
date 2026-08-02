# Run Elevation & Pace Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a run-summary card charting pace and elevation against distance, with the run's total elevation gain and loss in its header.

**Architecture:** Elevation comes from `run_points.altitude`, which the app already persists for every accepted GPS fix — no new sensor, permission, or native module. A pure streaming reducer (`domain/elevation.ts`) turns altitude samples into gain/loss with hysteresis; it mirrors `smoothFix`/`smoothTrack` (ADR 0021) so the barometer slice that follows plugs in as a second *source*, not a second implementation. Totals are rolled up once at finalize and stored on `runs`; the chart series is re-derived at display time from the same fixes through the same reducer.

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
- **Constants seeded in this plan are starting values, not verified truths:** `ELEVATION_HYSTERESIS_M = 3`, `ALTITUDE_MEDIAN_WINDOW = 5`, `PROFILE_SAMPLE_COUNT = 120`. Tests assert *properties*, never these numbers, so tuning them later must not require touching a test.
- **Gate everything on Task 1.** If the spike fails, stop and report — the slice reshapes.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/elevation.ts` | **Create.** Pure streaming altitude reducer: median smoothing, hysteresis gain/loss, sticky trend. |
| `src/domain/elevation.test.ts` | **Create.** Property tests — the noise-rejection guard is the important one. |
| `src/domain/run-profile.ts` | **Create.** Pure: fixes → resampled `{ distanceM, paceSecPerKm, elevationM }[]`. |
| `src/domain/run-profile.test.ts` | **Create.** Bucketing, pace, distance preservation. |
| `src/domain/format.ts` | **Modify.** Add `formatElevationM`. |
| `src/db/schema.ts` | **Modify.** Two nullable REAL columns on `runs`. |
| `src/db/migrations/` | **Generated.** `bun run db:generate` output — commit as generated. |
| `src/db/save-run.ts` | **Modify.** Elevation joins the existing finalize rollup and transaction. |
| `src/constants/theme.ts` | **Modify.** `StatColors.elevation`. |
| `src/hooks/use-run-profile.ts` | **Create.** One imperative read, memoised fold. Modelled on `use-run-route.ts`. |
| `src/components/run-profile-chart.tsx` | **Create.** The ONLY file importing `victory-native`. |
| `src/components/run-profile-card.tsx` | **Create.** Gating, header totals, accessibility. |
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
  - `interface ElevationState { window: number[]; anchorM: number | null; gainM: number; lossM: number; trend: ElevationTrend }`
  - `interface ElevationStep { state: ElevationState; smoothedAltitudeM: number | null; trend: ElevationTrend }`
  - `interface ElevationRollup { gainM: number; lossM: number; seriesM: (number | null)[] }`
  - `createElevationState(): ElevationState`
  - `elevationStep(state: ElevationState, sample: AltitudeSample): ElevationStep`
  - `elevationRollup(samples: readonly AltitudeSample[]): ElevationRollup`
  - `ALTITUDE_MEDIAN_WINDOW = 5`, `ELEVATION_HYSTERESIS_M = 3`

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/elevation.test.ts
import { describe, expect, test } from 'bun:test';

import {
  createElevationState,
  elevationRollup,
  elevationStep,
  ELEVATION_HYSTERESIS_M,
  type AltitudeSample,
} from './elevation';

function samples(altitudes: (number | null)[]): AltitudeSample[] {
  return altitudes.map((altitudeM, i) => ({ timestamp: 1_000_000 + i * 1000, altitudeM }));
}

/** Deterministic pseudo-noise, so a failure is reproducible. */
function noisyFlat(count: number, amplitudeM: number): AltitudeSample[] {
  return samples(
    Array.from({ length: count }, (_, i) => 100 + Math.sin(i * 2.399963) * amplitudeM),
  );
}

describe('elevationRollup', () => {
  test('noisy flat ground accumulates almost no gain', () => {
    // why this matters: raw per-sample summing of ±10 m jitter over 600 samples
    // inflates gain into the thousands (ADR 0015). Hysteresis is what stops it.
    const result = elevationRollup(noisyFlat(600, 10));
    expect(result.gainM).toBeLessThan(4 * ELEVATION_HYSTERESIS_M);
    expect(result.lossM).toBeLessThan(4 * ELEVATION_HYSTERESIS_M);
  });

  test('a clean monotonic climb banks its full height', () => {
    const climb = samples(Array.from({ length: 51 }, (_, i) => 100 + i));
    const result = elevationRollup(climb);
    expect(result.gainM).toBeGreaterThan(45);
    expect(result.gainM).toBeLessThanOrEqual(50);
    expect(result.lossM).toBe(0);
  });

  test('climb then descend banks both', () => {
    const up = Array.from({ length: 41 }, (_, i) => 100 + i);
    const down = Array.from({ length: 41 }, (_, i) => 140 - i);
    const result = elevationRollup(samples([...up, ...down]));
    expect(result.gainM).toBeGreaterThan(35);
    expect(result.lossM).toBeGreaterThan(35);
  });

  test('a sub-threshold bump that reverses banks nothing', () => {
    const result = elevationRollup(samples([100, 100, 100, 101, 102, 101, 100, 100, 100]));
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
  });

  test('series is rebased so the first known altitude reads 0', () => {
    const result = elevationRollup(samples([850, 850, 850, 850, 850, 850, 850]));
    expect(result.seriesM[0]).toBe(0);
    expect(result.seriesM.at(-1)).toBe(0);
  });

  test('null altitudes are preserved as null and never bank movement', () => {
    const result = elevationRollup(samples([null, 100, null, 100, null]));
    expect(result.seriesM[0]).toBeNull();
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
  });

  test('an all-null run produces no movement and an all-null series', () => {
    const result = elevationRollup(samples([null, null, null]));
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
    expect(result.seriesM.every((v) => v === null)).toBe(true);
  });

  test('empty and single-sample inputs are safe', () => {
    expect(elevationRollup([])).toEqual({ gainM: 0, lossM: 0, seriesM: [] });
    expect(elevationRollup(samples([100])).gainM).toBe(0);
  });

  test('the rollup equals a manual fold of elevationStep', () => {
    // why: the live path and the re-derived path must agree by construction
    // (the ADR 0021 §3 property, applied to elevation).
    const input = samples([100, 102, 106, 110, 108, 103, 99, 95, 99, 104]);
    let state = createElevationState();
    for (const sample of input) state = elevationStep(state, sample).state;

    const rollup = elevationRollup(input);
    expect(rollup.gainM).toBe(state.gainM);
    expect(rollup.lossM).toBe(state.lossM);
  });
});

describe('elevationStep trend', () => {
  test('starts flat', () => {
    expect(createElevationState().trend).toBe('flat');
  });

  test('becomes climbing once a rise clears the threshold, and stays climbing', () => {
    let state = createElevationState();
    for (const sample of samples([100, 101, 103, 106, 110, 115, 120])) {
      state = elevationStep(state, sample).state;
    }
    expect(state.trend).toBe('climbing');

    // why sticky: a banked move resets the anchor to the current altitude, so a
    // non-sticky trend would flicker to flat between every banked step of one climb.
    for (const sample of samples([121, 121.5])) state = elevationStep(state, sample).state;
    expect(state.trend).toBe('climbing');
  });

  test('flips to descending only after a threshold-clearing reversal', () => {
    let state = createElevationState();
    for (const sample of samples([100, 105, 110, 115, 120])) {
      state = elevationStep(state, sample).state;
    }
    expect(state.trend).toBe('climbing');
    for (const sample of samples([115, 110, 105, 100, 95])) {
      state = elevationStep(state, sample).state;
    }
    expect(state.trend).toBe('descending');
  });

  test('state stays JSON-serialisable', () => {
    // why: the engine snapshots this for crash recovery (ADR 0007) when the live
    // readout lands — a Map or a class would silently break that.
    let state = createElevationState();
    for (const sample of samples([100, 104, 108])) state = elevationStep(state, sample).state;
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/domain/elevation.test.ts`
Expected: FAIL — `Cannot find module './elevation'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/elevation.ts
/** Pure elevation math — no React/Expo/native imports (ADR 0003). */

/** One altitude reading. Deliberately not a GPS fix: the barometer feeds this same reducer. */
export interface AltitudeSample {
  timestamp: number;
  /** Metres; null when the source carried no altitude. */
  altitudeM: number | null;
}

export type ElevationTrend = 'climbing' | 'descending' | 'flat';

export const ALTITUDE_MEDIAN_WINDOW = 5;
/** A move must clear this monotonically before it is banked — the guard against GPS
 * vertical noise (~15-50 m) inflating cumulative gain (ADR 0015). Tunable. */
export const ELEVATION_HYSTERESIS_M = 3;

/** Plain JSON by construction: the engine snapshots this (ADR 0007) once the live readout lands. */
export interface ElevationState {
  window: number[];
  anchorM: number | null;
  gainM: number;
  lossM: number;
  trend: ElevationTrend;
}

export interface ElevationStep {
  state: ElevationState;
  smoothedAltitudeM: number | null;
  trend: ElevationTrend;
}

export interface ElevationRollup {
  gainM: number;
  lossM: number;
  /** Smoothed and rebased so the first known altitude reads 0; null where the sample had none. */
  seriesM: (number | null)[];
}

export function createElevationState(): ElevationState {
  return { window: [], anchorM: null, gainM: 0, lossM: 0, trend: 'flat' };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function elevationStep(state: ElevationState, sample: AltitudeSample): ElevationStep {
  const raw = sample.altitudeM;
  if (raw === null || !Number.isFinite(raw)) {
    return { state, smoothedAltitudeM: null, trend: state.trend };
  }

  const window = [...state.window, raw].slice(-ALTITUDE_MEDIAN_WINDOW);
  const smoothed = median(window);

  if (state.anchorM === null) {
    const seeded = { ...state, window, anchorM: smoothed };
    return { state: seeded, smoothedAltitudeM: smoothed, trend: seeded.trend };
  }

  const delta = smoothed - state.anchorM;
  if (Math.abs(delta) < ELEVATION_HYSTERESIS_M) {
    const held = { ...state, window };
    return { state: held, smoothedAltitudeM: smoothed, trend: held.trend };
  }

  const banked: ElevationState = {
    window,
    anchorM: smoothed,
    gainM: delta > 0 ? state.gainM + delta : state.gainM,
    lossM: delta < 0 ? state.lossM - delta : state.lossM,
    trend: delta > 0 ? 'climbing' : 'descending',
  };
  return { state: banked, smoothedAltitudeM: smoothed, trend: banked.trend };
}

export function elevationRollup(samples: readonly AltitudeSample[]): ElevationRollup {
  let state = createElevationState();
  const smoothed: (number | null)[] = [];

  for (const sample of samples) {
    const step = elevationStep(state, sample);
    state = step.state;
    smoothed.push(step.smoothedAltitudeM);
  }

  // why rebase: absolute GPS altitude carries a bias of tens of metres, so only the
  // profile's shape is honest (ADR 0015 item 1).
  const base = smoothed.find((value) => value !== null) ?? null;
  return {
    gainM: state.gainM,
    lossM: state.lossM,
    seriesM: base === null ? smoothed : smoothed.map((v) => (v === null ? null : v - base)),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/domain/elevation.test.ts`
Expected: PASS, all cases.

If "noisy flat ground" fails, do NOT loosen the assertion — that test is the reason this module exists. Raise `ELEVATION_HYSTERESIS_M` or widen `ALTITUDE_MEDIAN_WINDOW` instead, and record what you changed and why.

- [ ] **Step 5: Gate and commit**

```bash
bun test && bun run typecheck && bun run lint
git add -- src/domain/elevation.ts src/domain/elevation.test.ts
git commit -m "feat: add the elevation reducer with hysteresis gain/loss"
```

---

### Task 3: The chart series

**Files:**
- Create: `src/domain/run-profile.ts`
- Test: `src/domain/run-profile.test.ts`

**Interfaces:**
- Consumes: `elevationRollup`, `AltitudeSample` (Task 2); `createSmootherState`, `smoothFix`, `type LocationFix` from `@/domain/geo`.
- Produces:
  - `interface ProfilePoint { distanceM: number; paceSecPerKm: number | null; elevationM: number | null }`
  - `toRunProfile(fixes: readonly LocationFix[], bucketCount?: number): ProfilePoint[]`
  - `PROFILE_SAMPLE_COUNT = 120`

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/run-profile.test.ts
import { describe, expect, test } from 'bun:test';

import type { LocationFix } from './geo';
import { PROFILE_SAMPLE_COUNT, toRunProfile } from './run-profile';

/**
 * A straight northward run at a steady pace. 1 Hz, `metresPerFix` apart.
 * why hard-coded degrees: 1e-5 deg latitude is ~1.11 m, close enough that the
 * assertions below are about bucketing, not about haversine precision.
 */
function straightRun(count: number, metresPerFix: number, altitudes?: number[]): LocationFix[] {
  const degPerMetre = 1 / 111_320;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: 1_000_000 + i * 1000,
    lat: 59.3 + i * metresPerFix * degPerMetre,
    lng: 18.06,
    altitude: altitudes ? altitudes[i] : 100,
    accuracy: 5,
    speed: metresPerFix,
  }));
}

describe('toRunProfile', () => {
  test('a run with no fixes yields no points', () => {
    expect(toRunProfile([])).toEqual([]);
  });

  test('a stationary run yields no points', () => {
    const fixes = straightRun(60, 0);
    expect(toRunProfile(fixes)).toEqual([]);
  });

  test('distance is monotonically increasing across the profile', () => {
    const profile = toRunProfile(straightRun(600, 3));
    expect(profile.length).toBeGreaterThan(1);
    for (let i = 1; i < profile.length; i += 1) {
      expect(profile[i].distanceM).toBeGreaterThan(profile[i - 1].distanceM);
    }
  });

  test('the profile never exceeds the requested bucket count', () => {
    const profile = toRunProfile(straightRun(600, 3));
    expect(profile.length).toBeLessThanOrEqual(PROFILE_SAMPLE_COUNT);
  });

  test('a short run yields fewer buckets than the cap, not empty ones', () => {
    const profile = toRunProfile(straightRun(20, 3));
    expect(profile.length).toBeGreaterThan(0);
    expect(profile.length).toBeLessThanOrEqual(PROFILE_SAMPLE_COUNT);
    expect(profile.every((p) => Number.isFinite(p.distanceM))).toBe(true);
  });

  test('a steady 3 m/s run reports a pace near 333 s/km throughout', () => {
    const profile = toRunProfile(straightRun(600, 3));
    const paces = profile.map((p) => p.paceSecPerKm).filter((p): p is number => p !== null);
    expect(paces.length).toBeGreaterThan(0);
    for (const pace of paces) {
      expect(pace).toBeGreaterThan(250);
      expect(pace).toBeLessThan(450);
    }
  });

  test('elevation is rebased so the first point reads about zero', () => {
    const altitudes = Array.from({ length: 600 }, () => 850);
    const profile = toRunProfile(straightRun(600, 3, altitudes));
    expect(profile[0].elevationM).toBeCloseTo(0, 5);
  });

  test('a run whose fixes carry no altitude yields null elevation but real pace', () => {
    const fixes = straightRun(600, 3).map((fix) => ({ ...fix, altitude: null }));
    const profile = toRunProfile(fixes);
    expect(profile.every((p) => p.elevationM === null)).toBe(true);
    expect(profile.some((p) => p.paceSecPerKm !== null)).toBe(true);
  });

  test('the profile ends near the smoothed track distance', () => {
    const fixes = straightRun(600, 3);
    const profile = toRunProfile(fixes);
    const last = profile.at(-1)!;
    // why a band: the ADR 0021 smoother legitimately shortens a raw track, and the
    // final bucket's centre sits half a bucket short of the true end.
    expect(last.distanceM).toBeGreaterThan(1000);
    expect(last.distanceM).toBeLessThan(2000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/domain/run-profile.test.ts`
Expected: FAIL — `Cannot find module './run-profile'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/run-profile.ts
import { elevationRollup, type AltitudeSample } from './elevation';
import { createSmootherState, smoothFix, type LocationFix } from './geo';

/** One resampled point of the summary chart. `distanceM` is the bucket's centre. */
export interface ProfilePoint {
  distanceM: number;
  /** Seconds per km over the bucket; null when the bucket carried no usable time or distance. */
  paceSecPerKm: number | null;
  /** Metres relative to the run's start; null when no altitude was recorded. */
  elevationM: number | null;
}

export const PROFILE_SAMPLE_COUNT = 120;

interface Bucket {
  meters: number;
  firstTimestamp: number;
  lastTimestamp: number;
  elevationM: number | null;
}

/**
 * Fixes → the chart's series, resampled onto a uniform distance grid.
 * Distance is folded with the SAME smoother the stored distance used (ADR 0021 §3), so the
 * chart's x extent agrees with the summary's headline figure. Inputs need not be pre-filtered:
 * `smoothFix` gates them. Returns [] when the run covered no ground.
 */
export function toRunProfile(
  fixes: readonly LocationFix[],
  bucketCount = PROFILE_SAMPLE_COUNT,
): ProfilePoint[] {
  if (fixes.length === 0) return [];

  const elevation = elevationRollup(
    fixes.map<AltitudeSample>((fix) => ({ timestamp: fix.timestamp, altitudeM: fix.altitude })),
  );

  let state = createSmootherState();
  let cumulative = 0;
  const walked = fixes.map((fix, index) => {
    const step = smoothFix(state, fix);
    state = step.state;
    cumulative += step.acceptedDeltaMeters;
    return { distanceM: cumulative, timestamp: fix.timestamp, elevationM: elevation.seriesM[index] };
  });

  const total = cumulative;
  if (total <= 0) return [];

  const width = total / bucketCount;
  const buckets = new Map<number, Bucket>();

  for (let i = 0; i < walked.length; i += 1) {
    const point = walked[i];
    // why clamp: the final fix sits exactly on `total` and would otherwise open a
    // bucketCount-th bucket holding a single fix and therefore no measurable pace.
    const index = Math.min(bucketCount - 1, Math.floor(point.distanceM / width));
    const existing = buckets.get(index);
    const meters = i === 0 ? 0 : point.distanceM - walked[i - 1].distanceM;

    if (existing === undefined) {
      buckets.set(index, {
        meters,
        firstTimestamp: point.timestamp,
        lastTimestamp: point.timestamp,
        elevationM: point.elevationM,
      });
      continue;
    }

    existing.meters += meters;
    existing.lastTimestamp = point.timestamp;
    if (point.elevationM !== null) existing.elevationM = point.elevationM;
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, bucket]) => {
      const seconds = (bucket.lastTimestamp - bucket.firstTimestamp) / 1000;
      return {
        distanceM: (index + 0.5) * width,
        paceSecPerKm: bucket.meters > 0 && seconds > 0 ? (seconds / bucket.meters) * 1000 : null,
        elevationM: bucket.elevationM,
      };
    });
}
```

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

### Task 4: Store the totals

**Files:**
- Modify: `src/db/schema.ts` (the `runs` table)
- Generated: `src/db/migrations/` (via `bun run db:generate` — never hand-edited)
- Modify: `src/db/save-run.ts:12` (`rollupFromPoints`) and `:102-118` (the transaction)
- Modify: `src/domain/format.ts`
- Test: `src/domain/format.test.ts`

**Interfaces:**
- Consumes: `elevationRollup` (Task 2).
- Produces: `runs.elevationGainM` / `runs.elevationLossM` (`number | null` on the inferred `Run` type); `formatElevationM(meters: number): string`.

- [ ] **Step 1: Add the columns to the schema**

In `src/db/schema.ts`, inside the `runs` table, immediately after `summaryPolyline`:

```ts
  elevationGainM: real('elevation_gain_m'),
  elevationLossM: real('elevation_loss_m'),
```

No comment needed — the names carry it.

- [ ] **Step 2: Generate the migration**

```bash
bun run db:generate
```

Expected: a new `.sql` file plus an updated `migrations.js` under `src/db/migrations/`. Read the generated SQL and confirm it is two `ALTER TABLE runs ADD COLUMN` statements and nothing else. If it proposes to recreate the table or drop anything, STOP and report.

- [ ] **Step 3: Write the failing formatter test**

Append to `src/domain/format.test.ts`:

```ts
describe('formatElevationM', () => {
  test('rounds to the nearest 5 m', () => {
    // why: GPS-derived gain is approximate (ADR 0015); a precise-looking figure
    // would overstate what the measurement can support.
    expect(formatElevationM(0)).toBe('0 m');
    expect(formatElevationM(122)).toBe('120 m');
    expect(formatElevationM(123)).toBe('125 m');
    expect(formatElevationM(2)).toBe('0 m');
  });
});
```

Add `formatElevationM` to the existing `import { … } from './format'` at the top of that file.

- [ ] **Step 4: Run it to verify it fails**

Run: `bun test src/domain/format.test.ts`
Expected: FAIL — `formatElevationM is not a function`.

- [ ] **Step 5: Implement the formatter**

Append to `src/domain/format.ts`:

```ts
/** Metres rounded to 5 — GPS-derived elevation cannot support a finer figure (ADR 0015). */
export function formatElevationM(meters: number): string {
  return `${Math.round(meters / 5) * 5} m`;
}
```

- [ ] **Step 6: Wire elevation into the finalize rollup**

In `src/db/save-run.ts`, extend the import and the rollup:

```ts
import { elevationRollup } from '@/domain/elevation';
```

```ts
function rollupFromPoints(runId: string) {
  const fixes = loadRunFixes(runId);
  const elevation = elevationRollup(
    fixes.map((fix) => ({ timestamp: fix.timestamp, altitudeM: fix.altitude })),
  );
  return { hasPoints: fixes.length > 0, elevation, ...smoothTrackBySegment(fixes) };
}
```

Destructure it in `finalizeRun`:

```ts
const { hasPoints, distanceM, points, distanceBySegmentSeq, elevation } = rollupFromPoints(runId);
```

And add two lines to the existing `.set({ … })` inside the transaction, after `summaryPolyline`:

```ts
        elevationGainM: hasPoints ? elevation.gainM : null,
        elevationLossM: hasPoints ? elevation.lossM : null,
```

**Leave `saveRun` untouched.** That path has no `'active'` row and therefore no `run_points` to fold — the existing `// why:` at `src/db/save-run.ts:29` already documents the class, and elevation is `null` there for the same reason.

- [ ] **Step 7: Verify and commit**

```bash
bun test && bun run typecheck && bun run lint
git add -- src/db/schema.ts src/db/migrations src/db/save-run.ts src/domain/format.ts src/domain/format.test.ts
git commit -m "feat: store per-run elevation gain and loss at finalize"
```

---

### Task 5: The colour token and the hook

**Files:**
- Modify: `src/constants/theme.ts` (`StatColors`)
- Create: `src/hooks/use-run-profile.ts`

**Interfaces:**
- Consumes: `toRunProfile`, `ProfilePoint` (Task 3); `loadRunFixes` from `@/db/run-points`.
- Produces:
  - `StatColors[scheme].elevation: string`
  - `type RunProfile = { ready: false } | { ready: true; points: ProfilePoint[]; hasElevation: boolean }`
  - `useRunProfile(runId: string, loaded: boolean): RunProfile`

- [ ] **Step 1: Add the elevation accent**

In `src/constants/theme.ts`, add `elevation: string;` to the `StatColors` type literal, then a value to each scheme:

```ts
  light: {
    // …existing…
    elevation: '#34C759', // systemGreen
  },
  dark: {
    // …existing…
    elevation: '#30D158',
  },
```

- [ ] **Step 2: Write the hook**

```ts
// src/hooks/use-run-profile.ts
import { useMemo } from 'react';

import { loadRunFixes } from '@/db/run-points';
import { toRunProfile, type ProfilePoint } from '@/domain/run-profile';

export type RunProfile =
  | { ready: false }
  | { ready: true; points: ProfilePoint[]; hasElevation: boolean };

/**
 * A finished run's pace/elevation series. Reads `run_points` ONCE, non-reactively — never via
 * `useLiveQuery` (ADR 0004 §3) — and re-folds with the same smoother the stored distance used
 * (ADR 0021 §3). `loaded` is the caller's `updatedAt !== undefined`.
 */
export function useRunProfile(runId: string, loaded: boolean): RunProfile {
  return useMemo(() => {
    if (!loaded) return { ready: false };
    try {
      const points = toRunProfile(loadRunFixes(runId));
      // why 2: a single point draws no line, so it is indistinguishable from no chart.
      if (points.length < 2) return { ready: false };
      return {
        ready: true,
        points,
        hasElevation: points.some((point) => point.elevationM !== null),
      };
    } catch (error) {
      // why: no ErrorBoundary wraps this route; a SQLite read failure must degrade to
      // no card, not crash render.
      console.warn('[use-run-profile] profile load failed; hiding the card', error);
      return { ready: false };
    }
  }, [runId, loaded]);
}
```

- [ ] **Step 3: Verify and commit**

```bash
bun run typecheck && bun run lint
git add -- src/constants/theme.ts src/hooks/use-run-profile.ts
git commit -m "feat: add the run profile hook and elevation accent token"
```

---

### Task 6: The chart component

**Files:**
- Create: `src/components/run-profile-chart.tsx`

**Interfaces:**
- Consumes: `ProfilePoint` (Task 3); `useStatColors` from `@/hooks/use-theme`; the axis-inversion mechanism recorded in Task 1 Step 5.
- Produces: `<RunProfileChart points={ProfilePoint[]} showElevation={boolean} />`

- [ ] **Step 1: Write the component**

Apply the inversion mechanism Task 1 verified. If the reversed `domain` tuple worked, this is it:

```tsx
// src/components/run-profile-chart.tsx
import { matchFont } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { View } from 'react-native';
import { CartesianChart, Line } from 'victory-native';

import type { ProfilePoint } from '@/domain/run-profile';
import { useStatColors } from '@/hooks/use-theme';

const AXIS_FONT_SIZE = 11;
const CHART_HEIGHT = 200;

/**
 * Pace and elevation against distance (spec §7.2). The only file importing victory-native —
 * if it is ever swapped for hand-drawn Skia, nothing outside this file changes.
 */
export function RunProfileChart({
  points,
  showElevation,
}: {
  points: ProfilePoint[];
  showElevation: boolean;
}) {
  const stat = useStatColors();
  const font = useMemo(() => matchFont({ fontSize: AXIS_FONT_SIZE }), []);

  // why inverted: pace is seconds per km, so a LOWER value is faster and belongs higher.
  const paceDomain = useMemo(() => {
    const paces = points.map((p) => p.paceSecPerKm).filter((p): p is number => p !== null);
    if (paces.length === 0) return undefined;
    return [Math.max(...paces), Math.min(...paces)] as [number, number];
  }, [points]);

  return (
    <View
      style={{ height: CHART_HEIGHT }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <CartesianChart
        data={points}
        xKey="distanceM"
        yKeys={['paceSecPerKm', 'elevationM']}
        yAxis={[
          { yKeys: ['paceSecPerKm'], axisSide: 'left', font, domain: paceDomain },
          { yKeys: ['elevationM'], axisSide: 'right', font },
        ]}
      >
        {({ points: rendered }) => (
          <>
            <Line points={rendered.paceSecPerKm} color={stat.pace} strokeWidth={2} />
            {showElevation ? (
              <Line points={rendered.elevationM} color={stat.elevation} strokeWidth={2} />
            ) : null}
          </>
        )}
      </CartesianChart>
    </View>
  );
}
```

**If Task 1 found the reversed `domain` tuple was rejected**, drop `paceDomain`, map `paceSecPerKm` to its negation when building the chart data, and add a tick formatter that re-negates for display. Record which path shipped in a `// why:` at the site.

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
- Consumes: `useRunProfile` (Task 5); `RunProfileChart` (Task 6); `formatElevationM` (Task 4); `formatDistanceKm` from `@/domain/format`; `Card`, `Text`, `useStatColors`.
- Produces: `<RunProfileCard run={Run} />`

- [ ] **Step 1: Write the card**

```tsx
// src/components/run-profile-card.tsx
import { SymbolView } from 'expo-symbols';
import { PixelRatio, View } from 'react-native';

import { RunProfileChart } from '@/components/run-profile-chart';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { Run } from '@/db/schema';
import { formatDistanceKm, formatElevationM } from '@/domain/format';
import { useRunProfile } from '@/hooks/use-run-profile';
import { useStatColors } from '@/hooks/use-theme';

const TOTAL_SYMBOL_POINTS = 13;

function symbolSize() {
  return Math.round(TOTAL_SYMBOL_POINTS * Math.min(PixelRatio.getFontScale(), 1.6));
}

/**
 * A finished run's pace-and-elevation profile with its gain/loss totals (ADR 0013 domain
 * component). Renders nothing without a usable route: the route card directly above already
 * explains why such a run has no GPS data, and a second explanatory card would be noise.
 */
export function RunProfileCard({ run }: { run: Run }) {
  const profile = useRunProfile(run.id, true);
  const stat = useStatColors();

  if (!profile.ready) return null;

  const gain = run.elevationGainM;
  const loss = run.elevationLossM;
  const showTotals = profile.hasElevation && gain !== null && loss !== null;
  const distance = run.distanceM !== null ? formatDistanceKm(run.distanceM) : null;

  const label = [
    'Elevation and pace profile',
    showTotals ? `${formatElevationM(gain)} gained, ${formatElevationM(loss)} lost` : null,
    distance ? `over ${distance}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card surface="card" className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text variant="footnote" tone="secondary" className="font-semibold" accessibilityRole="header">
          Pace & Elevation
        </Text>
        {showTotals ? (
          <View className="flex-row items-center gap-3">
            <View className="flex-row items-center gap-1">
              <SymbolView name="arrow.up.right" size={symbolSize()} tintColor={stat.elevation} />
              <Text variant="footnote" tone="secondary">
                {formatElevationM(gain)}
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              <SymbolView name="arrow.down.right" size={symbolSize()} tintColor={stat.elevation} />
              <Text variant="footnote" tone="secondary">
                {formatElevationM(loss)}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* why the label lives here: the chart is a Skia canvas and carries no accessible
          content of its own, so the card is the only thing VoiceOver can read. */}
      <View accessible accessibilityLabel={label}>
        <RunProfileChart points={profile.points} showElevation={profile.hasElevation} />
      </View>
    </Card>
  );
}
```

- [ ] **Step 2: Compose it into the summary**

In `src/app/runs/[runId]/index.tsx`, add the import:

```tsx
import { RunProfileCard } from '@/components/run-profile-card';
```

and place it between `RunStatGrid` and `SegmentBreakdown`:

```tsx
            <RunStatGrid run={run} segments={segments} />
            <RunProfileCard run={run} />
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
2. Both lines paint; the pace line reads **fast-at-top**.
3. Gain and loss appear in the header, both multiples of 5.
4. Contrast: the elevation line is legible against the card in light and dark. Non-text graphics want 3:1 — if systemGreen looks weak, darken the light-mode value and say so.

Then re-check in dark mode and at a large text size:

```bash
xcrun simctl ui <udid> appearance dark
xcrun simctl ui <udid> content_size accessibility-large
```

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
- assertNotVisible: "Pace & Elevation"
```

- [ ] **Step 2: Run the affected flow**

Load the `e2e-refresh` skill and run `complete-session.yaml` through it. The skill fingerprint-gates the rebuild; if Task 1 Step 3 found the hash unchanged, this repacks in about a minute.

Expected: PASS. Report which flows you ran.

- [ ] **Step 3: Write ADR 0024**

Create `docs/adr/0024-victory-native-charting.md` following the house structure (`## Status`, `## Context`, `## Decision`, `## Consequences`, `## Alternatives considered`) — read ADR 0010 first, it is the closest precedent. Status: `Proposed — draft for review. Flip to Accepted on merge.`

It must record: that AGENTS.md prefers Expo-official packages and this is a deliberate exception, exactly as ADR 0010 made one for react-native-maps; that all three peers were already installed so nothing new reaches the native layer; the measured before/after fingerprint hashes from Task 1; the single-import containment rule and the hand-drawn Skia fallback; and the Reanimated 4 risk with the spike result that settled it.

- [ ] **Step 4: Update the roadmap row**

In `docs/roadmap/README.md`, change the elevation row's Status to `Planned` and **rename the feature** from "Run elevation on the map" to "Run elevation & pace profile" — elevation is deliberately not on the map. Link this spec and plan.

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

**Spec coverage.** §2 decisions → Tasks 2–7; §3.1 spike and fingerprint → Task 1; §3.2 existing altitude data → Task 3; §4.2 reducer with the three load-bearing properties → Task 2 (each has a test); §4.3 hook → Task 5; §5.1 rebasing → Task 2; §5.2 bucketed pace → Task 3; §5.3 hysteresis → Task 2; §5.4 axis inversion → Tasks 1 and 6; §6 storage and rollup → Task 4; §7.1 card and a11y → Task 7; §7.2 chart → Task 6; §8 degradation → Tasks 5 (`ready: false`), 6 (`showElevation`), 7 (null return); §9.1 gate → Task 1; §9.2 unit set → Tasks 2–4; §9.3 E2E → Task 8; §9.4 manual → Task 7 Step 3; §10 docs → Task 8.

**Gap found and closed:** §8's "run finalized before this shipped" row had no explicit coverage. It is handled by Task 7's `showTotals` guard, which requires non-null `elevationGainM` *and* `elevationLossM` — an older run renders the chart with no header totals, which is the specified behaviour.

**Placeholders:** none. Every code step carries runnable code; the one branch point (axis inversion) names both concrete paths and which task decides.

**Type consistency:** `AltitudeSample`, `ElevationState`, `ElevationRollup.seriesM`, `ProfilePoint`, `RunProfile`, `elevationGainM`/`elevationLossM` are spelled identically wherever they appear across Tasks 2–7. `useRunProfile(runId, loaded)` is called as `useRunProfile(run.id, true)` in Task 7 — the summary only mounts the card once its own live query has loaded, matching how `RouteMapCard` passes `true` to `useRunRoute`.
