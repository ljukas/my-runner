# Stage 5 — Apple Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A finished run is written to Apple Health as a running workout carrying its duration, distance, GPS route and per-segment distance samples — automatically when authorized, retryable when not, and never blocking or endangering the local save.

**Architecture:** Write-only HealthKit behind the `HealthAdapter` port (ADR 0003, 0011). All mapping is pure TypeScript in `src/domain/health.ts` and covered by `bun test`. The save is triggered by a **persistence decorator at the composition root** — `withHealthSync(dbRunPersistence, …)` in `src/services/run-engine/index.ts` — so the run engine is not modified at all. `runs.healthkit_saved` has existed since `0000_init.sql`, so there is **no schema change and no migration**.

**Tech Stack:** Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript ~6.0 · Bun · `@kingstinct/react-native-healthkit@14.0.2` + `react-native-nitro-modules` · `@expo/ui` (SwiftUI) · Uniwind · Drizzle + expo-sqlite · Maestro

**Design spec:** [`docs/superpowers/specs/2026-07-31-stage-5-apple-health-design.md`](../specs/2026-07-31-stage-5-apple-health-design.md) — **read §3 (verified platform facts) before touching the adapter.** Governing ADRs: 0003, 0004, 0005, 0011, 0013, 0016, 0019, 0021.

## Global Constraints

- **Read `https://docs.expo.dev/versions/v57.0.0/` before writing any Expo/RN code.** This project is newer than most training data; do not rely on memorised APIs.
- **Do NOT use Context7 for `@kingstinct/react-native-healthkit`.** Its pages are generated `_autodocs` describing an API that exists in neither the release nor `master` (an options-object `saveWorkoutSample` with `events`/`activities`, and `requestAuthorization({ toRead, toWrite })`). Spec §3 is the verified record; `npm pack @kingstinct/react-native-healthkit@14.0.2` and read the Swift if you need more.
- **Comments: WHY, not WHAT** (AGENTS.md). Architecture belongs in ADRs — reference them (`// per ADR 0011 §4`), never re-explain them. No types in JSDoc.
- **`domain/` is pure TypeScript** — no React, no Expo, no DB, no platform imports (ADR 0003 §1).
- **Only `adapter.ios.ts` may import `@kingstinct/react-native-healthkit`** (ADR 0011 §1). If any other file imports it, the port has failed.
- **Never `useLiveQuery` on `run_points`** (ADR 0004 §3). `runs` scoped to a fixed id is an approved live-query case.
- **Version pin, exact:** `@kingstinct/react-native-healthkit@14.0.2`.
- **`background: false` in the plugin config is load-bearing** — it is what suppresses the background-delivery entitlement *and* an AppDelegate modification (ADR 0011 §3, spec §3.3).
- **Never write `activeEnergyBurned`** — unmeasurable here, and App Review 5.1.3 forbids fabricating it (spec §2).
- **`totals` is never omitted alongside segment samples** — see Task 5; omitting it silently sets the workout total to the last segment's distance.
- **Objective gate per task:** `bun run lint && bun run typecheck && bun test` must pass before a task is complete.
- **`ios/` is gitignored and CNG-generated.** Never edit native projects; configure via `app.json` and config plugins only. A `PreToolUse` hook blocks `CHANGELOG.md`, `src/db/migrations/`, `.expo/types/`, `ios/`, `bun.lock`, and the `version` field.
- **Commit style:** Conventional Commits. `export COREPACK_ENABLE_AUTO_PIN=0` in your shell; never commit a `packageManager` field.

## Task Order and Why

Tasks 1–3 are **pure TypeScript** — `bun test` only, no native build, no simulator. They carry the real logic risk (time windows under pauses, null-filling, the `totals` invariant, trigger ordering) and land first, fully tested. Task 4 is the single native-rebuild gate; everything after it needs a full `e2e-refresh` rebuild rather than a JS repack. Tasks 5–6 wire the platform edge. Tasks 7–9 are UI. Task 9 **must** ship the E2E helper repairs in the same commit — adding a fourth onboarding step breaks three existing flows the moment the step exists. Tasks 10–12 are E2E, verification, and doc fold-back.

---

### Task 1: Route point mapping

`run_points` stores nullable altitude/accuracy/speed and has no `course` or `verticalAccuracy` column, but HealthKit's `LocationForSaving` requires all eight fields non-null (spec §3.2, §5.1). This task owns that conversion.

**Files:**
- Create: `src/domain/health.ts`
- Test: `src/domain/health.test.ts`

**Interfaces:**
- Consumes: `SegmentedFix` from `@/domain/geo` (`{ timestamp, lat, lng, altitude, accuracy, speed, segmentSeq }`, all but `timestamp`/`lat`/`lng`/`segmentSeq` nullable).
- Produces: `CL_UNKNOWN: -1`, `interface HealthRoutePoint`, `toHealthRoute(fixes: readonly SegmentedFix[]): HealthRoutePoint[]`.

- [ ] **Step 1: Write the failing test**

Create `src/domain/health.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { CL_UNKNOWN, toHealthRoute } from './health';
import type { SegmentedFix } from './geo';

function makeFix(overrides: Partial<SegmentedFix> = {}): SegmentedFix {
  return {
    timestamp: 1_000,
    lat: 59.3293,
    lng: 18.0686,
    altitude: 12,
    accuracy: 5,
    speed: 2.8,
    segmentSeq: 0,
    ...overrides,
  };
}

describe('toHealthRoute', () => {
  test('passes coordinates, timestamp and measured values through', () => {
    const [point] = toHealthRoute([makeFix()]);
    expect(point).toEqual({
      latitude: 59.3293,
      longitude: 18.0686,
      timestamp: 1_000,
      altitude: 12,
      horizontalAccuracy: 5,
      speed: 2.8,
      course: CL_UNKNOWN,
      verticalAccuracy: CL_UNKNOWN,
    });
  });

  test('marks unmeasured accuracy and speed as unknown rather than zero', () => {
    const [point] = toHealthRoute([makeFix({ accuracy: null, speed: null })]);
    expect(point.horizontalAccuracy).toBe(CL_UNKNOWN);
    expect(point.speed).toBe(CL_UNKNOWN);
  });

  test('falls back to sea level when altitude was not recorded', () => {
    const [point] = toHealthRoute([makeFix({ altitude: null })]);
    expect(point.altitude).toBe(0);
  });

  test('preserves order and handles an empty track', () => {
    const points = toHealthRoute([makeFix({ timestamp: 1 }), makeFix({ timestamp: 2 })]);
    expect(points.map((p) => p.timestamp)).toEqual([1, 2]);
    expect(toHealthRoute([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/domain/health.test.ts`
Expected: FAIL — `Cannot find module './health'`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/health.ts`:

```ts
/** Pure Apple Health payload mapping — no React, Expo, native or DB imports (ADR 0003 §1). */

import type { SegmentedFix } from './geo';

/**
 * CoreLocation's marker for a value it did not measure. why not 0: Health reads 0 as a real,
 * measured zero — a stationary runner with perfect accuracy — where a negative reads as unknown.
 */
export const CL_UNKNOWN = -1;

