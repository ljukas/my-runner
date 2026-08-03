# Run Elevation & Pace Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a run-summary card charting pace and elevation against distance.

**Architecture:** Elevation comes from `run_points.altitude`, which the app already persists for every accepted GPS fix — no new sensor, permission, native module, or schema change. A pure streaming reducer (`domain/elevation.ts`) smooths altitude and banks gain/loss with hysteresis; it mirrors `smoothFix`/`smoothTrack` (ADR 0021) so the barometer slice that follows plugs in as a second *source*, not a second implementation. The chart series is derived at display time from `run_points`, and nothing is stored — gain/loss totals are computed and tested but deliberately not displayed in this slice (spec §3.5).

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

> **Amended 2026-08-03.** Elevation gain/loss totals and their storage are cut from this slice (spec §2, §3.5, §6) — GPS cannot support them honestly, and they land with the barometer slice instead. **Task 4 is removed**; Task 2's fixtures are rewritten; Task 7's card loses its header totals. Task numbering is unchanged so briefs still extract by number.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/elevation.ts` | **Create.** Pure streaming altitude reducer: median smoothing, hysteresis gain/loss, sticky trend. |
| `src/domain/elevation.test.ts` | **Create.** Property tests — the noise-rejection guard is the important one. |
| `src/domain/run-profile.ts` | **Create.** Pure: fixes → resampled `{ distanceM, paceSecPerKm, elevationM }[]`. |
| `src/domain/run-profile.test.ts` | **Create.** Bucketing, pace, distance preservation. |
| `src/constants/theme.ts` | **Modify.** `StatColors.elevation`. |
| `src/hooks/use-run-profile.ts` | **Create.** One imperative read, memoised fold. Modelled on `use-run-route.ts`. |
| `src/components/run-profile-chart.tsx` | **Create.** The ONLY file importing `victory-native`. |
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
  - `interface ElevationStep { state: ElevationState; smoothedAltitudeM: number | null; trend: ElevationTrend }`
  - `interface ElevationRollup { gainM: number; lossM: number; seriesM: (number | null)[] }`
  - `createElevationState(config?: ElevationConfig): ElevationState`
  - `elevationStep(state: ElevationState, sample: AltitudeSample): ElevationStep`
  - `elevationRollup(samples: readonly AltitudeSample[], config?: ElevationConfig): ElevationRollup`

**Every bound below was measured against this exact implementation before the plan was written — they are observations, not guesses. If one fails, the implementation diverged from the brief; re-read it before touching a number.**

- [ ] **Step 1: Write the failing tests**

```ts
// src/domain/elevation.test.ts
import { describe, expect, test } from 'bun:test';

import {
  createElevationState,
  elevationRollup,
  elevationStep,
  GPS_ELEVATION_CONFIG,
  type AltitudeSample,
} from './elevation';

function samples(altitudes: (number | null)[]): AltitudeSample[] {
  return altitudes.map((altitudeM, i) => ({ timestamp: 1_000_000 + i * 1000, altitudeM }));
}

/** Seeded PRNG so a failure reproduces exactly. NEVER use a sinusoid for noise here:
 *  a median filter annihilates a coherent sinusoid, so a sinusoidal fixture passes
 *  while the reducer banks hundreds of phantom metres against real noise. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 30 minutes at 1 Hz on flat ground with +-`amplitude` m of vertical noise. */
function flatWithNoise(amplitude: number, seed: number): AltitudeSample[] {
  const random = mulberry32(seed);
  return samples(Array.from({ length: 1800 }, () => 100 + (random() * 2 - 1) * amplitude));
}

function meanPhantomGain(amplitude: number): number {
  let total = 0;
  for (let seed = 1; seed <= 5; seed += 1) {
    total += elevationRollup(flatWithNoise(amplitude, seed)).gainM;
  }
  return total / 5;
}