/** A route point with every field HealthKit's `LocationForSaving` requires non-null (spec §3.2). */
export interface HealthRoutePoint {
  latitude: number;
  longitude: number;
  /** Epoch ms; the adapter converts to `Date` at the library boundary. */
  timestamp: number;
  altitude: number;
  course: number;
  speed: number;
  horizontalAccuracy: number;
  verticalAccuracy: number;
}

export function toHealthRoute(fixes: readonly SegmentedFix[]): HealthRoutePoint[] {
  return fixes.map((fix) => ({
    latitude: fix.lat,
    longitude: fix.lng,
    timestamp: fix.timestamp,
    altitude: fix.altitude ?? 0,
    horizontalAccuracy: fix.accuracy ?? CL_UNKNOWN,
    speed: fix.speed ?? CL_UNKNOWN,
    // Never recorded: run_points has no course or vertical-accuracy column (spec §5.1).
    course: CL_UNKNOWN,
    verticalAccuracy: CL_UNKNOWN,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/domain/health.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Gate and commit**

```bash
bun run lint && bun run typecheck && bun test
git add src/domain/health.ts src/domain/health.test.ts
git commit -m "feat: map recorded fixes to HealthKit route points"
```

---

### Task 2: Segment sample windows and the workout payload

The subtle one. `run_segments` stores `actual_duration_s` but **no timestamps**, and those durations exclude paused time — prefix-summing them from `started_at` would date every sample after a pause wrongly. Windows come from each segment's own points instead (spec §5.2).

**Files:**
- Modify: `src/domain/health.ts` (append)
- Test: `src/domain/health.test.ts` (append)

**Interfaces:**
- Consumes: `toHealthRoute`, `HealthRoutePoint`, `SegmentedFix`.
- Produces: `interface HealthDistanceSample { startedAt: number; endedAt: number; meters: number }`, `interface HealthRunInput { startedAt: string; endedAt: string; distanceM: number | null }`, `interface HealthSegmentInput { seq: number; distanceM: number | null }`, `interface HealthWorkoutInput { startedAt: number; endedAt: number; totalDistanceM: number | null; segmentSamples: HealthDistanceSample[]; route: HealthRoutePoint[] }`, `toHealthSegmentSamples(segments, fixes)`, `toHealthWorkout(run, segments, fixes)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/health.test.ts` (`makeFix` is already defined at the top of the file — reuse it).

First **extend the existing `./health` import** rather than adding a second one — a duplicate import from the same module fails `bun run lint`:

```ts
import { CL_UNKNOWN, toHealthRoute, toHealthSegmentSamples, toHealthWorkout } from './health';
```

Then append the new suites:

```ts
describe('toHealthSegmentSamples', () => {
  const fixes = [
    makeFix({ segmentSeq: 0, timestamp: 1_000 }),
    makeFix({ segmentSeq: 0, timestamp: 4_000 }),
    makeFix({ segmentSeq: 1, timestamp: 9_000 }),
    makeFix({ segmentSeq: 1, timestamp: 6_000 }), // out of order on purpose
  ];

  test('windows a segment by the first and last timestamp of its own points', () => {
    const samples = toHealthSegmentSamples(
      [
        { seq: 0, distanceM: 120 },
        { seq: 1, distanceM: 300 },
      ],
      fixes,
    );
    expect(samples).toEqual([
      { startedAt: 1_000, endedAt: 4_000, meters: 120 },
      { startedAt: 6_000, endedAt: 9_000, meters: 300 },
    ]);
  });

  test('skips segments with no points, no distance, or zero distance', () => {
    const samples = toHealthSegmentSamples(
      [
        { seq: 0, distanceM: 120 },
        { seq: 1, distanceM: null },
        { seq: 2, distanceM: 50 }, // no fixes carry seq 2
        { seq: 3, distanceM: 0 },
      ],
      fixes,
    );
    expect(samples).toEqual([{ startedAt: 1_000, endedAt: 4_000, meters: 120 }]);
  });

  test('produces nothing for a run recorded without GPS', () => {
    expect(toHealthSegmentSamples([{ seq: 0, distanceM: null }], [])).toEqual([]);
  });
});

describe('toHealthWorkout', () => {
  const run = {
    startedAt: '2026-08-01T06:00:00.000Z',
    endedAt: '2026-08-01T06:30:00.000Z',
    distanceM: 4_200,
  };

  test('reports the run total, never the last segment (spec §5.3)', () => {
    const workout = toHealthWorkout(
      run,
      [
        { seq: 0, distanceM: 400 },
        { seq: 1, distanceM: 3_800 },
      ],
      [makeFix({ segmentSeq: 0, timestamp: 1_000 }), makeFix({ segmentSeq: 1, timestamp: 2_000 })],
    );
    expect(workout.totalDistanceM).toBe(4_200);
    expect(workout.segmentSamples).toHaveLength(2);
  });

  test('converts the stored ISO timestamps to epoch ms', () => {
    const workout = toHealthWorkout(run, [], []);
    expect(workout.startedAt).toBe(Date.parse('2026-08-01T06:00:00.000Z'));
    expect(workout.endedAt).toBe(Date.parse('2026-08-01T06:30:00.000Z'));
  });

  test('a GPS-less run still yields a workout, with no route and no distance', () => {
    const workout = toHealthWorkout({ ...run, distanceM: null }, [{ seq: 0, distanceM: null }], []);
    expect(workout.totalDistanceM).toBeNull();
    expect(workout.route).toEqual([]);
    expect(workout.segmentSamples).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/domain/health.test.ts`
Expected: FAIL — `toHealthSegmentSamples` / `toHealthWorkout` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/domain/health.ts`:

```ts
/** One interval's distance over its true wall-clock window. */
export interface HealthDistanceSample {
  startedAt: number;
  endedAt: number;
  meters: number;
}

/** The stored run fields Health needs; `startedAt`/`endedAt` are ISO-8601 UTC as persisted. */
export interface HealthRunInput {
  startedAt: string;
  endedAt: string;
  distanceM: number | null;
}

export interface HealthSegmentInput {
  seq: number;
  distanceM: number | null;
}

/** The platform-neutral payload crossing the HealthAdapter port (ADR 0011 §1). */
export interface HealthWorkoutInput {
  startedAt: number;
  endedAt: number;
  totalDistanceM: number | null;
  segmentSamples: HealthDistanceSample[];
  route: HealthRoutePoint[];
}

/**
 * why windows come from the fixes and not from `actual_duration_s`: segment durations exclude
 * paused time, so prefix-summing them would date every sample after a pause wrongly. A segment's
 * own points carry the true wall clock (spec §5.2).
 */
export function toHealthSegmentSamples(
  segments: readonly HealthSegmentInput[],
  fixes: readonly SegmentedFix[],
): HealthDistanceSample[] {
  const windows = new Map<number, { first: number; last: number }>();
  for (const fix of fixes) {
    const window = windows.get(fix.segmentSeq);
    if (window) {
      window.first = Math.min(window.first, fix.timestamp);
      window.last = Math.max(window.last, fix.timestamp);
    } else {
      windows.set(fix.segmentSeq, { first: fix.timestamp, last: fix.timestamp });
    }
  }

  const samples: HealthDistanceSample[] = [];
  for (const segment of segments) {
    const window = windows.get(segment.seq);
    // Falsy covers both null (GPS off) and 0 (measured nothing) — neither is worth a sample.
    if (!window || !segment.distanceM) continue;
    samples.push({ startedAt: window.first, endedAt: window.last, meters: segment.distanceM });
  }
  return samples;
}

export function toHealthWorkout(
  run: HealthRunInput,
  segments: readonly HealthSegmentInput[],
  fixes: readonly SegmentedFix[],
): HealthWorkoutInput {
  return {
    startedAt: Date.parse(run.startedAt),
    endedAt: Date.parse(run.endedAt),
    totalDistanceM: run.distanceM,
    segmentSamples: toHealthSegmentSamples(segments, fixes),
    route: toHealthRoute(fixes),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/domain/health.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Gate and commit**

```bash
bun run lint && bun run typecheck && bun test
git add src/domain/health.ts src/domain/health.test.ts
git commit -m "feat: build the Health workout payload from stored runs and fixes"
```

---

### Task 3: The persistence decorator

The trigger, and the reason the run engine needs no changes. Pure and injectable, so it is unit-tested without a DB or a native module.

**Files:**
- Create: `src/services/health/with-health-sync.ts`
- Test: `src/services/health/with-health-sync.test.ts`

**Interfaces:**
- Consumes: `RunLifecyclePersistence`, `CompletedRunRecord` (types only) from `@/services/run-engine/types`.
- Produces: `withHealthSync(base: RunLifecyclePersistence, sync: (runId: string) => void): RunLifecyclePersistence`.

**Note for the implementer:** import the persistence types with `import type` and take `sync` as a required parameter. A default that reaches for the real sync function would pull `expo-sqlite` into this module and break `bun test`, which has no RN runtime.

- [ ] **Step 1: Write the failing tests**

Create `src/services/health/with-health-sync.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import type { CompletedRunRecord, RunLifecyclePersistence } from '@/services/run-engine/types';
import { withHealthSync } from './with-health-sync';

const record: CompletedRunRecord = {
  sessionKey: 'w1d1',
  status: 'completed',
  startedAt: '2026-08-01T06:00:00.000Z',
  endedAt: '2026-08-01T06:30:00.000Z',
  activeDurationS: 1_800,
  segments: [],
};

function fakeBase(overrides: Partial<RunLifecyclePersistence> = {}): RunLifecyclePersistence {
  return {
    saveRun: async () => 'saved-id',
    startRun: async () => 'active-id',
    finalizeRun: async () => {},
    ...overrides,
  };
}

describe('withHealthSync', () => {
  test('syncs the id saveRun returned, and still returns it', async () => {
    const synced: string[] = [];
    const id = await withHealthSync(fakeBase(), (runId) => synced.push(runId)).saveRun(record);
    expect(id).toBe('saved-id');
    expect(synced).toEqual(['saved-id']);
  });

  test('syncs the finalized run', async () => {
    const synced: string[] = [];
    await withHealthSync(fakeBase(), (runId) => synced.push(runId)).finalizeRun('run-7', record);
    expect(synced).toEqual(['run-7']);
  });

  test('syncs only after the local write has committed (ADR 0011 §4)', async () => {
    const order: string[] = [];
    const base = fakeBase({
      finalizeRun: async () => {
        await Promise.resolve();
        order.push('local');
      },
    });
    await withHealthSync(base, () => order.push('health')).finalizeRun('run-7', record);
    expect(order).toEqual(['local', 'health']);
  });

  test('does not sync when the local write fails', async () => {
    const synced: string[] = [];
    const base = fakeBase({
      finalizeRun: async () => {
        throw new Error('disk full');
      },
    });
    const wrapped = withHealthSync(base, (runId) => synced.push(runId));
    await expect(wrapped.finalizeRun('run-7', record)).rejects.toThrow('disk full');
    expect(synced).toEqual([]);
  });

  test('does not sync an in-flight run opened by startRun', async () => {
    const synced: string[] = [];
    await withHealthSync(fakeBase(), (runId) => synced.push(runId)).startRun('w1d1', record.startedAt);
    expect(synced).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/services/health/with-health-sync.test.ts`
Expected: FAIL — `Cannot find module './with-health-sync'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/health/with-health-sync.ts`:

```ts
import type { CompletedRunRecord, RunLifecyclePersistence } from '@/services/run-engine/types';

/**
 * Fires the Health save after — never before — the local write commits (ADR 0011 §4), and only on a
 * run *finish*, which is what keeps "no backfill" true: a Log revisit goes through neither method.
 * Wrapping at the composition root leaves the engine unaware that Health exists.
 */
export function withHealthSync(
  base: RunLifecyclePersistence,
  sync: (runId: string) => void,
): RunLifecyclePersistence {
  return {
    startRun: (sessionKey, startedAtIso) => base.startRun(sessionKey, startedAtIso),

    async saveRun(record: CompletedRunRecord): Promise<string> {
      const runId = await base.saveRun(record);
      sync(runId);
      return runId;
    },

    async finalizeRun(runId: string, record: CompletedRunRecord): Promise<void> {
      await base.finalizeRun(runId, record);
      sync(runId);
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/services/health/with-health-sync.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Gate and commit**

```bash
bun run lint && bun run typecheck && bun test
git add src/services/health/with-health-sync.ts src/services/health/with-health-sync.test.ts
git commit -m "feat: add the post-finalize Health sync decorator"
```

---

### Task 4: Dependencies, config plugin, and the native rebuild gate

The only native change in this plan. Everything after it needs a **full** `e2e-refresh` rebuild — a JS-only repack into a pre-HealthKit `.app` would die at import, exactly as `expo-maps` did (AGENTS.md).

**Files:**
- Create: `plugins/with-healthkit-write-only.js`
- Modify: `app.json` (the `plugins` array), `package.json` (via `bun expo install`)

**Interfaces:**
- Consumes: nothing.
- Produces: the `@kingstinct/react-native-healthkit` module, importable from `adapter.ios.ts`; an Info.plist carrying `NSHealthUpdateUsageDescription` and **not** `NSHealthShareUsageDescription`; entitlements carrying `com.apple.developer.healthkit` and **not** `com.apple.developer.healthkit.background-delivery`.

- [ ] **Step 1: Install the dependencies at the pinned version**

```bash
export COREPACK_ENABLE_AUTO_PIN=0
bun expo install @kingstinct/react-native-healthkit@14.0.2 react-native-nitro-modules
```

Check `package.json` afterwards: `@kingstinct/react-native-healthkit` must read `14.0.2` exactly (no `^`, no `~` — spec §2 pins it). If corepack injected a `packageManager` field, delete it before committing.

- [ ] **Step 2: Write the write-only config plugin**

The library's plugin writes `NSHealthShareUsageDescription` unconditionally with no opt-out (`app.plugin.ts:44-47`); omitting it yields the default `"RunBro wants to read your health data"`. This app never reads.

Create `plugins/with-healthkit-write-only.js`:

```js
const { withInfoPlist } = require('expo/config-plugins');

/**
 * why: the HealthKit plugin writes NSHealthShareUsageDescription unconditionally and offers no way
 * to opt out, so a write-only app would ship a read-access purpose string it never uses — a false
 * claim in the binary, and an App Review question with no good answer (ADR 0011 §2, §6).
 * Must be listed AFTER the HealthKit plugin in app.json.
 */
module.exports = function withHealthKitWriteOnly(config) {
  return withInfoPlist(config, (cfg) => {
    delete cfg.modResults.NSHealthShareUsageDescription;
    return cfg;
  });
};
```

- [ ] **Step 3: Register both plugins in `app.json`**

Add to the `plugins` array, after `"expo-status-bar"`, in this order:

```jsonc
"./plugins/with-healthkit-write-only",
[
  "@kingstinct/react-native-healthkit",
  {
    "NSHealthUpdateUsageDescription": "Save your completed runs (duration, distance, route) to Apple Health.",
    "background": false
  }
]
```

The local plugin must come **first**: `@expo/config-plugins` mods chain so each
plugin's own mutation runs before it delegates to the mod registered before it
in the array, which means the earlier-registered plugin's effect is the one
that survives last. The local plugin deletes `NSHealthShareUsageDescription`
*after* the library's own `withInfoPlist` mod has written it, so it has to be
the earlier-registered (first-listed) plugin to win.

`background: false` is load-bearing: it suppresses both the background-delivery entitlement and an AppDelegate modification (spec §3.3).

- [ ] **Step 4: Regenerate the native project**

```bash
export COREPACK_ENABLE_AUTO_PIN=0
bun run prebuild:dev
```

- [ ] **Step 5: Verify the generated native config**

```bash
grep -c NSHealthUpdateUsageDescription ios/RunBrodev/Info.plist       # expect 1
grep -c NSHealthShareUsageDescription ios/RunBrodev/Info.plist        # expect 0
grep -c 'com.apple.developer.healthkit<' ios/RunBrodev/RunBrodev.entitlements   # expect 1
grep -c 'background-delivery' ios/RunBrodev/RunBrodev.entitlements       # expect 0
grep -ci healthkit ios/RunBrodev/AppDelegate.swift                    # expect 0
```

(Paths use the dev-variant target name, `RunBrodev` — ADR 0019.)

All five must match. If the Share description is still present, the local plugin is listed after the library's instead of before.

- [ ] **Step 6: Build and confirm the app still launches**

```bash
bun run start
```

Expected: the dev client builds, installs and reaches the plan list. A Nitro linking failure surfaces here, not later.

- [ ] **Step 7: Gate and commit**

```bash
bun run lint && bun run typecheck && bun test
bunx expo-doctor
git add package.json app.json plugins/with-healthkit-write-only.js
git commit -m "build: add HealthKit with write-only entitlements"
```

`bun.lock` is hook-guarded; commit it separately only if the hook permits, otherwise leave it to the maintainer.

---

### Task 5: The HealthAdapter port and its iOS adapter

The only file in the app allowed to import the library.

**Files:**
- Create: `src/services/health/port.ts`, `src/services/health/adapter.ios.ts`
- Test: none — this is the native boundary; correctness is proven by Task 11's simulator run.

**Interfaces:**
- Consumes: `HealthWorkoutInput` from `@/domain/health`.
- Produces: `type HealthAuthorization = 'authorized' | 'denied' | 'notDetermined' | 'unavailable'`, `interface HealthAdapter`, and `healthAdapter: HealthAdapter`.

- [ ] **Step 1: Write the port**

Create `src/services/health/port.ts`:

```ts
import type { HealthWorkoutInput } from '@/domain/health';

/** Write-access state for the workout type. `unavailable` means the device has no HealthKit. */
export type HealthAuthorization = 'authorized' | 'denied' | 'notDetermined' | 'unavailable';

/**
 * Apple Health writes (ADR 0011). Write-only by construction: no member reads health data, and
 * callers never see HealthKit types. Denial degrades silently — nothing is written, nothing throws.
 */
export interface HealthAdapter {
  isAvailable(): boolean;
  /** Synchronous, because the underlying HealthKit call is. */
  getAuthorization(): HealthAuthorization;
  /** Prompts when still undetermined, then reports the status iOS actually recorded. */
  requestWriteAccess(): Promise<HealthAuthorization>;
  saveRun(input: HealthWorkoutInput): Promise<void>;
}
```

- [ ] **Step 2: Write the iOS adapter**

Create `src/services/health/adapter.ios.ts`:

```ts
import {
  AuthorizationStatus,
  authorizationStatusFor,
  isHealthDataAvailable,
  requestAuthorization,
  saveWorkoutSample,
} from '@kingstinct/react-native-healthkit';

import type { HealthWorkoutInput } from '@/domain/health';
import type { HealthAdapter, HealthAuthorization } from './port';

const WORKOUT_TYPE = 'HKWorkoutTypeIdentifier';
const ROUTE_TYPE = 'HKWorkoutRouteTypeIdentifier';
const DISTANCE_TYPE = 'HKQuantityTypeIdentifierDistanceWalkingRunning';

function currentAuthorization(): HealthAuthorization {
  if (!isHealthDataAvailable()) return 'unavailable';
  switch (authorizationStatusFor(WORKOUT_TYPE)) {
    case AuthorizationStatus.sharingAuthorized:
      return 'authorized';
    case AuthorizationStatus.sharingDenied:
      return 'denied';
    default:
      return 'notDetermined';
  }
}

export const healthAdapter: HealthAdapter = {
  isAvailable: () => isHealthDataAvailable(),
  getAuthorization: currentAuthorization,

  async requestWriteAccess(): Promise<HealthAuthorization> {
    if (!isHealthDataAvailable()) return 'unavailable';
    // why re-read instead of using the resolved boolean: it reports that the prompt completed, not
    // that the user granted — only authorizationStatusFor carries the answer for share types.
    await requestAuthorization({ toShare: [WORKOUT_TYPE, ROUTE_TYPE, DISTANCE_TYPE] });
    return currentAuthorization();
  },

  async saveRun(input: HealthWorkoutInput): Promise<void> {
    const workout = await saveWorkoutSample(
      'HKWorkoutActivityTypeRunning',
      input.segmentSamples.map((sample) => ({
        startDate: new Date(sample.startedAt),
        endDate: new Date(sample.endedAt),
        quantityType: DISTANCE_TYPE,
        quantity: sample.meters,
        unit: 'm',
      })),
      new Date(input.startedAt),
      new Date(input.endedAt),
      // why totals is never dropped while samples are passed: the library assigns totalDistance from
      // every metre-compatible sample in turn (WorkoutsModule.swift:116-117), so without this the
      // workout total silently becomes the LAST segment's distance. totals overrides it (:137-141).
      input.totalDistanceM != null ? { distance: input.totalDistanceM } : undefined,
    );

    if (input.route.length > 0) {
      await workout.saveWorkoutRoute(
        input.route.map((point) => ({
          latitude: point.latitude,
          longitude: point.longitude,
          date: new Date(point.timestamp),
          altitude: point.altitude,
          course: point.course,
          speed: point.speed,
          horizontalAccuracy: point.horizontalAccuracy,
          verticalAccuracy: point.verticalAccuracy,
        })),
      );
    }
  },
};
```

If `'HKWorkoutActivityTypeRunning'` does not typecheck, read the `WorkoutActivityType` union in `node_modules/@kingstinct/react-native-healthkit/src/types/Workouts.ts` and use the running member verbatim. Do **not** guess, and do **not** consult Context7.

- [ ] **Step 3: Verify it compiles**

Run: `bun run typecheck`
Expected: PASS. A failure here is a real signature mismatch — re-read spec §3 rather than adjusting the port.

- [ ] **Step 4: Gate and commit**

```bash
bun run lint && bun run typecheck && bun test
git add src/services/health/port.ts src/services/health/adapter.ios.ts
git commit -m "feat: add the HealthAdapter port and its HealthKit adapter"
```

---

### Task 6: The sync service and composition wiring

Joins the pure mapper, the adapter and the decorator into a working auto-save.

**Files:**
- Create: `src/services/health/sync.ts`, `src/services/health/index.ts`
- Modify: `src/services/run-engine/index.ts` (imports at `:3-13`, engine construction at `:17-22`)

**Interfaces:**
- Consumes: `toHealthWorkout`, `healthAdapter`, `withHealthSync`, `loadRunFixes` from `@/db/run-points`, `runs`/`runSegments` from `@/db/schema`.
- Produces: `syncRunToHealth(runId: string): Promise<boolean>` — resolves `true` only when a workout was written. Never throws.

- [ ] **Step 1: Write the sync service**

Create `src/services/health/sync.ts`:

```ts
import { asc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { loadRunFixes } from '@/db/run-points';
import { runSegments, runs } from '@/db/schema';
import { toHealthWorkout } from '@/domain/health';
import { healthAdapter } from './adapter';

// why: the auto-save and a summary button tap can target the same run at once, and HealthKit would
// happily write the workout twice.
const inFlight = new Set<string>();

/**
 * Writes a finalized run to Apple Health and records it locally. Never throws and never blocks a
 * run: the local save has already committed by the time this runs (ADR 0011 §4). `false` means
 * nothing was written — not authorized, already saved, or the save failed.
 */
export async function syncRunToHealth(runId: string): Promise<boolean> {
  if (inFlight.has(runId)) return false;
  if (healthAdapter.getAuthorization() !== 'authorized') return false;

  inFlight.add(runId);
  try {
    const run = db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run || run.status === 'active' || run.healthkitSaved) return false;

    const segments = db
      .select()
      .from(runSegments)
      .where(eq(runSegments.runId, runId))
      .orderBy(asc(runSegments.seq))
      .all();

    await healthAdapter.saveRun(toHealthWorkout(run, segments, loadRunFixes(runId)));

    db.update(runs)
      .set({ healthkitSaved: true, updatedAt: new Date().toISOString() })
      .where(eq(runs.id, runId))
      .run();
    return true;
  } catch (error) {
    console.warn('[health] save failed', error);
    return false;
  } finally {
    inFlight.delete(runId);
  }
}
```

- [ ] **Step 2: Write the module barrel**

Create `src/services/health/index.ts`:

```ts
export type { HealthAdapter, HealthAuthorization } from './port';

// No composition wrapper (as in location-tracker): Health has no cross-platform policy seam — the
// gating that would live here is HealthKit's own authorization, which the adapter reports.
export { healthAdapter } from './adapter';
export { syncRunToHealth } from './sync';
export { withHealthSync } from './with-health-sync';
```

- [ ] **Step 3: Wire the decorator at the composition root**

In `src/services/run-engine/index.ts`, add to the imports:

```ts
import { syncRunToHealth, withHealthSync } from '@/services/health';
```

and change the engine construction (currently lines 17-22) to:

```ts
export const runEngine = new RunEngine({
  persistence: withHealthSync(dbRunPersistence, (runId) => void syncRunToHealth(runId)),
  cue: cueService,
  runStore: dbRunStore,
  tracker: locationTracker,
});
```

- [ ] **Step 4: Verify nothing regressed**

Run: `bun run typecheck && bun test`
Expected: PASS — in particular the existing `src/services/run-engine/engine.test.ts` and `resumable.test.ts` suites, which must be untouched by this change.

- [ ] **Step 5: Gate and commit**

```bash
bun run lint && bun run typecheck && bun test
git add src/services/health/sync.ts src/services/health/index.ts src/services/run-engine/index.ts
git commit -m "feat: save finalized runs to Apple Health"
```

---

### Task 7: Authorization hook and the Settings section

**Files:**
- Create: `src/services/health/use-health-authorization.ts`
- Modify: `src/services/health/index.ts` (export the hook), `src/app/(tabs)/settings/index.tsx`

**Interfaces:**
- Consumes: `healthAdapter`, `HealthAuthorization`.
- Produces: `useHealthAuthorization(): HealthAuthorization`.

**Do not add a button to the Location row's `granted` state.** `.maestro/tests/location-primer-allow.yaml` asserts `assertNotVisible: "Open Settings"` there on purpose — a granted permission has nothing to fix. The Health row follows the same rule.

- [ ] **Step 1: Write the hook**

Create `src/services/health/use-health-authorization.ts`:

```ts
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { healthAdapter } from './adapter';
import type { HealthAuthorization } from './port';

/** Write-access status, re-read whenever the app returns to the foreground. */
export function useHealthAuthorization(): HealthAuthorization {
  const [status, setStatus] = useState<HealthAuthorization>(() => healthAdapter.getAuthorization());

  useEffect(() => {
    // why AppState: this is changed in the Health app, which suspends us rather than remounting the
    // screen — foregrounding is the only signal the answer may differ (as in useLocationPermission).
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setStatus(healthAdapter.getAuthorization());
    });
    return () => subscription.remove();
  }, []);

  return status;
}
```

Add to `src/services/health/index.ts`:

```ts
export { useHealthAuthorization } from './use-health-authorization';
```

- [ ] **Step 2: Add the Settings section**

In `src/app/(tabs)/settings/index.tsx`, add to the imports:

```ts
import {
  healthAdapter,
  useHealthAuthorization,
  type HealthAuthorization,
} from '@/services/health';
```

Add the label map beside the existing `LOCATION_ACCESS`:

```ts
// Values deliberately share no suffix with LOCATION_ACCESS: both rows are labelled "Access", and
// ADR 0016 flows match the merged LabeledContent element by its value suffix.
const HEALTH_ACCESS: Record<HealthAuthorization, string> = {
  authorized: 'Saving Workouts',
  denied: 'Off',
  notDetermined: 'Not Set Up',
  unavailable: 'Not Available',
};
```

Read it in the component, next to `const location = useLocationPermission();`:

```ts
const health = useHealthAuthorization();
```

Insert this `Section` between the Location and About sections:

```tsx
{/* No toggle: iOS never lets an app revoke its own HealthKit grant, so a switch that
    can be turned off but not back on would be a lie (spec §2). */}
<Section
  title="Apple Health"
  footer={
    <Text>
      {health === 'authorized'
        ? 'Finished runs are saved to Apple Health with their route. Older runs can be saved one at a time from their summary.'
        : 'Save your finished runs to Apple Health, with distance and route. Nothing is ever read from Health.'}
    </Text>
  }
>
  <LabeledContent label="Access">
    <Text>{HEALTH_ACCESS[health]}</Text>
  </LabeledContent>
  {health === 'notDetermined' ? (
    <Button
      label="Set Up Apple Health"
      onPress={() => void healthAdapter.requestWriteAccess()}
    />
  ) : null}
  {health === 'denied' ? <Button label="Open Health" onPress={() => void openHealthApp()} /> : null}
</Section>
```

- [ ] **Step 3: Add the deep-link helper**

There is no public deep link to Health's per-app data-access page (spec §7.2). Add to `src/services/health/index.ts`:

```ts
export { openHealthApp } from './open-health-app';
```

Create `src/services/health/open-health-app.ts`:

```ts
import * as Linking from 'expo-linking';

/**
 * why the fallback: HealthKit permissions live in the Health app, not in the app's own Settings
 * pane, and Apple publishes no deep link to the per-app data-access page. The undocumented scheme
 * is tried first because it lands closer; openSettings() is the public API that always resolves.
 * Which one actually lands is resolved on the simulator — see the plan's Task 11.
 */
export async function openHealthApp(): Promise<void> {
  try {
    await Linking.openURL('x-apple-health://');
  } catch {
    await Linking.openSettings();
  }
}
```

Import it in the settings screen alongside the other Health imports.

- [ ] **Step 4: Verify on the simulator**

Load the `verify` skill. Launch the app, open Settings, and confirm the Apple Health section reads `Access — Not Set Up` with a **Set Up Apple Health** button, and that the Location section is unchanged.

- [ ] **Step 5: Gate and commit**

```bash
bun run lint && bun run typecheck && bun test
git add src/services/health/use-health-authorization.ts src/services/health/open-health-app.ts \
        src/services/health/index.ts "src/app/(tabs)/settings/index.tsx"
git commit -m "feat: report Apple Health access in Settings"
```

---

### Task 8: The run summary's Health row

**Files:**
- Create: `src/components/health-status-row.tsx`
- Modify: `src/app/runs/[runId]/index.tsx:1-16` (import) and `:72-80` (composition)

**Interfaces:**
- Consumes: `Run` from `@/db/schema`, `syncRunToHealth`, `healthAdapter`, `useHealthAuthorization`, `Card`, `Text`, `Island`.
- Produces: `<HealthStatusRow run={run} />`.

**Two constraints worth knowing before you write it.** The button must be an `Island.Button`, not an RN `Pressable`: a plain RN sibling under a SwiftUI host gets painted but stays out of the accessibility tree, which is what broke the summary's old "Done" button. And the summary screen already live-queries `runs`, so a successful save flips this row on its own — do not mirror `healthkitSaved` into local state.

- [ ] **Step 1: Write the component**

Create `src/components/health-status-row.tsx`:

```tsx
import { useState } from 'react';
import { View } from 'react-native';

import { Island } from '@/components/island';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { Run } from '@/db/schema';
import { healthAdapter, syncRunToHealth, useHealthAuthorization } from '@/services/health';

/**
 * The run summary's Apple Health row (ADR 0013 domain component). One button serves both the
 * fresh-finish retry and the deliberate push of an older run — the auto-save fires only on a run's
 * finish, so a revisited run is never backfilled behind the user's back (spec §2, §7.1).
 */
export function HealthStatusRow({ run }: { run: Run }) {
  const authorization = useHealthAuthorization();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  if (run.healthkitSaved) {
    return (
      <Card surface="card">
        <Text tone="secondary">Saved to Apple Health</Text>
      </Card>
    );
  }

  // Denied and unavailable offer no action here; Settings owns the route to change that.
  if (authorization === 'denied' || authorization === 'unavailable') return null;

  const save = async () => {
    setSaving(true);
    setFailed(false);
    const granted =
      authorization === 'notDetermined'
        ? await healthAdapter.requestWriteAccess()
        : authorization;
    // A denial at the prompt is an answer, not a failure — leave the row quiet.
    if (granted === 'authorized') setFailed(!(await syncRunToHealth(run.id)));
    setSaving(false);
  };

  return (
    <Card surface="card">
      <View className="gap-3">
        {failed ? <Text tone="secondary">Couldn&rsquo;t save to Apple Health.</Text> : null}
        <Island.Button
          fill
          label={saving ? 'Saving…' : 'Save to Apple Health'}
          onPress={() => void save()}
        />
      </View>
    </Card>
  );
}
```

- [ ] **Step 2: Compose it into the summary**

In `src/app/runs/[runId]/index.tsx`, add the import:

```ts
import { HealthStatusRow } from '@/components/health-status-row';
```

and add it as the last child inside the `loaded && run` block, after `<SegmentSplits segments={segments} />`:

```tsx
<HealthStatusRow run={run} />
```

- [ ] **Step 3: Verify on the simulator**

Load the `verify` skill. With the compressed plan on, complete a session and confirm the summary ends with a **Save to Apple Health** button, and that the button is reachable (tappable), not merely painted.

- [ ] **Step 4: Gate and commit**

```bash
bun run lint && bun run typecheck && bun test
git add src/components/health-status-row.tsx "src/app/runs/[runId]/index.tsx"
git commit -m "feat: offer an Apple Health save on the run summary"
```

---

### Task 9: The onboarding primer, and repairing the flows it breaks

**Adding a fourth step breaks three existing E2E flows the moment it exists** — `helpers/complete-onboarding.yaml`, `tests/location-primer-allow.yaml` and `tests/location-primer-deny.yaml` all assert the plan list (`"Week 1 ·.*"`) immediately after answering the location primer, which will now be the Health primer instead. Ship the repairs in this same commit.

**Files:**
- Create: `src/app/onboarding/health.tsx`
- Modify: `src/services/onboarding.ts:9-13`, `.maestro/helpers/complete-onboarding.yaml`, `.maestro/tests/location-primer-allow.yaml`, `.maestro/tests/location-primer-deny.yaml`, `.maestro/tests/onboarding.yaml`

**Interfaces:**
- Consumes: `OnboardingStepScreen`, `FeatureRow`, `Text`, `healthAdapter`, `completeAndAdvance`.
- Produces: the step id `'health-primer-v1'` at route `/onboarding/health`; the screen heading **"Your runs, in Apple Health"** — the anchor every flow keys on.

- [ ] **Step 1: Register the step**

In `src/services/onboarding.ts`, append to `ONBOARDING_STEPS` (order matters — it is the flow order, and appending is what makes existing users see only this step):

```ts
{ id: 'health-primer-v1', route: '/onboarding/health' },
```

- [ ] **Step 2: Write the primer screen**

Create `src/app/onboarding/health.tsx`:

```tsx
import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { FeatureRow } from '@/components/feature-row';
import { OnboardingStepScreen } from '@/components/onboarding-step-screen';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { healthAdapter } from '@/services/health';

export default function HealthPrimerScreen() {
  const colors = useTheme();
  return (
    <OnboardingStepScreen
      stepId="health-primer-v1"
      buttonLabel="Connect Apple Health"
      secondaryLabel="Not Now"
      onPrimaryPress={async (advance) => {
        try {
          await healthAdapter.requestWriteAccess();
        } catch (error) {
          console.warn('[onboarding] health prompt failed', error);
        }
        // A denial advances exactly like "Not Now" — Health is optional (ADR 0011 §4).
        advance();
      }}
      footnote={
        <Text variant="footnote" tone="secondary">
          Not Now is fine &mdash; your runs are saved here either way. You can turn this on later in
          Settings.
        </Text>
      }
    >
      <View className="items-center">
        <SymbolView
          name={{ ios: 'heart.fill', android: 'favorite' }}
          size={64}
          tintColor={colors.primary}
        />
      </View>
      <View className="pt-10">
        <Text variant="title1" accessibilityRole="header">
          Your runs, in Apple Health
        </Text>
      </View>
      <View className="gap-5 pt-5">
        <FeatureRow
          symbol={{ ios: 'figure.run', android: 'directions_run' }}
          title="Every run counts"
          template="primer"
        >
          Finished runs appear in Apple Health as workouts, with their distance and the route you
          ran.
        </FeatureRow>
        <FeatureRow
          symbol={{ ios: 'square.and.arrow.up', android: 'ios_share' }}
          title="Works with your other apps"
          template="primer"
        >
          Anything that reads Apple Health &mdash; your rings, other fitness apps &mdash; picks your
          runs up automatically.
        </FeatureRow>
        <FeatureRow
          symbol={{ ios: 'arrow.up.forward', android: 'arrow_outward' }}
          title="Only ever writes"
          template="primer"
        >
          RunBro adds your runs to Health and reads nothing back. Not your steps, not your heart
          rate, nothing.
        </FeatureRow>
      </View>
    </OnboardingStepScreen>
  );
}
```

`onPrimaryPress` receives `advance` and owns advancing — see `OnboardingStepScreen`'s contract and the location primer, which uses `completeAndAdvance` directly; either shape works, but `advance()` is the one the scaffold passes in.

- [ ] **Step 3: Repair `helpers/complete-onboarding.yaml`**

Replace the closing block so the helper dismisses **both** primers. Update the leading comment from "all three onboarding steps" to "all four onboarding steps":

```yaml
- runFlow: onboarding-to-primer.yaml
- retry:
    maxRetries: 3
    commands:
      - tapOn: "Not Now"
      - assertVisible: "Your runs, in Apple Health" # health primer follows the location primer
- retry:
    maxRetries: 3
    commands:
      - tapOn: "Not Now"
      - assertVisible: "Week 1 ·.*" # plan list
```

- [ ] **Step 4: Repair the two location-primer flows**

In **both** `.maestro/tests/location-primer-allow.yaml` and `.maestro/tests/location-primer-deny.yaml`, the block that currently taps `"Enable Location"` and asserts `"Week 1 ·.*"` must now land on the Health primer and dismiss it. Replace that `retry` block in each with:

```yaml
- retry:
    maxRetries: 3
    commands:
      - tapOn: "Enable Location"
      - assertVisible: "Your runs, in Apple Health" # the location answer advances to the next step
- retry:
    maxRetries: 3
    commands:
      - tapOn: "Not Now"
      - assertVisible: "Week 1 ·.*"
```

Keep each flow's existing trailing assertions (the Settings checks) exactly as they are.

- [ ] **Step 5: Extend `tests/onboarding.yaml`**

Add a fourth marker assertion after the location one, and change the comment from "none of the three steps" to "none of the four steps":

```yaml
- assertNotVisible: "Your runs, in Apple Health" # health-primer-marker
```

- [ ] **Step 6: Rebuild and run the onboarding suite**

Load the `e2e-refresh` skill. Task 4 changed the fingerprint, so **the first run must be a full rebuild, not a repack.** Then:

```bash
bun run e2e:onboarding
```

Expected: all onboarding-tagged flows pass. A failure naming `"Week 1"` means a flow still expects the plan list directly after the location primer.

- [ ] **Step 7: Gate and commit**

```bash
bun run lint && bun run typecheck && bun test
git add src/services/onboarding.ts src/app/onboarding/health.tsx .maestro/
git commit -m "feat: add the Apple Health onboarding primer"
```

---

### Task 10: E2E coverage for the Health surfaces

Bounded by what the harness can reach: `xcrun simctl privacy` has **no `health` service**, so the grant cannot be pre-seeded, and the authorization sheet belongs to `HealthPrivacyService.app`. **No flow may tap a CTA that raises the system Health sheet** — it would hang. This mirrors ADR 0001's reasoning for dropping the GPS-motion flow.

**Files:**
- Create: `.maestro/tests/health-primer-skip.yaml`

**Interfaces:**
- Consumes: `helpers/onboarding-to-primer.yaml`, the heading `"Your runs, in Apple Health"`, the Settings value `"Not Set Up"`.
- Produces: no new helpers.

- [ ] **Step 1: Write the flow**

Create `.maestro/tests/health-primer-skip.yaml`:

```yaml
appId: se.lukaslindqvist.runbro.e2e
tags:
  - onboarding
---
# The health primer's "Not Now" path, and the Settings row that reports it. The "Connect Apple
# Health" CTA is deliberately never tapped: simctl cannot pre-seed a HealthKit answer and the
# authorization sheet belongs to another process, so the flow would hang on it (spec §9).
- launchApp:
    clearState: true
    permissions:
      location: inuse
- runFlow: ../helpers/onboarding-to-primer.yaml
- retry:
    maxRetries: 3
    commands:
      - tapOn: "Enable Location"
      - assertVisible: "Your runs, in Apple Health"
- assertVisible: "Connect Apple Health"
- retry:
    maxRetries: 3
    commands:
      - tapOn: "Not Now"
      - assertVisible: "Week 1 ·.*" # skipping advances into the app
- tapOn: "Settings"
# LabeledContent merges label and value into one element ("Access, <value>"), so match the value as
# a suffix — Maestro anchors text as a full match (ADR 0016).
- scrollUntilVisible:
    element:
      text: ".*Not Set Up"
- assertVisible: "Set Up Apple Health"
```

- [ ] **Step 2: Run it**

```bash
maestro test .maestro/tests/health-primer-skip.yaml
```

Expected: PASS. Stop Argent's simulator servers first (`stop-all-simulator-servers`) — two automation servers cannot own one simulator.

- [ ] **Step 3: Run the full onboarding and session tags for regressions**

```bash
bun run e2e:onboarding && bun run e2e:session
```

Expected: PASS. The summary gained a row in Task 8; if a session flow fails on a scroll target, adjust that flow's `scrollUntilVisible`, not the component.

- [ ] **Step 4: Commit**

```bash
git add .maestro/tests/health-primer-skip.yaml
git commit -m "test: cover the Apple Health primer skip path"
```

---

### Task 11: Simulator verification and resolving the deep link

The one task that proves the feature actually works — everything before it is structure. `Health.app` and `HealthKit.framework` ship in the iOS 26.5 runtime, so no device is needed.

**Files:** none (verification only, plus a possible one-line change to `open-health-app.ts`).

- [ ] **Step 1: Grant and save a run end to end**

Load the `verify` skill. Then, on a booted iOS 26.5 simulator with the dev client:

1. Reset onboarding (Settings → Developer → Reset Onboarding), advance to the Health primer, tap **Connect Apple Health**, and allow every category in the sheet.
2. Confirm Settings now reads `Access — Saving Workouts` with no button.
3. With the compressed plan on, complete a session.
4. Open the **Health** app → Browse → Activity → Workouts and confirm the run is there as a **Running** workout with the right duration.

- [ ] **Step 2: Confirm the route and the distance total**

Open the workout in Health. Confirm a map/route is attached, and that the workout's total distance matches the app's summary — **not** the last segment's distance. This is the live check on the `totals` invariant (spec §5.3); if the total looks suspiciously small, the adapter dropped `totals`.

- [ ] **Step 3: Confirm the summary row flipped**

Back in the app, the just-finished run's summary must read **Saved to Apple Health** with no button. Open an older run from the Log: it must still offer the button (no backfill), and tapping it must move that run into Health too.

- [ ] **Step 4: Resolve the deep link**

With authorization denied (a fresh install, deny at the sheet), tap **Open Health** in Settings and record what actually happens:

- If `x-apple-health://` opens the Health app, keep `open-health-app.ts` as written.
- If it fails and `Linking.openSettings()` lands somewhere useful, drop the first branch and call `openSettings()` directly.
- If neither reaches anything useful, replace the button with plain instructions in the section footer ("Open Health → Sharing → Apps → RunBro") and delete `open-health-app.ts`. A button that goes nowhere is worse than a sentence.

Record the outcome in the commit message.

- [ ] **Step 5: Confirm the denied path stays quiet**

With authorization denied, complete a session. The run must save locally as normal, and its summary must show **no** Health row at all.

- [ ] **Step 6: Commit any change from Step 4**

```bash
bun run lint && bun run typecheck && bun test
git add src/services/health/
git commit -m "fix: point the Apple Health settings button at <the destination that worked>"
```

If Step 4 required no change, skip the commit and note the verified behaviour in Task 12's doc commit.

---

### Task 12: Documentation fold-back

**Files:**
- Modify: `docs/adr/0011-apple-health-kingstinct-healthkit.md`, `docs/superpowers/specs/2026-07-11-c25k-app-design.md` (§9, §13), `AGENTS.md`, `docs/milestone-0-device-checklist.md`
- Create: `docs/privacy-policy.md`

- [ ] **Step 1: Amend ADR 0011**

Follow ADR 0010's amendment convention: mark the Status line `Accepted, **amended 2026-08-01** — see [Amendment (2026-08-01)](#amendment-2026-08-01)`, leave the dated 2026-07-11 Context as the record of what was believed then, and add an `## Amendment (2026-08-01)` section covering:

1. **`activeEnergyBurned` is dropped** from the write set — no heart rate, and write-only access cannot read body mass, so any kcal value would be fabricated (App Review 5.1.3).
2. **Apple's interval representation is blocked upstream, on `master` too.** `workoutEvents: nil` at `WorkoutsModule.swift:156,169,184`; `activities` is a read-only getter. **Owning a small native module therefore moves from "rejected" to the documented escape hatch** if this ever becomes worth the maintenance — the library has not moved in the direction the ADR hoped for.
3. **Two traps in the save path:** `totalDistance` is overwritten by each distance sample (`:116-117`) so `totals` is mandatory; per-sample metadata is discarded in favour of the workout's (`:133`), so segment kinds cannot be tagged.
4. **The plugin writes `NSHealthShareUsageDescription` unconditionally** (`app.plugin.ts:44-47`); a local config plugin strips it.
5. **The Settings toggle becomes a reporting row** — iOS never lets an app revoke its own grant.
6. **The retry lives on `runs/[runId]`**, resolving the "still open" note in spec §9.

- [ ] **Step 2: Amend the master spec**

In `docs/superpowers/specs/2026-07-11-c25k-app-design.md`:
- §9: drop `activeEnergyBurned` from the authorization list, replace the "still open / unbuilt" note on the retry with its shipped location, and record the duration-includes-pauses limitation.
- §13 Stage 5: split into the shipped Health slice and the deferred polish slice (glass/animations, empty states, week-9 graduation, icon/splash, App Review notes), so the roadmap does not read as complete.
- §8 Settings bullet: replace "Apple Health toggle (triggers authorization)" with the reporting row.

- [ ] **Step 3: Warn about the docs source in AGENTS.md**

Add to the "Skills & MCP — what to load when" docs-lookup bullet:

> **Exception — `@kingstinct/react-native-healthkit`:** do not use Context7 for it. Its pages are generated `_autodocs` that describe an API present in neither the release nor `master`. Verify against the tarball (`npm pack`) and see ADR 0011's 2026-08-01 amendment.

- [ ] **Step 4: Extend the device checklist**

Add to `docs/milestone-0-device-checklist.md`: a real outdoor run appears in Apple Health with a correct route and distance, and the deny-then-enable-later path works from Settings.

- [ ] **Step 5: Add the privacy policy placeholder**

App Review requires a reachable privacy-policy URL for any HealthKit app. This slice writes the text but does not host it. Create `docs/privacy-policy.md`:

```markdown
# RunBro — Privacy Policy

> **Placeholder — not yet hosted.** App Review requires this to be reachable at a
> public URL before submission, and that URL then has to be set in App Store
> Connect and linked from the app. Neither has been done: RunBro is not being
> submitted yet.

**Last updated:** 2026-08-01

## RunBro does not collect your data

RunBro has no backend, no accounts, and no analytics. Nothing you do in the app
is sent anywhere. There is no server to send it to.

## Where your data lives

Your runs — times, distances, and recorded GPS routes — are stored in a database
on your device. They are included in your iPhone's own iCloud backup, under your
Apple account and Apple's terms; RunBro has no access to that backup and no
account of its own.

Deleting the app deletes this data.

## Location

RunBro uses your location only while a run is in progress, to measure distance
and record your route, and only with "While Using the App" permission. Your
location never leaves your device.

## Apple Health

If you allow it, RunBro writes finished runs to Apple Health as workouts, with
their duration, distance, and route.

RunBro only ever **writes** to Apple Health. It requests no read access and
never reads your health data — not your steps, not your heart rate, nothing.
You can turn this off at any time in the Health app.

## Contact

Open an issue at https://github.com/lukaslindqvist/my-runner.
```

Correct the repository URL if it differs from the one in `git remote -v`.

- [ ] **Step 6: Commit**

```bash
git add docs/ AGENTS.md
git commit -m "docs: fold Stage 5 Apple Health findings back into the ADR and spec"
```

---

## Done when

- `bun run lint && bun run typecheck && bun test` pass.
- `bun run e2e:onboarding` and `bun run e2e:session` pass against a **freshly rebuilt** `e2e-simulator` app.
- A run completed on the simulator appears in Apple Health as a Running workout with its route, and its total distance matches the app.
- A run recorded before opt-in is not backfilled, but can be pushed from its summary.
- A denied run saves locally, shows no Health row, and never prompts.
- ADR 0011 and the master spec no longer describe anything this slice contradicts.