const RAMP = 300;
const flat = (count: number, value: number) => Array.from({ length: count }, () => value);
const rampUp = Array.from({ length: RAMP }, (_, i) => 100 + (i * 40) / RAMP);
const rampDown = Array.from({ length: RAMP }, (_, i) => 140 - (i * 40) / RAMP);

describe('elevationRollup noise rejection', () => {
  test('realistic +-10 m noise on flat ground banks essentially nothing', () => {
    // why this matters: raw per-sample summing inflates a flat run's gain into the
    // hundreds of metres (ADR 0015). This is the reason the module exists.
    // Do NOT loosen this bound — retune GPS_ELEVATION_CONFIG instead.
    expect(meanPhantomGain(10)).toBeLessThan(5);
  });

  test('+-25 m noise defeats the GPS config — the reason totals are not displayed', () => {
    // why assert the bad outcome: spec §3.5 cut the displayed gain/loss totals because
    // GPS cannot support them in poor conditions. This pins that finding so the totals
    // cannot quietly return. If this ever FAILS, that is good news — noise rejection
    // improved, and spec §3.5's conclusion should be revisited deliberately.
    expect(meanPhantomGain(25)).toBeGreaterThan(20);
  });
});

describe('elevationRollup real terrain', () => {
  test('a clean 40 m climb banks its full height and no loss', () => {
    // why padded: the trailing median warms up at the start but lags at the end, and an
    // unpadded fixture bakes that boundary artifact into the assertion (spec §3.5).
    const result = elevationRollup(samples([...flat(40, 100), ...rampUp, ...flat(40, 140)]));
    expect(result.gainM).toBeGreaterThan(35);
    expect(result.gainM).toBeLessThanOrEqual(40);
    expect(result.lossM).toBe(0);
  });

  test('a symmetric climb and descent banks the two equally', () => {
    const result = elevationRollup(
      samples([...flat(40, 100), ...rampUp, ...rampDown, ...flat(40, 100)]),
    );
    // why not the full 40: a final partial move below the hysteresis threshold never banks.
    expect(result.gainM).toBeGreaterThan(25);
    expect(result.lossM).toBeGreaterThan(25);
    expect(Math.abs(result.gainM - result.lossM)).toBeLessThan(2);
  });

  test('a sub-threshold bump that reverses banks nothing', () => {
    const result = elevationRollup(samples([...flat(40, 100), 102, 104, 102, ...flat(40, 100)]));
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
  });
});

describe('elevationRollup series', () => {
  test('is rebased so the first known altitude reads 0', () => {
    const result = elevationRollup(samples(flat(40, 850)));
    expect(result.seriesM[0]).toBe(0);
    expect(result.seriesM.at(-1)).toBe(0);
  });

  test('preserves nulls and never banks movement from them', () => {
    const result = elevationRollup(samples([null, 100, null, 100, null]));
    expect(result.seriesM[0]).toBeNull();
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
  });

  test('an all-null run yields an all-null series and no movement', () => {
    const result = elevationRollup(samples([null, null, null]));
    expect(result.gainM).toBe(0);
    expect(result.lossM).toBe(0);
    expect(result.seriesM.every((value) => value === null)).toBe(true);
  });

  test('empty and single-sample inputs are safe', () => {
    expect(elevationRollup([])).toEqual({ gainM: 0, lossM: 0, seriesM: [] });
    expect(elevationRollup(samples([100])).gainM).toBe(0);
  });

  test('equals a manual fold of elevationStep', () => {
    // why: the live path and the re-derived path must agree by construction
    // (the ADR 0021 §3 property, applied to elevation).
    const input = samples([...flat(40, 100), ...rampUp]);
    let state = createElevationState();
    for (const sample of input) state = elevationStep(state, sample).state;

    const result = elevationRollup(input);
    expect(result.gainM).toBe(state.gainM);
    expect(result.lossM).toBe(state.lossM);
  });
});

describe('ElevationConfig', () => {
  test('a gentle config resolves terrain the GPS config smooths away', () => {
    // why this test exists: it is the whole argument for tuning being a parameter.
    // The same clean 30 m climb, at barometer precision, banks its full height under a
    // gentle config and only two thirds of it under the noise-rejecting GPS one.
    const climb = samples([
      ...flat(10, 100),
      ...Array.from({ length: 60 }, (_, i) => 100 + i * 0.5),
      ...flat(10, 130),
    ]);
    const gentle = elevationRollup(climb, { medianWindow: 5, hysteresisM: 2 });
    const gps = elevationRollup(climb, GPS_ELEVATION_CONFIG);

    expect(gentle.gainM).toBeGreaterThan(gps.gainM);
    expect(gentle.gainM).toBeGreaterThan(25);
  });

  test('defaults to the GPS config', () => {
    expect(createElevationState().config).toEqual(GPS_ELEVATION_CONFIG);
  });
});

describe('elevationStep trend', () => {
  test('starts flat', () => {
    expect(createElevationState().trend).toBe('flat');
  });

  test('becomes climbing once a rise clears the threshold, and stays climbing', () => {
    let state = createElevationState();
    for (const sample of samples([...flat(40, 100), ...rampUp])) {
      state = elevationStep(state, sample).state;
    }
    expect(state.trend).toBe('climbing');

    // why sticky: a banked move resets the anchor to the current altitude, so a
    // non-sticky trend would flicker to flat between every banked step of one climb.
    for (const sample of samples(flat(5, 140))) state = elevationStep(state, sample).state;
    expect(state.trend).toBe('climbing');
  });

  test('flips to descending only after a threshold-clearing reversal', () => {
    let state = createElevationState();
    for (const sample of samples([...flat(40, 100), ...rampUp])) {
      state = elevationStep(state, sample).state;
    }
    expect(state.trend).toBe('climbing');
    for (const sample of samples(rampDown)) state = elevationStep(state, sample).state;
    expect(state.trend).toBe('descending');
  });

  test('state stays JSON-serialisable', () => {
    // why: the engine snapshots this for crash recovery (ADR 0007) when the live
    // readout lands — a Map or a class would silently break that.
    let state = createElevationState();
    for (const sample of samples([...flat(40, 100), ...rampUp])) {
      state = elevationStep(state, sample).state;
    }
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

/** why a parameter and not a constant: GPS needs a wide window and a ~10 m threshold to
 *  reject its own noise, while a barometer at ~1 m precision would have real terrain erased
 *  by those values. One shared pair would silently mis-tune whichever source came second. */
export interface ElevationConfig {
  medianWindow: number;
  hysteresisM: number;
}

/** Measured, not guessed — spec §3.5: at these values +-10 m noise banks 0 m of phantom
 *  gain over a 30-minute flat run while a real 40 m climb still reports 40 m. */
export const GPS_ELEVATION_CONFIG: ElevationConfig = { medianWindow: 31, hysteresisM: 10 };

/** Plain JSON by construction: the engine snapshots this (ADR 0007) once the live readout lands. */
export interface ElevationState {
  config: ElevationConfig;
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

export function createElevationState(config: ElevationConfig = GPS_ELEVATION_CONFIG): ElevationState {
  return { config, window: [], anchorM: null, gainM: 0, lossM: 0, trend: 'flat' };
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

  const window = [...state.window, raw].slice(-state.config.medianWindow);
  const smoothed = median(window);

  if (state.anchorM === null) {
    const seeded = { ...state, window, anchorM: smoothed };
    return { state: seeded, smoothedAltitudeM: smoothed, trend: seeded.trend };
  }

  const delta = smoothed - state.anchorM;
  if (Math.abs(delta) < state.config.hysteresisM) {
    const held = { ...state, window };
    return { state: held, smoothedAltitudeM: smoothed, trend: held.trend };
  }

  const banked: ElevationState = {
    config: state.config,
    window,
    anchorM: smoothed,
    gainM: delta > 0 ? state.gainM + delta : state.gainM,
    lossM: delta < 0 ? state.lossM - delta : state.lossM,
    trend: delta > 0 ? 'climbing' : 'descending',
  };
  return { state: banked, smoothedAltitudeM: smoothed, trend: banked.trend };
}

export function elevationRollup(
  samples: readonly AltitudeSample[],
  config: ElevationConfig = GPS_ELEVATION_CONFIG,
): ElevationRollup {
  let state = createElevationState(config);
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
- Consumes: `useRunProfile` (Task 5); `RunProfileChart` (Task 6); `formatDistanceKm` from `@/domain/format`; `Card`, `Text`.
- Produces: `<RunProfileCard run={Run} />`

- [ ] **Step 1: Write the card**

```tsx
// src/components/run-profile-card.tsx
import { View } from 'react-native';

import { RunProfileChart } from '@/components/run-profile-chart';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { Run } from '@/db/schema';
import { formatDistanceKm } from '@/domain/format';
import { useRunProfile } from '@/hooks/use-run-profile';

/**
 * A finished run's pace-and-elevation profile (ADR 0013 domain component). Renders nothing
 * without a usable route: the route card directly above already explains why such a run has
 * no GPS data, and a second explanatory card would be noise.
 *
 * No gain/loss totals — spec §3.5 measured GPS elevation as ~2x wrong in poor conditions,
 * so the shape ships and the numbers wait for the barometer slice.
 */
export function RunProfileCard({ run }: { run: Run }) {
  const profile = useRunProfile(run.id, true);

  if (!profile.ready) return null;

  const distance = run.distanceM !== null ? formatDistanceKm(run.distanceM) : null;
  const label = profile.hasElevation
    ? `Pace and elevation profile${distance ? ` over ${distance}` : ''}`
    : `Pace profile${distance ? ` over ${distance}` : ''}`;

  return (
    <Card surface="card" className="gap-3">
      <Text variant="footnote" tone="secondary" className="font-semibold" accessibilityRole="header">
        {profile.hasElevation ? 'Pace & Elevation' : 'Pace'}
      </Text>

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

- [ ] **Step 3b: Amend ADR 0015 with the measurement**

ADR 0015 asserted GPS altitude is too noisy to sum. This slice *quantified* it. Add a dated amendment carrying spec §3.5's table — 537 m phantom gain at ±10 m untuned, ~94 m even at the tuned GPS config when noise reaches ±25 m, and the finding that the settings which suppress that also report zero loss on a real 40 m descent. State the conclusion plainly: no single window/threshold pair is safe across regimes, which is why the displayed totals were cut and deferred to the barometer slice. Record that item 5's columns move to that slice. Leave item 7 (background barometer delivery) open — this slice produced no device evidence for it.

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

**Gap found and closed (original pass):** §8's "run finalized before this shipped" row had no explicit coverage. After the 2026-08-03 amendment it needs none — nothing is stored, so the series is re-derived from `run_points` for every run alike and there is no old/new distinction.

**Amendment pass (2026-08-03):** spec §3.5 is covered by Task 2's two noise tests; §2's "no totals" by Task 4's removal and Task 7's card; §4.2's per-source config by Task 2's `ElevationConfig` block and its dedicated test; §6's "no storage" by Task 4 being empty.

**Placeholders:** none. Every code step carries runnable code; the one branch point (axis inversion) names both concrete paths and which task decides.

**Type consistency:** `AltitudeSample`, `ElevationConfig`, `GPS_ELEVATION_CONFIG`, `ElevationState`, `ElevationRollup.seriesM`, `ProfilePoint`, `RunProfile` are spelled identically wherever they appear across Tasks 2–7. `useRunProfile(runId, loaded)` is called as `useRunProfile(run.id, true)` in Task 7 — the summary only mounts the card once its own live query has loaded, matching how `RouteMapCard` passes `true` to `useRunRoute`.
