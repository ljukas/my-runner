# Stage 1 — Interval-timer MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Couch-to-5K interval-timer app — browse the 9-week NHS plan, run a full session with pause/skip/end-early controls, land the result in History, and have progression advance — phone in hand, no sound/GPS/maps yet.

**Architecture:** Layered per the design spec §3: pure-TS `domain/` (plan data + timeline math), `db/` (expo-sqlite + Drizzle with generated migrations), `services/run-engine/` (wall-clock event-log state machine per ADR 0007, ports injected per ADR 0003), and expo-router screens where every modal surface is a router screen with native presentation (ADR 0006) and product screens are @expo/ui SwiftUI islands (ADR 0005).

**Tech Stack:** Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript ~6.0 · Bun (`bun test` for units) · expo-sqlite + Drizzle ORM · @expo/ui SwiftUI · Uniwind · Maestro (E2E).

## Global Constraints

Copied from AGENTS.md, the design spec (`docs/superpowers/specs/2026-07-11-c25k-app-design.md`), and ADRs 0001–0007. Every task's requirements implicitly include this section.

- **Do not rely on memorized Expo/RN APIs.** Verify against https://docs.expo.dev/versions/v57.0.0/ (Context7 MCP) or the installed `node_modules` source.
- **Bun only:** `bun install`, `bun expo install <pkg>` for anything Expo touches, `bun add`/`bun add -d` for pure-JS dev tooling, `bun test`, `bunx` for CLIs.
- **CNG:** never edit `ios/`/`android/`; everything via `app.json` + config plugins. No `app.json` changes are needed in Stage 1.
- **No backend, no accounts, no analytics; no web target.** iOS is the primary target — verify everything on the iOS simulator.
- **Official packages only** (Expo/vendor first-party). New deps in this stage: `expo-sqlite`, `expo-crypto`, `expo-keep-awake` (via `bun expo install`); `drizzle-orm` (`bun add`); `drizzle-kit`, `babel-plugin-inline-import`, `babel-preset-expo` (`bun add -d`).
- **Styling:** RN components use Uniwind `className` (tokens from `src/global.css`); SwiftUI islands take raw colors from the `Colors` mirror in `src/constants/theme.ts` — keep the two in sync. Never NativeWind, never StyleSheet for new RN styling (exception: raw color values where dynamic per-datum, per AGENTS.md).
- **One visual system per block** (ADR 0005): never alternate RN and SwiftUI text/controls within the same visual cluster.
- **Modal surfaces are router screens** (ADR 0006): formSheet uses explicit fractional detents (never `fitToContents`), flat content (no nested navigator/header inside sheets).
- **Reactivity rules** (ADR 0004): `useLiveQuery` only on `runs` (and `run_segments` for a fixed `run_id`); the query's top-level table is the only tracked table; no UI may depend on a live result set *becoming* empty; active-run UI reads the engine via `useSyncExternalStore`, never the DB.
- **Purity** (ADR 0003/0007): `src/domain/` and `src/services/run-engine/engine.ts` import nothing from React or Expo. The engine's time source is wall-clock `Date.now()` injected as a `Clock`; time is derived from the event log, never accumulated.
- **testID on every element an E2E flow taps or asserts** (ADR 0005 — on SwiftUI components `testID` maps to `accessibilityIdentifier`).
- **E2E:** Maestro flows live in `.maestro/` only; appId is `se.lukaslindqvist.myrunner`; author selectors from `inspect_screen`, not guesses (ADR 0001).
- **Conventional Commits** for every commit and the PR title (PRs are squash-merged).
- **Simulator verification:** any change affecting visible UI must be verified on the iOS simulator via the Argent MCP tools before it's considered done (AGENTS.md; load the `verify` skill / `.claude/rules/argent.md` routing). Where a task says "Verify on simulator", that means: app rebuilt/reloaded, screen driven with argent, expected state confirmed via `describe`/screenshot.
- **Build commands:** `bun run ios` starts Metro against the installed build; after adding a package with native code (`expo-sqlite`, `expo-crypto`, `expo-keep-awake`) rebuild once with `bun expo run:ios`. After creating `babel.config.js` or editing `metro.config.js`, restart Metro with `bun expo start --clear`.

## File structure (end state of Stage 1)

```
src/
├── app/
│   ├── _layout.tsx               # root Stack: migrations gate → onboarding gate → screens
│   ├── (tabs)/
│   │   ├── _layout.tsx           # NativeTabs: Plan · History · Settings (SF Symbols)
│   │   ├── index.tsx             # Plan tab (SwiftUI List, progression + free repeat)
│   │   ├── history.tsx           # History tab (SwiftUI List / empty state)
│   │   └── settings.tsx          # Settings tab (About + dev-only compressed-plan toggle)
│   ├── onboarding/
│   │   ├── _layout.tsx           # inner Stack for step routes
│   │   ├── index.tsx             # step 1: welcome
│   │   ├── how-it-works.tsx      # step 2: how C25K works
│   │   └── health-note.tsx       # step 3: doctor note
│   ├── session/[key].tsx         # pre-run detail — formSheet, detents [0.5, 0.95]
│   ├── run.tsx                   # active run — fullScreenModal, gestureEnabled: false
│   └── run-summary.tsx           # post-run — router.replace target from run.tsx
├── components/
│   ├── themed-text.tsx           # (existing, kept)
│   ├── themed-view.tsx           # (existing, kept)
│   └── segment-bar.tsx           # RN proportional segment bar (Uniwind + SegmentColors)
├── constants/theme.ts            # Colors (+ primary), SegmentColors — JS mirror of global.css
├── db/
│   ├── schema.ts                 # runs, run_segments (sync-agnostic columns per ADR 0004)
│   ├── client.ts                 # single openDatabaseSync connection + drizzle()
│   ├── save-run.ts               # RunPersistence adapter (expo-crypto UUIDs)
│   └── migrations/               # drizzle-kit output (.sql + migrations.js, committed)
├── domain/                       # PURE TypeScript — no React, no Expo
│   ├── plan.ts                   # 27 NHS sessions + compressed dev plan + helpers
│   ├── segments.ts               # timeline building + elapsed→segment derivation
│   └── format.ts                 # mm:ss clock, minutes label, session title
├── hooks/use-theme.ts            # (existing, kept)
└── services/
    ├── storage.ts                # StringStorage type (kv-store-shaped, fakeable)
    ├── settings.ts               # pure settings store factory
    ├── settings-store.ts         # kv-store singleton + useSetting hook
    ├── active-plan.ts            # NHS vs compressed plan selection (__DEV__-gated)
    ├── onboarding.ts             # versioned step framework (pure factory)
    ├── onboarding-store.ts       # kv-store singleton + completeAndAdvance
    └── run-engine/
        ├── types.ts              # events, snapshot, records, ports
        ├── engine.ts             # RunEngine state machine (pure)
        └── index.ts              # composition root: singleton + useRunEngine
.maestro/
├── config.yaml                   # top-level *.yaml are the test flows
├── helpers/complete-onboarding.yaml
├── helpers/enable-compressed-plan.yaml
├── 01-onboarding.yaml
├── 02-complete-session.yaml
└── 03-run-controls.yaml
```

Deliberately absent (spec §13 Stage 1): sound, GPS/distance, maps, Apple Health, crash resume (`active_run_snapshot`, `run_points` tables wait for Stage 3).

---

### Task 1: Architecture reset — starter code out, tab skeleton in

The app must boot to three empty tabs (Plan/History/Settings) with no create-expo-app demo code left.

**Files:**
- Delete: `src/app/index.tsx`, `src/app/explore.tsx`, `src/components/animated-icon.tsx`, `src/components/app-tabs.tsx`, `src/components/external-link.tsx`, `src/components/hint-row.tsx`, `src/components/ui/collapsible.tsx`
- Delete assets: `assets/images/tabIcons/` (whole dir), `assets/images/expo-logo.png`, `assets/images/logo-glow.png` (keep `icon.png`, `splash-icon.png`, android icons — referenced by `app.json`)
- Modify: `src/app/_layout.tsx`, `src/constants/theme.ts`
- Create: `src/app/(tabs)/_layout.tsx`, `src/app/(tabs)/index.tsx`, `src/app/(tabs)/history.tsx`, `src/app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: existing `ThemedText`/`ThemedView` (`@/components/themed-text`, `@/components/themed-view`), `useTheme` (`@/hooks/use-theme`).
- Produces: root Stack at `src/app/_layout.tsx` that later tasks extend with `Stack.Screen` entries; `Colors.light.primary`/`Colors.dark.primary` = `'#3c87f7'` used by every SwiftUI screen task.

- [ ] **Step 1: Delete the starter files**

```bash
git rm src/app/index.tsx src/app/explore.tsx \
  src/components/animated-icon.tsx src/components/app-tabs.tsx \
  src/components/external-link.tsx src/components/hint-row.tsx \
  src/components/ui/collapsible.tsx
git rm -r assets/images/tabIcons
git rm assets/images/expo-logo.png assets/images/logo-glow.png
```

- [ ] **Step 2: Trim `src/constants/theme.ts`**

Remove the now-unused `Fonts`, `Spacing`, `BottomTabInset`, `MaxContentWidth` exports (their only consumers were just deleted — confirm with `grep -rn "Fonts\|Spacing\|BottomTabInset\|MaxContentWidth" src`). Add `primary` to both schemes, mirroring `--color-primary` in `src/global.css`. Resulting file:

```ts
/**
 * JS mirror of the app theme. The main styling mechanism is Uniwind
 * (Tailwind classes via `className`); the theme tokens live in src/global.css.
 * `Colors` below mirrors those tokens for the places that need color values
 * in JS (`useTheme`, @expo/ui SwiftUI islands) — keep both in sync.
 */

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    primary: '#3c87f7',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    primary: '#3c87f7',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
```

- [ ] **Step 3: Replace `src/app/_layout.tsx` with a root Stack**

```tsx
import '@/global.css';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ThemeProvider>
  );
}
```

(The `AnimatedSplashOverlay` is gone — it animated the Expo logo. Task 4 replaces the `useEffect` splash-hide with the migrations gate.)

- [ ] **Step 4: Create `src/app/(tabs)/_layout.tsx`**

`NativeTabs.Trigger.Icon` takes an `sf` prop (verified: `expo-router/build/native-tabs/NativeTabsView.shared.d.ts` — `sf?: SFSymbol`).

```tsx
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const colors = useTheme();

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="figure.run" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.arrow.circlepath" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape.fill" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

- [ ] **Step 5: Create the three tab shells**

`src/app/(tabs)/index.tsx`:

```tsx
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function PlanScreen() {
  return (
    <ThemedView className="flex-1 items-center justify-center">
      <ThemedText type="title">Plan</ThemedText>
    </ThemedView>
  );
}
```

`src/app/(tabs)/history.tsx` — same shape with component `HistoryScreen` and text `History`.
`src/app/(tabs)/settings.tsx` — same shape with component `SettingsScreen` and text `Settings`.

- [ ] **Step 6: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both pass with no errors (lint may scaffold an ESLint config on first run — commit it if generated).

- [ ] **Step 7: Verify on simulator**

Run: `bun run ios` (if no build is installed on the simulator yet, run `bun expo run:ios` once instead). Verify with argent: three native tabs labeled Plan/History/Settings with SF-symbol icons; each tab shows its placeholder title; no red screen.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: reset architecture — remove starter app, add Plan/History/Settings tab skeleton"
```

---

### Task 2: Domain — NHS plan data + compressed dev plan

Pure-TS plan data (spec Appendix A) with integrity tests. This also wires up `bun test`.

**Files:**
- Create: `src/domain/plan.ts`
- Test: `src/domain/plan.test.ts`
- Modify: `package.json` (add `"test": "bun test"` to scripts)

**Interfaces:**
- Consumes: nothing (pure).
- Produces (exact signatures later tasks rely on):
  - `type SegmentKind = 'warmup' | 'run' | 'walk' | 'cooldown'`
  - `interface PlannedSegment { kind: SegmentKind; seconds: number }`
  - `interface PlanSession { key: string; week: number; day: number; segments: PlannedSegment[] }`
  - `const NHS_PLAN: PlanSession[]` (27 sessions, plan order), `const COMPRESSED_PLAN: PlanSession[]`
  - `getSession(plan: PlanSession[], key: string): PlanSession | undefined`
  - `sessionTotalSeconds(session: PlanSession): number`
  - `nextSessionKey(plan: PlanSession[], completedKeys: ReadonlySet<string>): string | null`
  - `parseSessionKey(key: string): { week: number; day: number } | null`

- [ ] **Step 1: Add the test script**

In `package.json` scripts add:

```json
"test": "bun test"
```

- [ ] **Step 2: Write the failing tests**

`src/domain/plan.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import {
  COMPRESSED_PLAN,
  NHS_PLAN,
  getSession,
  nextSessionKey,
  parseSessionKey,
  sessionTotalSeconds,
} from './plan';

// Run totals (seconds) from the design spec Appendix A.
const EXPECTED_RUN_SECONDS: Record<string, number> = {
  w1: 480, w2: 540, w3: 540, w4: 960,
  w5d1: 900, w5d2: 960, w5d3: 1200,
  w6d1: 1080, w6d2: 1200, w6d3: 1500,
  w7: 1500, w8: 1680, w9: 1800,
};

function runSeconds(key: string): number {
  return getSession(NHS_PLAN, key)!
    .segments.filter((s) => s.kind === 'run')
    .reduce((sum, s) => sum + s.seconds, 0);
}

describe('NHS_PLAN', () => {
  test('has 27 sessions with unique keys in plan order', () => {
    expect(NHS_PLAN).toHaveLength(27);
    const keys = NHS_PLAN.map((s) => s.key);
    expect(new Set(keys).size).toBe(27);
    const expected = [];
    for (let w = 1; w <= 9; w++) for (let d = 1; d <= 3; d++) expected.push(`w${w}d${d}`);
    expect(keys).toEqual(expected);
  });

  test('every session is bracketed by 5-min warmup and cooldown walks', () => {
    for (const s of NHS_PLAN) {
      expect(s.segments[0]).toEqual({ kind: 'warmup', seconds: 300 });
      expect(s.segments[s.segments.length - 1]).toEqual({ kind: 'cooldown', seconds: 300 });
      expect(s.segments.every((seg) => seg.seconds > 0)).toBe(true);
    }
  });

  test('run totals match the NHS plan table', () => {
    for (let d = 1; d <= 3; d++) {
      for (const w of [1, 2, 3, 4, 7, 8, 9]) {
        expect(runSeconds(`w${w}d${d}`)).toBe(EXPECTED_RUN_SECONDS[`w${w}`]);
      }
    }
    for (const key of ['w5d1', 'w5d2', 'w5d3', 'w6d1', 'w6d2', 'w6d3']) {
      expect(runSeconds(key)).toBe(EXPECTED_RUN_SECONDS[key]);
    }
  });

  test('weeks 1 and 2 end on a run before the cooldown', () => {
    for (const key of ['w1d1', 'w2d1']) {
      const segs = getSession(NHS_PLAN, key)!.segments;
      expect(segs[segs.length - 2].kind).toBe('run');
    }
  });

  test('W6R3 is the 25-minute continuous NHS run', () => {
    const segs = getSession(NHS_PLAN, 'w6d3')!.segments;
    expect(segs).toEqual([
      { kind: 'warmup', seconds: 300 },
      { kind: 'run', seconds: 1500 },
      { kind: 'cooldown', seconds: 300 },
    ]);
  });

  test('w1d1 totals 28.5 minutes', () => {
    // 300 warmup + 8×60 run + 7×90 walk + 300 cooldown (spec Appendix A)
    expect(sessionTotalSeconds(getSession(NHS_PLAN, 'w1d1')!)).toBe(1710);
  });
});

describe('COMPRESSED_PLAN', () => {
  test('mirrors NHS structure with seconds-long segments', () => {
    expect(COMPRESSED_PLAN).toHaveLength(27);
    for (let i = 0; i < 27; i++) {
      const nhs = NHS_PLAN[i];
      const dev = COMPRESSED_PLAN[i];
      expect(dev.key).toBe(nhs.key);
      expect(dev.segments.map((s) => s.kind)).toEqual(nhs.segments.map((s) => s.kind));
      for (let j = 0; j < dev.segments.length; j++) {
        expect(dev.segments[j].seconds).toBeGreaterThanOrEqual(2);
        expect(dev.segments[j].seconds).toBeLessThanOrEqual(nhs.segments[j].seconds);
      }
    }
  });

  test('compressed w1d1 finishes in well under a minute', () => {
    expect(sessionTotalSeconds(getSession(COMPRESSED_PLAN, 'w1d1')!)).toBeLessThanOrEqual(45);
  });
});

describe('progression', () => {
  test('nextSessionKey walks the plan in order and supports gaps', () => {
    expect(nextSessionKey(NHS_PLAN, new Set())).toBe('w1d1');
    expect(nextSessionKey(NHS_PLAN, new Set(['w1d1']))).toBe('w1d2');
    expect(nextSessionKey(NHS_PLAN, new Set(['w1d1', 'w1d3']))).toBe('w1d2');
    expect(nextSessionKey(NHS_PLAN, new Set(NHS_PLAN.map((s) => s.key)))).toBeNull();
  });

  test('parseSessionKey', () => {
    expect(parseSessionKey('w6d3')).toEqual({ week: 6, day: 3 });
    expect(parseSessionKey('nonsense')).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/domain/plan.test.ts`
Expected: FAIL — `Cannot find module './plan'`.

- [ ] **Step 4: Implement `src/domain/plan.ts`**

```ts
export type SegmentKind = 'warmup' | 'run' | 'walk' | 'cooldown';

export interface PlannedSegment {
  kind: SegmentKind;
  seconds: number;
}

export interface PlanSession {
  key: string;
  week: number;
  day: number;
  segments: PlannedSegment[];
}

const warmup: PlannedSegment = { kind: 'warmup', seconds: 300 };
const cooldown: PlannedSegment = { kind: 'cooldown', seconds: 300 };
const run = (seconds: number): PlannedSegment => ({ kind: 'run', seconds });
const walk = (seconds: number): PlannedSegment => ({ kind: 'walk', seconds });

/** `count` runs with walks between them — ends on a run. */
function alternate(count: number, runSeconds: number, walkSeconds: number): PlannedSegment[] {
  const out: PlannedSegment[] = [];
  for (let i = 0; i < count; i++) {
    out.push(run(runSeconds));
    if (i < count - 1) out.push(walk(walkSeconds));
  }
  return out;
}

function session(week: number, day: number, intervals: PlannedSegment[]): PlanSession {
  return { key: `w${week}d${day}`, week, day, segments: [warmup, ...intervals, cooldown] };
}

/** Three identical days sharing one interval structure. */
function week(weekNo: number, intervals: PlannedSegment[]): PlanSession[] {
  return [1, 2, 3].map((day) => session(weekNo, day, intervals));
}

/** The classic 9-week NHS Couch-to-5K plan (design spec Appendix A). */
export const NHS_PLAN: PlanSession[] = [
  ...week(1, alternate(8, 60, 90)),
  ...week(2, alternate(6, 90, 120)),
  ...week(3, [run(90), walk(90), run(180), walk(180), run(90), walk(90), run(180), walk(180)]),
  ...week(4, [run(180), walk(90), run(300), walk(150), run(180), walk(90), run(300)]),
  session(5, 1, [run(300), walk(180), run(300), walk(180), run(300)]),
  session(5, 2, [run(480), walk(300), run(480)]),
  session(5, 3, [run(1200)]),
  session(6, 1, [run(300), walk(180), run(480), walk(180), run(300)]),
  session(6, 2, [run(600), walk(180), run(600)]),
  session(6, 3, [run(1500)]),
  ...week(7, [run(1500)]),
  ...week(8, [run(1680)]),
  ...week(9, [run(1800)]),
];

/**
 * Dev-only plan for E2E flows and demos: same 27 sessions and segment
 * structure, but every duration is compressed to ~1 s per minute
 * (minimum 2 s so each segment is observable/tappable).
 */
export const COMPRESSED_PLAN: PlanSession[] = NHS_PLAN.map((s) => ({
  ...s,
  segments: s.segments.map((seg) => ({ ...seg, seconds: Math.max(2, Math.round(seg.seconds / 60)) })),
}));

export function getSession(plan: PlanSession[], key: string): PlanSession | undefined {
  return plan.find((s) => s.key === key);
}

export function sessionTotalSeconds(session: PlanSession): number {
  return session.segments.reduce((sum, s) => sum + s.seconds, 0);
}

/** First session in plan order without a completed run — free repeats need no special-casing. */
export function nextSessionKey(plan: PlanSession[], completedKeys: ReadonlySet<string>): string | null {
  return plan.find((s) => !completedKeys.has(s.key))?.key ?? null;
}

export function parseSessionKey(key: string): { week: number; day: number } | null {
  const match = /^w(\d+)d(\d+)$/.exec(key);
  return match ? { week: Number(match[1]), day: Number(match[2]) } : null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/domain/plan.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add package.json src/domain/plan.ts src/domain/plan.test.ts
git commit -m "feat: add NHS C25K plan data with compressed dev variant and integrity tests"
```

---

### Task 3: Domain — timeline math + formatting

The elapsed→segment derivation (prefix-sum timeline adjusted by skips, per ADR 0007) and the display formatters.

**Files:**
- Create: `src/domain/segments.ts`, `src/domain/format.ts`
- Test: `src/domain/segments.test.ts`, `src/domain/format.test.ts`

**Interfaces:**
- Consumes: `PlannedSegment`, `SegmentKind`, `parseSessionKey` from `./plan` (Task 2).
- Produces:
  - `interface TimelineSegment { kind: SegmentKind; plannedSeconds: number; effectiveSeconds: number; startsAt: number; wasSkipped: boolean }`
  - `buildTimeline(segments: PlannedSegment[], skipAts: number[]): TimelineSegment[]` — `skipAts` are active-elapsed seconds at which skip events occurred
  - `totalSeconds(timeline: TimelineSegment[]): number`
  - `type SegmentPosition = { done: false; index: number; secondsInto: number; secondsRemaining: number } | { done: true }`
  - `positionAt(timeline: TimelineSegment[], activeElapsed: number): SegmentPosition`
  - `formatClock(totalSeconds: number): string` (`65 → '1:05'`, ceils fractional seconds)
  - `formatMinutes(totalSeconds: number): string` (`1950 → '33 min'`)
  - `sessionTitle(key: string): string` (`'w1d2' → 'Week 1 · Day 2'`, falls back to the raw key)

- [ ] **Step 1: Write the failing tests**

`src/domain/segments.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import type { PlannedSegment } from './plan';
import { buildTimeline, positionAt, totalSeconds } from './segments';

const SEGMENTS: PlannedSegment[] = [
  { kind: 'warmup', seconds: 10 },
  { kind: 'run', seconds: 20 },
  { kind: 'walk', seconds: 15 },
  { kind: 'run', seconds: 20 },
  { kind: 'cooldown', seconds: 10 },
]; // total 75

describe('buildTimeline', () => {
  test('no skips: prefix sums and planned durations', () => {
    const t = buildTimeline(SEGMENTS, []);
    expect(t.map((s) => s.startsAt)).toEqual([0, 10, 30, 45, 65]);
    expect(t.map((s) => s.effectiveSeconds)).toEqual([10, 20, 15, 20, 10]);
    expect(totalSeconds(t)).toBe(75);
  });

  test('skip mid-segment truncates it and shifts the rest earlier', () => {
    // skip at 15s: 5s into the first run → run truncated to 5s
    const t = buildTimeline(SEGMENTS, [15]);
    expect(t[1]).toMatchObject({ effectiveSeconds: 5, wasSkipped: true });
    expect(t.map((s) => s.startsAt)).toEqual([0, 10, 15, 30, 50]);
    expect(totalSeconds(t)).toBe(60);
  });

  test('skip at a segment start truncates it to zero', () => {
    const t = buildTimeline(SEGMENTS, [10]);
    expect(t[1]).toMatchObject({ effectiveSeconds: 0, wasSkipped: true });
    expect(totalSeconds(t)).toBe(55);
  });

  test('two skips apply in order against the already-adjusted timeline', () => {
    // first skip at 15 (run→5s, walk now starts at 15); second at 20 (5s into walk → walk→5s)
    const t = buildTimeline(SEGMENTS, [15, 20]);
    expect(t[1].effectiveSeconds).toBe(5);
    expect(t[2]).toMatchObject({ effectiveSeconds: 5, wasSkipped: true });
    expect(totalSeconds(t)).toBe(50);
  });

  test('skip past the end is ignored', () => {
    const t = buildTimeline(SEGMENTS, [999]);
    expect(totalSeconds(t)).toBe(75);
    expect(t.every((s) => !s.wasSkipped)).toBe(true);
  });
});

describe('positionAt', () => {
  const t = buildTimeline(SEGMENTS, []);

  test('start of session', () => {
    expect(positionAt(t, 0)).toEqual({ done: false, index: 0, secondsInto: 0, secondsRemaining: 10 });
  });

  test('mid-segment', () => {
    expect(positionAt(t, 12)).toEqual({ done: false, index: 1, secondsInto: 2, secondsRemaining: 18 });
  });

  test('an exact boundary belongs to the next segment', () => {
    expect(positionAt(t, 30)).toEqual({ done: false, index: 2, secondsInto: 0, secondsRemaining: 15 });
  });

  test('exhaustion', () => {
    expect(positionAt(t, 75)).toEqual({ done: true });
    expect(positionAt(t, 100)).toEqual({ done: true });
  });
});
```

`src/domain/format.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { formatClock, formatMinutes, sessionTitle } from './format';

describe('formatClock', () => {
  test('zero and simple values', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(1950)).toBe('32:30');
  });

  test('ceils fractional seconds so a fresh segment shows its full length', () => {
    expect(formatClock(299.2)).toBe('5:00');
    expect(formatClock(0.4)).toBe('0:01');
  });

  test('never goes negative', () => {
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('formatMinutes', () => {
  test('rounds to whole minutes', () => {
    expect(formatMinutes(1950)).toBe('33 min');
    expect(formatMinutes(1200)).toBe('20 min');
  });
});

describe('sessionTitle', () => {
  test('formats plan keys and falls back to the raw key', () => {
    expect(sessionTitle('w1d2')).toBe('Week 1 · Day 2');
    expect(sessionTitle('unknown')).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/domain/segments.test.ts src/domain/format.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/domain/segments.ts`**

```ts
import type { PlannedSegment, SegmentKind } from './plan';

export interface TimelineSegment {
  kind: SegmentKind;
  plannedSeconds: number;
  effectiveSeconds: number;
  /** Active-elapsed seconds at which this segment begins. */
  startsAt: number;
  wasSkipped: boolean;
}

export type SegmentPosition =
  | { done: false; index: number; secondsInto: number; secondsRemaining: number }
  | { done: true };

/**
 * The session timeline: prefix sums over planned durations, adjusted by skip
 * events. A skip stamps the then-current segment's actual end at the skip
 * moment, truncating it and shifting everything after it earlier (spec §5).
 */
export function buildTimeline(segments: PlannedSegment[], skipAts: number[]): TimelineSegment[] {
  const timeline: TimelineSegment[] = segments.map((s) => ({
    kind: s.kind,
    plannedSeconds: s.seconds,
    effectiveSeconds: s.seconds,
    startsAt: 0,
    wasSkipped: false,
  }));
  restack(timeline);

  for (const skipAt of [...skipAts].sort((a, b) => a - b)) {
    const pos = positionAt(timeline, skipAt);
    if (pos.done) continue;
    const segment = timeline[pos.index];
    segment.effectiveSeconds = skipAt - segment.startsAt;
    segment.wasSkipped = true;
    restack(timeline);
  }
  return timeline;
}

function restack(timeline: TimelineSegment[]): void {
  let at = 0;
  for (const segment of timeline) {
    segment.startsAt = at;
    at += segment.effectiveSeconds;
  }
}

export function totalSeconds(timeline: TimelineSegment[]): number {
  const last = timeline[timeline.length - 1];
  return last ? last.startsAt + last.effectiveSeconds : 0;
}

export function positionAt(timeline: TimelineSegment[], activeElapsed: number): SegmentPosition {
  for (let index = 0; index < timeline.length; index++) {
    const segment = timeline[index];
    const end = segment.startsAt + segment.effectiveSeconds;
    if (activeElapsed < end) {
      return {
        done: false,
        index,
        secondsInto: activeElapsed - segment.startsAt,
        secondsRemaining: end - activeElapsed,
      };
    }
  }
  return { done: true };
}
```

- [ ] **Step 4: Implement `src/domain/format.ts`**

```ts
import { parseSessionKey } from './plan';

/** `m:ss` countdown/elapsed clock. Ceils so a fresh segment shows its full length. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatMinutes(totalSeconds: number): string {
  return `${Math.round(totalSeconds / 60)} min`;
}

export function sessionTitle(key: string): string {
  const parsed = parseSessionKey(key);
  return parsed ? `Week ${parsed.week} · Day ${parsed.day}` : key;
}
```

- [ ] **Step 5: Run all tests**

Run: `bun test`
Expected: PASS (plan, segments, format suites).

- [ ] **Step 6: Commit**

```bash
git add src/domain/segments.ts src/domain/segments.test.ts src/domain/format.ts src/domain/format.test.ts
git commit -m "feat: add timeline derivation math and display formatters"
```

---

### Task 4: Data layer — expo-sqlite + Drizzle with generated migrations

Schema for `runs`/`run_segments` (sync-agnostic columns per ADR 0004), the migrations pipeline, and the startup migrations gate. `run_points` and `active_run_snapshot` deliberately wait for Stage 3.

**Files:**
- Create: `babel.config.js`, `drizzle.config.ts`, `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrations/` (generated by drizzle-kit, committed)
- Modify: `metro.config.js`, `src/app/_layout.tsx`, `package.json` (script), `docs/adr/0004-local-storage-expo-sqlite-drizzle.md` (implementation note)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `db` (drizzle instance) from `@/db/client`
  - `runs`, `runSegments` tables from `@/db/schema`; row types `typeof runs.$inferSelect` with camelCase fields `id, sessionKey, status, startedAt, endedAt, activeDurationS, distanceM, summaryPolyline, healthkitSaved, createdAt, updatedAt, deletedAt` (runs) and `id, runId, seq, kind, plannedDurationS, actualDurationS, distanceM, wasSkipped, createdAt, updatedAt` (runSegments)
  - `migrations` default export at `@/db/migrations/migrations` (generated)

- [ ] **Step 1: Install dependencies**

```bash
bun expo install expo-sqlite expo-crypto
bun add drizzle-orm
bun add -d drizzle-kit babel-plugin-inline-import babel-preset-expo
```

- [ ] **Step 2: Create `babel.config.js`** (required for inlining `.sql` migration files)

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
```

- [ ] **Step 3: Add `.sql` to Metro source extensions**

In `metro.config.js`, after `const config = getDefaultConfig(__dirname);` add:

```js
config.resolver.sourceExts.push('sql');
```

(`withUniwindConfig` stays the outermost wrapper — do not reorder.)

- [ ] **Step 4: Create `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  driver: 'expo',
});
```

- [ ] **Step 5: Create `src/db/schema.ts`**

Sync-agnostic rules (ADR 0004): TEXT UUID PKs, ISO-8601 UTC `created_at`/`updated_at` set by app code, soft delete via `deleted_at` on user-mutable tables. `distance_m`/`summary_polyline`/`healthkit_saved` are in the approved spec §4 schema; creating them now (nullable/defaulted) avoids churn in Stages 3–5.

```ts
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  sessionKey: text('session_key').notNull(),
  status: text('status', { enum: ['completed', 'partial'] }).notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at').notNull(),
  activeDurationS: integer('active_duration_s').notNull(),
  distanceM: real('distance_m'),
  summaryPolyline: text('summary_polyline'),
  healthkitSaved: integer('healthkit_saved', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});

export const runSegments = sqliteTable('run_segments', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id),
  seq: integer('seq').notNull(),
  kind: text('kind', { enum: ['warmup', 'run', 'walk', 'cooldown'] }).notNull(),
  plannedDurationS: integer('planned_duration_s').notNull(),
  actualDurationS: integer('actual_duration_s').notNull(),
  distanceM: real('distance_m'),
  wasSkipped: integer('was_skipped', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
```

- [ ] **Step 6: Generate the initial migration**

Add script to `package.json`:

```json
"db:generate": "drizzle-kit generate"
```

Run: `bun run db:generate --name init`
Expected: `src/db/migrations/` now contains `0000_init.sql` (or similarly named), `meta/`, and `migrations.js`. Open the `.sql` file and confirm both `CREATE TABLE` statements. Commit all of it (generated migrations are source, ADR 0004).

- [ ] **Step 7: Create `src/db/client.ts`**

One connection for the whole app, change listener on, WAL enabled at open (ADR 0004).

```ts
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

const expoDb = openDatabaseSync('myrunner.db', { enableChangeListener: true });
expoDb.execSync('PRAGMA journal_mode = WAL;');
expoDb.execSync('PRAGMA foreign_keys = ON;');

export const db = drizzle(expoDb);
```

- [ ] **Step 8: Add the migrations gate to `src/app/_layout.tsx`**

Replace the file with:

```tsx
import '@/global.css';

import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { db } from '@/db/client';
import migrations from '@/db/migrations/migrations';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { success, error } = useMigrations(db, migrations);

  useEffect(() => {
    if (success || error) SplashScreen.hideAsync();
  }, [success, error]);

  if (error) {
    return (
      <ThemedView className="flex-1 items-center justify-center px-8">
        <ThemedText>Something went wrong preparing the database.</ThemedText>
        <ThemedText themeColor="textSecondary" className="mt-2">
          {error.message}
        </ThemedText>
      </ThemedView>
    );
  }
  if (!success) return null; // splash stays up

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </ThemeProvider>
  );
}
```

(`expo/tsconfig.base` sets `allowJs: true`, so importing the generated `migrations.js` typechecks.)

- [ ] **Step 9: Record the implementation note in ADR 0004**

ADR 0004 says the DB is opened "via `SQLiteProvider`". The run engine's persistence adapter (Task 6) must reach the DB **outside** the React tree, so the single connection lives in module scope (`src/db/client.ts`) instead — same guarantees (one connection, `enableChangeListener: true`, WAL at open, migrations gate before UI). Append to the ADR's Decision section, point 1:

```markdown
   *Implementation note (Stage 1):* the single connection is a module-scope
   singleton in `src/db/client.ts` (`openDatabaseSync` + `drizzle()`), not
   `SQLiteProvider` — the run engine's persistence adapter needs the DB
   outside the React tree. All other guarantees of this point stand.
```

- [ ] **Step 10: Typecheck, rebuild, verify on simulator**

Run: `bun run typecheck`
Expected: no errors.

Then rebuild (new native modules + new babel config):

```bash
bun expo run:ios
```

Verify with argent: app boots to the three tabs (migrations succeeded — no error screen, no hang on splash).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add expo-sqlite + Drizzle data layer with generated migrations and startup gate"
```

---

### Task 5: Settings service + Settings screen (dev compressed-plan toggle)

A tiny external-store settings service over `expo-sqlite/kv-store` (ADR 0004 point 4), the active-plan selector, and the real Settings tab. The compressed-plan toggle is the switch the E2E flows (Task 13) depend on.

**Files:**
- Create: `src/services/storage.ts`, `src/services/settings.ts`, `src/services/settings-store.ts`, `src/services/active-plan.ts`
- Test: `src/services/settings.test.ts`
- Modify: `src/app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: `NHS_PLAN`, `COMPRESSED_PLAN`, `PlanSession` from `@/domain/plan` (Task 2).
- Produces:
  - `type StringStorage = { getItemSync(key: string): string | null; setItemSync(key: string, value: string): void }` from `@/services/storage`
  - `interface SettingsValues { useCompressedPlan: boolean; keepScreenAwake: boolean }` (defaults: `false`, `true`)
  - `createSettingsStore(storage: StringStorage)` returning `{ getSnapshot(): SettingsValues; set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void; subscribe(listener: () => void): () => void }`
  - `settingsStore` singleton and `useSetting<K extends keyof SettingsValues>(key: K): SettingsValues[K]` from `@/services/settings-store`
  - `activePlan(): PlanSession[]` and `useActivePlan(): PlanSession[]` from `@/services/active-plan`

- [ ] **Step 1: Write the failing tests**

`src/services/settings.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { createSettingsStore } from './settings';
import type { StringStorage } from './storage';

function fakeStorage(initial: Record<string, string> = {}): StringStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItemSync: (key) => map.get(key) ?? null,
    setItemSync: (key, value) => void map.set(key, value),
  };
}

describe('createSettingsStore', () => {
  test('starts from defaults', () => {
    const store = createSettingsStore(fakeStorage());
    expect(store.getSnapshot()).toEqual({ useCompressedPlan: false, keepScreenAwake: true });
  });

  test('set persists, replaces the snapshot object, and notifies subscribers', () => {
    const storage = fakeStorage();
    const store = createSettingsStore(storage);
    const before = store.getSnapshot();
    let notified = 0;
    store.subscribe(() => notified++);

    store.set('useCompressedPlan', true);

    expect(store.getSnapshot().useCompressedPlan).toBe(true);
    expect(store.getSnapshot()).not.toBe(before);
    expect(notified).toBe(1);
    // persisted: a second store over the same storage sees the value
    expect(createSettingsStore(storage).getSnapshot().useCompressedPlan).toBe(true);
  });

  test('unknown persisted keys are ignored, missing ones defaulted', () => {
    const storage = fakeStorage({ settings: JSON.stringify({ keepScreenAwake: false, junk: 1 }) });
    const store = createSettingsStore(storage);
    expect(store.getSnapshot()).toEqual({ useCompressedPlan: false, keepScreenAwake: false });
  });

  test('corrupted persisted JSON falls back to defaults instead of throwing', () => {
    const store = createSettingsStore(fakeStorage({ settings: 'not-json{' }));
    expect(store.getSnapshot()).toEqual({ useCompressedPlan: false, keepScreenAwake: true });
  });

  test('unsubscribe stops notifications', () => {
    const store = createSettingsStore(fakeStorage());
    let notified = 0;
    const unsubscribe = store.subscribe(() => notified++);
    unsubscribe();
    store.set('keepScreenAwake', false);
    expect(notified).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/services/settings.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the storage type and the pure store**

`src/services/storage.ts`:

```ts
/** The synchronous subset of expo-sqlite/kv-store that services persist through. */
export type StringStorage = {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
};
```

`src/services/settings.ts`:

```ts
import type { StringStorage } from './storage';

export interface SettingsValues {
  /** Dev/E2E only: swap the NHS plan for the seconds-long compressed plan. */
  useCompressedPlan: boolean;
  /** Keep the display on for the whole run (spec decisions log). */
  keepScreenAwake: boolean;
}

const DEFAULTS: SettingsValues = { useCompressedPlan: false, keepScreenAwake: true };
const STORAGE_KEY = 'settings';

export function createSettingsStore(storage: StringStorage) {
  let snapshot = load();
  const listeners = new Set<() => void>();

  function load(): SettingsValues {
    const raw = storage.getItemSync(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    let parsed: Partial<SettingsValues>;
    try {
      parsed = JSON.parse(raw) as Partial<SettingsValues>;
    } catch {
      return { ...DEFAULTS }; // corrupted storage must never crash startup
    }
    return {
      useCompressedPlan: parsed.useCompressedPlan ?? DEFAULTS.useCompressedPlan,
      keepScreenAwake: parsed.keepScreenAwake ?? DEFAULTS.keepScreenAwake,
    };
  }

  return {
    getSnapshot: (): SettingsValues => snapshot,
    set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void {
      snapshot = { ...snapshot, [key]: value };
      storage.setItemSync(STORAGE_KEY, JSON.stringify(snapshot));
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/services/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the singleton, hook, and plan selector**

`src/services/settings-store.ts`:

```ts
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { createSettingsStore, type SettingsValues } from './settings';

export const settingsStore = createSettingsStore(Storage);

export function useSetting<K extends keyof SettingsValues>(key: K): SettingsValues[K] {
  return useSyncExternalStore(settingsStore.subscribe, () => settingsStore.getSnapshot()[key]);
}
```

`src/services/active-plan.ts`:

```ts
import { COMPRESSED_PLAN, NHS_PLAN, type PlanSession } from '@/domain/plan';
import { settingsStore, useSetting } from './settings-store';

/** The compressed plan is a dev/E2E tool only — unreachable in release builds. */
export function activePlan(): PlanSession[] {
  return __DEV__ && settingsStore.getSnapshot().useCompressedPlan ? COMPRESSED_PLAN : NHS_PLAN;
}

export function useActivePlan(): PlanSession[] {
  const compressed = useSetting('useCompressedPlan');
  return __DEV__ && compressed ? COMPRESSED_PLAN : NHS_PLAN;
}
```

- [ ] **Step 6: Replace `src/app/(tabs)/settings.tsx`**

SwiftUI `Form` per spec §8; the Developer section only exists in dev builds.

```tsx
import { Form, Host, LabeledContent, Section, Text, Toggle } from '@expo/ui/swift-ui';
import Constants from 'expo-constants';

import { settingsStore, useSetting } from '@/services/settings-store';

export default function SettingsScreen() {
  const compressed = useSetting('useCompressedPlan');

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form>
        <Section title="About">
          <LabeledContent label="Version">
            <Text>{Constants.expoConfig?.version ?? '—'}</Text>
          </LabeledContent>
        </Section>
        {__DEV__ ? (
          <Section title="Developer">
            <Toggle
              testID="settings-compressed-plan"
              label="Compressed plan"
              isOn={compressed}
              onIsOnChange={(value) => settingsStore.set('useCompressedPlan', value)}
            />
          </Section>
        ) : null}
      </Form>
    </Host>
  );
}
```

- [ ] **Step 7: Typecheck and verify on simulator**

Run: `bun run typecheck`
Expected: no errors.

Verify with argent: Settings tab shows a native Form with About → Version and a Developer section; toggling "Compressed plan" flips the switch, and it stays flipped after an app restart (kv-store persistence).

- [ ] **Step 8: Commit**

```bash
git add src/services src/app/\(tabs\)/settings.tsx
git commit -m "feat: add kv-store settings service and real Settings screen with dev compressed-plan toggle"
```

---

### Task 6: Run engine — wall-clock event-log state machine

The heart of the app (ADR 0007). Pure TS, ports injected, fully unit-tested with a fake clock. Also delivers the DB persistence adapter and the composition root.

**Files:**
- Create: `src/services/run-engine/types.ts`, `src/services/run-engine/engine.ts`, `src/services/run-engine/index.ts`, `src/db/save-run.ts`
- Test: `src/services/run-engine/engine.test.ts`

**Interfaces:**
- Consumes: `PlanSession` (Task 2); `buildTimeline`/`positionAt`/`totalSeconds` (Task 3); `db`, `runs`, `runSegments` (Task 4).
- Produces:
  - `type Clock = () => number` (epoch ms)
  - `type EngineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'endedEarly'`
  - `interface RunSnapshot { status: EngineStatus; sessionKey: string | null; segmentIndex: number; segmentKind: SegmentKind | null; segmentSecondsRemaining: number; segmentSecondsTotal: number; nextSegment: { kind: SegmentKind; seconds: number } | null; activeElapsedSeconds: number; totalSeconds: number; savedRunId: string | null; saveFailed: boolean }`
  - `interface CompletedRunRecord { sessionKey: string; status: 'completed' | 'partial'; startedAt: string; endedAt: string; activeDurationS: number; segments: Array<{ seq: number; kind: SegmentKind; plannedDurationS: number; actualDurationS: number; wasSkipped: boolean }> }`
  - `interface RunPersistence { saveRun(record: CompletedRunRecord): Promise<string> }` (resolves the new run id)
  - `class RunEngine` with `start(session)`, `pause()`, `resume()`, `skipSegment()`, `endEarly()`, `heartbeat(now?)`, `reset()`, `subscribe(cb)`, `getSnapshot()`
  - Singleton `runEngine` and hook `useRunEngine(): RunSnapshot` from `@/services/run-engine`
  - `dbRunPersistence: RunPersistence` from `@/db/save-run`

- [ ] **Step 1: Create `src/services/run-engine/types.ts`**

```ts
import type { SegmentKind } from '@/domain/plan';

/** Wall-clock time source, epoch milliseconds (ADR 0007: wall clock only). */
export type Clock = () => number;

export interface RunEvent {
  type: 'start' | 'pause' | 'resume' | 'skip' | 'end';
  at: number;
}

export type EngineStatus = 'idle' | 'running' | 'paused' | 'completed' | 'endedEarly';

export interface RunSnapshot {
  status: EngineStatus;
  sessionKey: string | null;
  segmentIndex: number;
  segmentKind: SegmentKind | null;
  segmentSecondsRemaining: number;
  segmentSecondsTotal: number;
  nextSegment: { kind: SegmentKind; seconds: number } | null;
  activeElapsedSeconds: number;
  totalSeconds: number;
  /** Set once persistence resolves after completion/end-early. */
  savedRunId: string | null;
  saveFailed: boolean;
}

export interface CompletedSegmentRecord {
  seq: number;
  kind: SegmentKind;
  plannedDurationS: number;
  actualDurationS: number;
  wasSkipped: boolean;
}

export interface CompletedRunRecord {
  sessionKey: string;
  status: 'completed' | 'partial';
  startedAt: string; // ISO-8601 UTC
  endedAt: string;
  activeDurationS: number;
  segments: CompletedSegmentRecord[];
}

/** Persistence port (ADR 0003) — the engine never touches the DB directly. */
export interface RunPersistence {
  saveRun(record: CompletedRunRecord): Promise<string>;
}
```

- [ ] **Step 2: Write the failing tests**

`src/services/run-engine/engine.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import type { PlanSession } from '@/domain/plan';
import { RunEngine } from './engine';
import type { CompletedRunRecord, RunPersistence } from './types';

const SESSION: PlanSession = {
  key: 'w1d1',
  week: 1,
  day: 1,
  segments: [
    { kind: 'warmup', seconds: 10 },
    { kind: 'run', seconds: 20 },
    { kind: 'walk', seconds: 15 },
    { kind: 'run', seconds: 20 },
    { kind: 'cooldown', seconds: 10 },
  ], // total 75
};

function makeEngine() {
  let now = 1_000_000;
  const saved: CompletedRunRecord[] = [];
  let failSave = false;
  const persistence: RunPersistence = {
    saveRun: async (record) => {
      if (failSave) throw new Error('db down');
      saved.push(record);
      return 'run-1';
    },
  };
  const engine = new RunEngine({ persistence, clock: () => now });
  return {
    engine,
    saved,
    setFailSave: (v: boolean) => (failSave = v),
    tick: (seconds: number) => {
      now += seconds * 1000;
      engine.heartbeat();
    },
    advance: (seconds: number) => (now += seconds * 1000),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('lifecycle', () => {
  test('start enters the first segment', () => {
    const { engine } = makeEngine();
    engine.start(SESSION);
    const s = engine.getSnapshot();
    expect(s.status).toBe('running');
    expect(s.sessionKey).toBe('w1d1');
    expect(s.segmentIndex).toBe(0);
    expect(s.segmentKind).toBe('warmup');
    expect(s.segmentSecondsRemaining).toBe(10);
    expect(s.nextSegment).toEqual({ kind: 'run', seconds: 20 });
    expect(s.totalSeconds).toBe(75);
  });

  test('start is ignored unless idle', () => {
    const { engine } = makeEngine();
    engine.start(SESSION);
    engine.start({ ...SESSION, key: 'w9d3' });
    expect(engine.getSnapshot().sessionKey).toBe('w1d1');
  });

  test('heartbeats derive the current segment from elapsed time', () => {
    const { engine, tick } = makeEngine();
    engine.start(SESSION);
    tick(12); // 12s → 2s into the run segment
    const s = engine.getSnapshot();
    expect(s.segmentIndex).toBe(1);
    expect(s.segmentKind).toBe('run');
    expect(s.segmentSecondsRemaining).toBe(18);
    expect(s.activeElapsedSeconds).toBe(12);
  });

  test('a single late heartbeat lands in the right segment (no per-tick accumulation)', () => {
    const { engine, tick } = makeEngine();
    engine.start(SESSION);
    tick(46); // one heartbeat 46s later → segment 3
    expect(engine.getSnapshot().segmentIndex).toBe(3);
  });

  test('reset returns to idle', () => {
    const { engine } = makeEngine();
    engine.start(SESSION);
    engine.reset();
    expect(engine.getSnapshot().status).toBe('idle');
  });
});

describe('pause/resume', () => {
  test('pause freezes active elapsed', () => {
    const { engine, tick, advance } = makeEngine();
    engine.start(SESSION);
    tick(30);
    engine.pause();
    advance(100);
    engine.heartbeat();
    const s = engine.getSnapshot();
    expect(s.status).toBe('paused');
    expect(s.activeElapsedSeconds).toBe(30);
  });

  test('resume continues from where it paused; pauses accumulate', () => {
    const { engine, tick, advance } = makeEngine();
    engine.start(SESSION);
    tick(30);
    engine.pause();
    advance(100);
    engine.resume();
    tick(5); // active 35
    engine.pause();
    advance(50);
    engine.resume();
    tick(2); // active 37
    expect(engine.getSnapshot().activeElapsedSeconds).toBe(37);
    expect(engine.getSnapshot().segmentIndex).toBe(2); // 37 ∈ walk [30, 45)
  });

  test('pause when not running and resume when not paused are ignored', () => {
    const { engine } = makeEngine();
    engine.resume();
    expect(engine.getSnapshot().status).toBe('idle');
    engine.start(SESSION);
    engine.resume();
    expect(engine.getSnapshot().status).toBe('running');
    engine.pause();
    engine.pause();
    expect(engine.getSnapshot().status).toBe('paused');
  });
});

describe('skip', () => {
  test('skip truncates the current segment and moves to the next', () => {
    const { engine, tick } = makeEngine();
    engine.start(SESSION);
    tick(15); // 5s into run
    engine.skipSegment();
    const s = engine.getSnapshot();
    expect(s.segmentIndex).toBe(2);
    expect(s.segmentKind).toBe('walk');
    expect(s.totalSeconds).toBe(60); // run shortened 20→5
    expect(s.activeElapsedSeconds).toBe(15);
  });

  test('skipping the final segment completes the session', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(70); // into cooldown (65–75)
    engine.skipSegment();
    expect(engine.getSnapshot().status).toBe('completed');
    await flush();
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe('completed');
  });
});

describe('completion', () => {
  test('timeline exhaustion completes and persists a correct record', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(30);
    engine.pause();
    engine.resume();
    tick(50); // active 80 > 75 → done, capped at 75
    expect(engine.getSnapshot().status).toBe('completed');
    expect(engine.getSnapshot().activeElapsedSeconds).toBe(75);
    await flush();
    expect(engine.getSnapshot().savedRunId).toBe('run-1');
    const record = saved[0];
    expect(record.sessionKey).toBe('w1d1');
    expect(record.status).toBe('completed');
    expect(record.activeDurationS).toBe(75);
    expect(record.segments).toHaveLength(5);
    expect(record.segments.map((s) => s.actualDurationS)).toEqual([10, 20, 15, 20, 10]);
    expect(record.startedAt).toBe(new Date(1_000_000).toISOString());
  });

  test('endEarly persists a partial run: reached segments only, last one truncated', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(12); // 2s into segment 1 (run)
    engine.endEarly();
    expect(engine.getSnapshot().status).toBe('endedEarly');
    await flush();
    const record = saved[0];
    expect(record.status).toBe('partial');
    expect(record.activeDurationS).toBe(12);
    expect(record.segments).toHaveLength(2);
    expect(record.segments[0]).toMatchObject({ seq: 0, kind: 'warmup', actualDurationS: 10 });
    expect(record.segments[1]).toMatchObject({ seq: 1, kind: 'run', actualDurationS: 2, wasSkipped: false });
  });

  test('skipped segments are recorded with their truncated duration and flag', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(15);
    engine.skipSegment(); // run 20→5
    tick(60); // active 75 ≥ total 60 → completed
    await flush();
    const record = saved[0];
    expect(record.segments[1]).toMatchObject({ kind: 'run', plannedDurationS: 20, actualDurationS: 5, wasSkipped: true });
  });

  test('a failed save surfaces saveFailed', async () => {
    const { engine, tick, setFailSave } = makeEngine();
    setFailSave(true);
    engine.start(SESSION);
    tick(80);
    await flush();
    expect(engine.getSnapshot().saveFailed).toBe(true);
    expect(engine.getSnapshot().savedRunId).toBeNull();
  });

  test('a slow save from a superseded run never stamps a later run', async () => {
    let resolveSave: ((id: string) => void) | undefined;
    const persistence: RunPersistence = {
      saveRun: () => new Promise<string>((resolve) => (resolveSave = resolve)),
    };
    let now = 1_000_000;
    const engine = new RunEngine({ persistence, clock: () => now });
    engine.start(SESSION);
    now += 80_000;
    engine.heartbeat(); // completes run A; its save stays pending
    expect(engine.getSnapshot().status).toBe('completed');
    engine.reset();
    engine.start({ ...SESSION, key: 'w1d2' });
    resolveSave!('run-A');
    await flush();
    const s = engine.getSnapshot();
    expect(s.savedRunId).toBeNull();
    expect(s.sessionKey).toBe('w1d2');
    expect(s.status).toBe('running');
  });

  test('controls are inert after completion', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(80);
    await flush();
    engine.pause();
    engine.skipSegment();
    engine.endEarly();
    engine.heartbeat();
    expect(engine.getSnapshot().status).toBe('completed');
    expect(saved).toHaveLength(1);
  });
});

describe('clock anomalies (ADR 0007 invariants)', () => {
  test('a backwards clock jump never produces negative elapsed', () => {
    const { engine, advance } = makeEngine();
    engine.start(SESSION);
    advance(-500); // clock jumps back
    engine.heartbeat();
    expect(engine.getSnapshot().activeElapsedSeconds).toBeGreaterThanOrEqual(0);
    expect(engine.getSnapshot().status).toBe('running');
  });

  test('a forward jump can only end the session as completed, capped at the timeline', async () => {
    const { engine, tick, saved } = makeEngine();
    engine.start(SESSION);
    tick(100_000);
    expect(engine.getSnapshot().status).toBe('completed');
    await flush();
    expect(saved[0].activeDurationS).toBe(75);
  });
});

describe('subscription', () => {
  test('subscribers are notified on change and can unsubscribe', () => {
    const { engine, tick } = makeEngine();
    let calls = 0;
    const unsubscribe = engine.subscribe(() => calls++);
    engine.start(SESSION);
    tick(1);
    expect(calls).toBeGreaterThanOrEqual(2);
    const before = calls;
    unsubscribe();
    tick(1);
    expect(calls).toBe(before);
  });

  test('getSnapshot is referentially stable between changes', () => {
    const { engine } = makeEngine();
    engine.start(SESSION);
    expect(engine.getSnapshot()).toBe(engine.getSnapshot());
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/services/run-engine/engine.test.ts`
Expected: FAIL — `./engine` not found.

- [ ] **Step 4: Implement `src/services/run-engine/engine.ts`**

```ts
import type { PlanSession } from '@/domain/plan';
import { buildTimeline, positionAt, totalSeconds, type TimelineSegment } from '@/domain/segments';
import type {
  Clock,
  CompletedRunRecord,
  EngineStatus,
  RunEvent,
  RunPersistence,
  RunSnapshot,
} from './types';

const IDLE_SNAPSHOT: RunSnapshot = {
  status: 'idle',
  sessionKey: null,
  segmentIndex: -1,
  segmentKind: null,
  segmentSecondsRemaining: 0,
  segmentSecondsTotal: 0,
  nextSegment: null,
  activeElapsedSeconds: 0,
  totalSeconds: 0,
  savedRunId: null,
  saveFailed: false,
};

/**
 * Active time is derived from the timestamped event log, never accumulated
 * (ADR 0007). If currently paused, elapsed is frozen at the pause timestamp.
 */
function activeElapsedMs(events: RunEvent[], now: number): number {
  if (events.length === 0) return 0;
  const startAt = events[0].at;
  let pausedTotal = 0;
  let pausedAt: number | null = null;
  for (const event of events) {
    if (event.type === 'pause' && pausedAt === null) pausedAt = event.at;
    if (event.type === 'resume' && pausedAt !== null) {
      pausedTotal += event.at - pausedAt;
      pausedAt = null;
    }
  }
  const end = pausedAt ?? Math.max(now, events[events.length - 1].at);
  return Math.max(0, end - startAt - pausedTotal);
}

export class RunEngine {
  private readonly clock: Clock;
  private readonly persistence: RunPersistence;

  private session: PlanSession | null = null;
  private events: RunEvent[] = [];
  private status: EngineStatus = 'idle';
  private savedRunId: string | null = null;
  private saveFailed = false;
  /** Bumped by start()/reset() so a slow save from a superseded run can never stamp a later one. */
  private runGeneration = 0;
  private snapshot: RunSnapshot = IDLE_SNAPSHOT;
  private readonly listeners = new Set<() => void>();

  constructor(deps: { persistence: RunPersistence; clock?: Clock }) {
    this.persistence = deps.persistence;
    this.clock = deps.clock ?? Date.now;
  }

  start(session: PlanSession): void {
    if (this.status !== 'idle') return;
    this.session = session;
    this.events = [{ type: 'start', at: this.clock() }];
    this.status = 'running';
    this.savedRunId = null;
    this.saveFailed = false;
    this.runGeneration += 1;
    this.refresh();
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.append('pause');
    this.status = 'paused';
    this.refresh();
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.append('resume');
    this.status = 'running';
    this.refresh();
  }

  skipSegment(): void {
    if (this.status !== 'running' && this.status !== 'paused') return;
    this.append('skip');
    this.heartbeat(); // completes the session if the skipped segment was the last
  }

  endEarly(): void {
    if (this.status !== 'running' && this.status !== 'paused') return;
    this.finalize('endedEarly');
  }

  heartbeat(now: number = this.clock()): void {
    if (this.status !== 'running' && this.status !== 'paused') return;
    const elapsed = activeElapsedMs(this.events, now) / 1000;
    if (positionAt(this.timeline(), elapsed).done) {
      this.finalize('completed');
      return;
    }
    this.refresh(now);
  }

  reset(): void {
    this.session = null;
    this.events = [];
    this.status = 'idle';
    this.savedRunId = null;
    this.saveFailed = false;
    this.runGeneration += 1;
    this.snapshot = IDLE_SNAPSHOT;
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = (): RunSnapshot => this.snapshot;

  // --- derivation ---

  /** Event timestamps are clamped non-decreasing so elapsed can never go negative (ADR 0007). */
  private append(type: RunEvent['type']): void {
    const last = this.events[this.events.length - 1];
    this.events.push({ type, at: Math.max(this.clock(), last?.at ?? 0) });
  }

  /** Active-elapsed seconds at each skip event, measured against the events before it. */
  private skipAts(): number[] {
    return this.events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.type === 'skip')
      .map(({ event, index }) => activeElapsedMs(this.events.slice(0, index), event.at) / 1000);
  }

  private timeline(): TimelineSegment[] {
    return buildTimeline(this.session?.segments ?? [], this.skipAts());
  }

  private refresh(now: number = this.clock()): void {
    if (!this.session) return;
    const timeline = this.timeline();
    const total = totalSeconds(timeline);
    const elapsed = Math.min(activeElapsedMs(this.events, now) / 1000, total);
    const pos = positionAt(timeline, elapsed);

    const base = {
      status: this.status,
      sessionKey: this.session.key,
      activeElapsedSeconds: elapsed,
      totalSeconds: total,
      savedRunId: this.savedRunId,
      saveFailed: this.saveFailed,
    };
    if (pos.done) {
      this.snapshot = {
        ...base,
        segmentIndex: timeline.length - 1,
        segmentKind: timeline[timeline.length - 1]?.kind ?? null,
        segmentSecondsRemaining: 0,
        segmentSecondsTotal: timeline[timeline.length - 1]?.effectiveSeconds ?? 0,
        nextSegment: null,
      };
    } else {
      const segment = timeline[pos.index];
      const next = timeline[pos.index + 1];
      this.snapshot = {
        ...base,
        segmentIndex: pos.index,
        segmentKind: segment.kind,
        segmentSecondsRemaining: pos.secondsRemaining,
        segmentSecondsTotal: segment.effectiveSeconds,
        nextSegment: next ? { kind: next.kind, seconds: next.effectiveSeconds } : null,
      };
    }
    this.emit();
  }

  private finalize(kind: 'completed' | 'endedEarly'): void {
    if (!this.session || this.events.length === 0) return;
    this.append('end');
    const endAt = this.events[this.events.length - 1].at;
    const timeline = this.timeline();
    const total = totalSeconds(timeline);
    // Completion is capped at timeline exhaustion (ADR 0007).
    const finalElapsed = Math.min(activeElapsedMs(this.events, endAt) / 1000, total);

    const record: CompletedRunRecord = {
      sessionKey: this.session.key,
      status: kind === 'completed' ? 'completed' : 'partial',
      startedAt: new Date(this.events[0].at).toISOString(),
      endedAt: new Date(endAt).toISOString(),
      activeDurationS: Math.round(finalElapsed),
      segments: timeline
        .filter((segment) => segment.wasSkipped || segment.startsAt < finalElapsed)
        .map((segment, seq) => ({
          seq,
          kind: segment.kind,
          plannedDurationS: segment.plannedSeconds,
          actualDurationS: Math.round(
            Math.min(segment.effectiveSeconds, Math.max(0, finalElapsed - segment.startsAt)),
          ),
          wasSkipped: segment.wasSkipped,
        })),
    };

    this.status = kind;
    this.refresh(endAt);
    const generation = this.runGeneration;
    this.persistence.saveRun(record).then(
      (id) => {
        if (generation !== this.runGeneration) return; // superseded by reset()/start()
        this.savedRunId = id;
        this.snapshot = { ...this.snapshot, savedRunId: id };
        this.emit();
      },
      () => {
        if (generation !== this.runGeneration) return; // superseded by reset()/start()
        this.saveFailed = true;
        this.snapshot = { ...this.snapshot, saveFailed: true };
        this.emit();
      },
    );
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/services/run-engine/engine.test.ts`
Expected: PASS. If the "backwards clock" test fails, check the `Math.max(now, …)` clamp in `activeElapsedMs` and the non-decreasing clamp in `append`.

- [ ] **Step 6: Implement the DB persistence adapter — `src/db/save-run.ts`**

```ts
import * as Crypto from 'expo-crypto';

import type { CompletedRunRecord, RunPersistence } from '@/services/run-engine/types';
import { db } from './client';
import { runSegments, runs } from './schema';

export const dbRunPersistence: RunPersistence = {
  async saveRun(record: CompletedRunRecord): Promise<string> {
    const runId = Crypto.randomUUID();
    const nowIso = new Date().toISOString();

    await db.insert(runs).values({
      id: runId,
      sessionKey: record.sessionKey,
      status: record.status,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      activeDurationS: record.activeDurationS,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    if (record.segments.length > 0) {
      await db.insert(runSegments).values(
        record.segments.map((segment) => ({
          id: Crypto.randomUUID(),
          runId,
          seq: segment.seq,
          kind: segment.kind,
          plannedDurationS: segment.plannedDurationS,
          actualDurationS: segment.actualDurationS,
          wasSkipped: segment.wasSkipped,
          createdAt: nowIso,
          updatedAt: nowIso,
        })),
      );
    }
    return runId;
  },
};
```

- [ ] **Step 7: Create the composition root — `src/services/run-engine/index.ts`**

```ts
import { useSyncExternalStore } from 'react';

import { dbRunPersistence } from '@/db/save-run';
import { RunEngine } from './engine';

export const runEngine = new RunEngine({ persistence: dbRunPersistence });

export function useRunEngine() {
  return useSyncExternalStore(runEngine.subscribe, runEngine.getSnapshot);
}

export type { CompletedRunRecord, EngineStatus, RunSnapshot } from './types';
```

- [ ] **Step 8: Full test run + typecheck**

Run: `bun test && bun run typecheck`
Expected: all suites PASS, no type errors. (`engine.test.ts` must not import `index.ts` — the composition root pulls in expo-crypto, which bun can't load. The tests import `./engine` and `./types` only.)

- [ ] **Step 9: Commit**

```bash
git add src/services/run-engine src/db/save-run.ts
git commit -m "feat: add wall-clock event-log run engine with DB persistence adapter"
```

---

### Task 7: Plan tab — progression + free repeat

SwiftUI `List` with a `Section` per week, completion checkmarks, next-session badge (spec §8). "Current session" is derived, never stored (ADR 0004).

**Files:**
- Modify: `src/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `useActivePlan` (Task 5); `nextSessionKey`, `sessionTotalSeconds`, `PlanSession` (Task 2); `formatMinutes` (Task 3); `db`, `runs` (Task 4); `useTheme`.
- Produces: testIDs `plan-row-<key>` on every session row and `plan-next-<key>` on the next-session badge (Task 13 flows).

- [ ] **Step 1: Replace `src/app/(tabs)/index.tsx`**

`useLiveQuery` on `runs` (top-level table — allowed by ADR 0004); soft-deleted and partial runs are filtered in JS.

```tsx
import { Button, HStack, Host, Image, List, Section, Spacer, Text } from '@expo/ui/swift-ui';
import { foregroundColor } from '@expo/ui/swift-ui/modifiers';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';

import { db } from '@/db/client';
import { runs } from '@/db/schema';
import { formatMinutes } from '@/domain/format';
import { nextSessionKey, sessionTotalSeconds, type PlanSession } from '@/domain/plan';
import { useTheme } from '@/hooks/use-theme';
import { useActivePlan } from '@/services/active-plan';

export default function PlanScreen() {
  const router = useRouter();
  const plan = useActivePlan();
  const { data: allRuns } = useLiveQuery(db.select().from(runs));

  const completedKeys = new Set(
    (allRuns ?? [])
      .filter((run) => run.status === 'completed' && !run.deletedAt)
      .map((run) => run.sessionKey),
  );
  const nextKey = nextSessionKey(plan, completedKeys);
  const weeks = [...new Set(plan.map((session) => session.week))];

  return (
    <Host style={{ flex: 1 }}>
      <List>
        {weeks.map((week) => {
          const sessions = plan.filter((session) => session.week === week);
          const done = sessions.filter((session) => completedKeys.has(session.key)).length;
          return (
            <Section key={week} title={`Week ${week} · ${done}/${sessions.length}`}>
              {sessions.map((session) => (
                <SessionRow
                  key={session.key}
                  session={session}
                  completed={completedKeys.has(session.key)}
                  isNext={session.key === nextKey}
                  onPress={() => router.push(`/session/${session.key}`)}
                />
              ))}
            </Section>
          );
        })}
      </List>
    </Host>
  );
}

function SessionRow({
  session,
  completed,
  isNext,
  onPress,
}: {
  session: PlanSession;
  completed: boolean;
  isNext: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <Button testID={`plan-row-${session.key}`} onPress={onPress}>
      <HStack spacing={12}>
        <Image
          systemName={completed ? 'checkmark.circle.fill' : 'circle'}
          color={completed ? colors.primary : colors.textSecondary}
          size={22}
        />
        <Text modifiers={[foregroundColor(colors.text)]}>{`Day ${session.day}`}</Text>
        <Spacer />
        {isNext ? (
          <Image
            testID={`plan-next-${session.key}`}
            systemName="arrow.forward.circle.fill"
            color={colors.primary}
            size={22}
          />
        ) : null}
        <Text modifiers={[foregroundColor(colors.textSecondary)]}>
          {formatMinutes(sessionTotalSeconds(session))}
        </Text>
      </HStack>
    </Button>
  );
}
```

Note: the row is a SwiftUI `Button` so the whole row is tappable and carries the `testID`; `foregroundColor(colors.text)` overrides the button's default tint on the label.

- [ ] **Step 2: Register the session route shell**

`router.push('/session/<key>')` needs the route to exist for typed routes to compile. Create a placeholder `src/app/session/[key].tsx` (replaced in Task 8):

```tsx
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function SessionSheet() {
  return (
    <ThemedView className="flex-1 items-center justify-center">
      <ThemedText>Session</ThemedText>
    </ThemedView>
  );
}
```

And add to the root Stack in `src/app/_layout.tsx` (after the `(tabs)` screen — formSheet options per ADR 0006: explicit fractional detents, never `fitToContents`):

```tsx
<Stack.Screen
  name="session/[key]"
  options={{
    presentation: 'formSheet',
    sheetAllowedDetents: [0.5, 0.95],
    sheetInitialDetentIndex: 0,
    sheetGrabberVisible: true,
  }}
/>
```

- [ ] **Step 3: Typecheck and verify on simulator**

Run: `bun run typecheck`
Expected: no errors.

Verify with argent: Plan tab shows 9 week sections × 3 day rows with duration labels; every row has a `circle` icon; `w1d1` carries the next-badge; tapping a row opens the placeholder form sheet at half height with a grabber. Toggle "Compressed plan" in Settings → Plan rows re-render with compressed durations (e.g. Week 1 rows show `1 min`).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(tabs)/index.tsx" "src/app/session/[key].tsx" src/app/_layout.tsx
git commit -m "feat: add Plan tab with derived progression and free repeat"
```

---

### Task 8: Pre-run detail form sheet + SegmentBar

The formSheet showing the session's interval structure and the Start button that hands off to the engine.

**Files:**
- Create: `src/components/segment-bar.tsx`
- Modify: `src/constants/theme.ts` (add `SegmentColors`), `src/app/session/[key].tsx` (replace placeholder)

**Interfaces:**
- Consumes: `getSession`, `sessionTotalSeconds`, `PlannedSegment` (Task 2); `formatMinutes`, `sessionTitle` (Task 3); `runEngine` (Task 6); `db`, `runs` (Task 4); `useActivePlan` (Task 5).
- Produces: `SegmentBar({ segments, testID? })` RN component; `SegmentColors: Record<SegmentKind, string>` in `@/constants/theme`; testID `session-start` (Task 13 flows).

- [ ] **Step 1: Add `SegmentColors` to `src/constants/theme.ts`**

Append (raw values — consumed by RN style props and SwiftUI modifiers, the documented exception to className styling):

```ts
import type { SegmentKind } from '@/domain/plan';

/** Segment-kind accents, shared by the SegmentBar and the run screen. Same in both schemes. */
export const SegmentColors: Record<SegmentKind, string> = {
  warmup: '#F5A623',
  run: '#3c87f7',
  walk: '#8E8E93',
  cooldown: '#5AC8FA',
};
```

(Place the `import type` at the top of the file with the other imports. `constants → domain` is a types-only, platform-free import — allowed.)

- [ ] **Step 2: Create `src/components/segment-bar.tsx`**

Proportional widths via `flex: seconds` — trivial in RN, impractical in @expo/ui SwiftUI (no GeometryReader), which is why this block is RN (ADR 0005 boundary note).

```tsx
import { View } from 'react-native';

import { SegmentColors } from '@/constants/theme';
import type { PlannedSegment } from '@/domain/plan';

export function SegmentBar({ segments, testID }: { segments: PlannedSegment[]; testID?: string }) {
  return (
    <View testID={testID} className="h-3 flex-row overflow-hidden rounded-full">
      {segments.map((segment, index) => (
        <View key={index} style={{ flex: segment.seconds, backgroundColor: SegmentColors[segment.kind] }} />
      ))}
    </View>
  );
}
```

- [ ] **Step 3: Replace `src/app/session/[key].tsx`**

RN shell (title, bar, stats — Uniwind) with one SwiftUI block for the Start button. Sheet content stays flat: no nested navigator, no header (ADR 0006).

```tsx
import { Button, Host } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, tint } from '@expo/ui/swift-ui/modifiers';
import { and, eq, isNull } from 'drizzle-orm';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { SegmentBar } from '@/components/segment-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { db } from '@/db/client';
import { runs } from '@/db/schema';
import { formatMinutes, sessionTitle } from '@/domain/format';
import { getSession, sessionTotalSeconds } from '@/domain/plan';
import { useTheme } from '@/hooks/use-theme';
import { useActivePlan } from '@/services/active-plan';
import { runEngine } from '@/services/run-engine';

export default function SessionSheet() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const plan = useActivePlan();
  const colors = useTheme();
  const session = getSession(plan, key);
  const [attempts, setAttempts] = useState<number | null>(null);

  useEffect(() => {
    db.select()
      .from(runs)
      .where(and(eq(runs.sessionKey, key), eq(runs.status, 'completed'), isNull(runs.deletedAt)))
      .then((rows) => setAttempts(rows.length))
      .catch(() => setAttempts(null));
  }, [key]);

  if (!session) return <Redirect href="/" />;

  const runSeconds = session.segments
    .filter((segment) => segment.kind === 'run')
    .reduce((sum, segment) => sum + segment.seconds, 0);

  return (
    <ThemedView className="flex-1 gap-6 px-6 pt-8">
      <ThemedText type="subtitle">{sessionTitle(session.key)}</ThemedText>
      <SegmentBar segments={session.segments} testID="session-segment-bar" />
      <View className="gap-2">
        <StatRow label="Total" value={formatMinutes(sessionTotalSeconds(session))} />
        <StatRow label="Running" value={formatMinutes(runSeconds)} />
        <StatRow label="Completed" value={attempts === null ? '—' : `${attempts}×`} />
      </View>
      <Host matchContents>
        <Button
          testID="session-start"
          label="Start session"
          onPress={() => {
            runEngine.start(session);
            router.push('/run');
          }}
          modifiers={[buttonStyle('borderedProminent'), controlSize('large'), tint(colors.primary)]}
        />
      </Host>
    </ThemedView>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <ThemedText themeColor="textSecondary">{label}</ThemedText>
      <ThemedText>{value}</ThemedText>
    </View>
  );
}
```

- [ ] **Step 4: Register the run route shell**

`router.push('/run')` must compile. Create placeholder `src/app/run.tsx` (replaced in Task 9):

```tsx
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function RunScreen() {
  return (
    <ThemedView className="flex-1 items-center justify-center">
      <ThemedText>Run</ThemedText>
    </ThemedView>
  );
}
```

Add to the root Stack in `src/app/_layout.tsx` (ADR 0006: leaving mid-run only via the explicit End confirmation):

```tsx
<Stack.Screen name="run" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
```

- [ ] **Step 5: Typecheck and verify on simulator**

Run: `bun run typecheck`
Expected: no errors.

Verify with argent: tap `w1d1` on Plan → sheet opens at half height with grabber, title "Week 1 · Day 1", a proportional segment bar (orange warmup, alternating blue/gray intervals, light-blue cooldown), Total/Running/Completed stats, and a prominent Start button; dragging expands to the large detent; Start opens the placeholder run modal (no swipe-dismiss). **This is the ADR 0006 early on-device detent validation** — if detents/grabber misbehave, the pre-approved fallback is `presentation: 'modal'` on this one screen.

- [ ] **Step 6: Commit**

```bash
git add src/components/segment-bar.tsx src/constants/theme.ts "src/app/session/[key].tsx" src/app/run.tsx src/app/_layout.tsx
git commit -m "feat: add pre-run session form sheet with segment bar and start handoff"
```

---

### Task 9: Active run screen

Full-screen modal driven by the engine snapshot: rolling countdown, segment gauge, Pause/Skip/End controls, keep-awake toggle. The JS engine drives; SwiftUI presents (spec §8).

**Files:**
- Modify: `src/app/run.tsx` (replace placeholder), `src/app/_layout.tsx` (register `run-summary`)
- Create: `src/app/run-summary.tsx` (placeholder, replaced in Task 10)

**Interfaces:**
- Consumes: `runEngine`, `useRunEngine`, `RunSnapshot` (Task 6); `formatClock` (Task 3); `SegmentColors` (Task 8); `useSetting`, `settingsStore` (Task 5).
- Produces: testIDs `run-countdown`, `run-pause`, `run-skip`, `run-end`, `run-keep-awake` (Task 13 flows); navigation contract: on finish the screen `router.replace`s to `/run-summary?runId=<id>` so back can never return to a finished run (ADR 0006).

- [ ] **Step 1: Install expo-keep-awake and rebuild**

```bash
bun expo install expo-keep-awake
bun expo run:ios
```

- [ ] **Step 2: Replace `src/app/run.tsx`**

The 1 s `setInterval` is a *foreground UI wake-up*, never a time source — elapsed time is derived inside the engine from wall-clock timestamps (ADR 0007). Stage 3 adds the background location heartbeat without touching this screen's contract.

```tsx
import { Button, ConfirmationDialog, Gauge, HStack, Host, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  contentTransition,
  controlSize,
  font,
  foregroundColor,
  gaugeStyle,
  monospacedDigit,
  padding,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useKeepAwake } from 'expo-keep-awake';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { ThemedView } from '@/components/themed-view';
import { SegmentColors } from '@/constants/theme';
import { formatClock } from '@/domain/format';
import type { SegmentKind } from '@/domain/plan';
import { useTheme } from '@/hooks/use-theme';
import { runEngine, useRunEngine } from '@/services/run-engine';
import { settingsStore, useSetting } from '@/services/settings-store';

const KIND_LABEL: Record<SegmentKind, string> = {
  warmup: 'Warm up',
  run: 'Run',
  walk: 'Walk',
  cooldown: 'Cool down',
};

/** useKeepAwake is unconditional, so the toggle mounts/unmounts this child. */
function KeepAwakeWhileMounted() {
  useKeepAwake();
  return null;
}

export default function RunScreen() {
  const snapshot = useRunEngine();
  const router = useRouter();
  const keepAwake = useSetting('keepScreenAwake');
  const colors = useTheme();
  const [endDialogOpen, setEndDialogOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => runEngine.heartbeat(), 1000);
    return () => clearInterval(id);
  }, []);

  const finished = snapshot.status === 'completed' || snapshot.status === 'endedEarly';
  const saveSettled = snapshot.savedRunId !== null || snapshot.saveFailed;
  useEffect(() => {
    if (finished && saveSettled) {
      router.replace({ pathname: '/run-summary', params: { runId: snapshot.savedRunId ?? '' } });
    }
  }, [finished, saveSettled, snapshot.savedRunId, router]);

  if (snapshot.status === 'idle') return <Redirect href="/" />;

  const paused = snapshot.status === 'paused';
  const kind = snapshot.segmentKind ?? 'run';
  const segmentProgress =
    snapshot.segmentSecondsTotal > 0
      ? Math.min(1, 1 - snapshot.segmentSecondsRemaining / snapshot.segmentSecondsTotal)
      : 0;

  return (
    <ThemedView className="flex-1">
      {keepAwake ? <KeepAwakeWhileMounted /> : null}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <VStack spacing={24} modifiers={[padding({ all: 24 })]}>
          <Spacer />
          <Text modifiers={[font({ textStyle: 'title2' }), foregroundColor(SegmentColors[kind])]}>
            {paused ? 'Paused' : KIND_LABEL[kind]}
          </Text>
          <Text
            testID="run-countdown"
            modifiers={[
              font({ size: 80, weight: 'bold' }),
              monospacedDigit(),
              contentTransition('numericText', { countsDown: true }),
              foregroundColor(colors.text),
            ]}>
            {formatClock(snapshot.segmentSecondsRemaining)}
          </Text>
          <Gauge value={segmentProgress} modifiers={[gaugeStyle('linearCapacity'), tint(SegmentColors[kind])]} />
          <Text modifiers={[foregroundColor(colors.textSecondary)]}>
            {snapshot.nextSegment
              ? `Next: ${KIND_LABEL[snapshot.nextSegment.kind]} ${formatClock(snapshot.nextSegment.seconds)}`
              : 'Last segment — finish strong!'}
          </Text>
          <Text testID="run-elapsed" modifiers={[monospacedDigit(), foregroundColor(colors.textSecondary)]}>
            {`${formatClock(snapshot.activeElapsedSeconds)} / ${formatClock(snapshot.totalSeconds)}`}
          </Text>
          <Spacer />
          <HStack spacing={16}>
            <Button
              testID="run-pause"
              label={paused ? 'Resume' : 'Pause'}
              onPress={() => (paused ? runEngine.resume() : runEngine.pause())}
              modifiers={[buttonStyle('borderedProminent'), controlSize('large'), tint(colors.primary)]}
            />
            <Button
              testID="run-skip"
              label="Skip"
              onPress={() => runEngine.skipSegment()}
              modifiers={[buttonStyle('bordered'), controlSize('large')]}
            />
            <ConfirmationDialog
              title="End this run?"
              isPresented={endDialogOpen}
              onIsPresentedChange={setEndDialogOpen}
              titleVisibility="visible">
              <ConfirmationDialog.Trigger>
                <Button
                  testID="run-end"
                  label="End"
                  role="destructive"
                  onPress={() => setEndDialogOpen(true)}
                  modifiers={[buttonStyle('bordered'), controlSize('large')]}
                />
              </ConfirmationDialog.Trigger>
              <ConfirmationDialog.Actions>
                <Button role="destructive" label="End run" onPress={() => runEngine.endEarly()} />
              </ConfirmationDialog.Actions>
              <ConfirmationDialog.Message>
                <Text>Progress so far is saved as a partial run.</Text>
              </ConfirmationDialog.Message>
            </ConfirmationDialog>
          </HStack>
          <Toggle
            testID="run-keep-awake"
            label="Keep screen awake"
            isOn={keepAwake}
            onIsOnChange={(value) => settingsStore.set('keepScreenAwake', value)}
          />
        </VStack>
      </Host>
    </ThemedView>
  );
}
```

- [ ] **Step 3: Register the summary route with a placeholder**

Create `src/app/run-summary.tsx`:

```tsx
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function RunSummaryScreen() {
  return (
    <ThemedView className="flex-1 items-center justify-center">
      <ThemedText>Summary</ThemedText>
    </ThemedView>
  );
}
```

Add to the root Stack in `src/app/_layout.tsx`:

```tsx
<Stack.Screen name="run-summary" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
```

- [ ] **Step 4: Typecheck and verify on simulator**

Run: `bun run typecheck`
Expected: no errors.

Verify with argent (compressed plan ON via Settings): Plan → `w1d1` → Start. Expect: full-screen run UI with orange "Warm up" label, big rolling countdown from 0:05, gauge filling, "Next: Run 0:02", elapsed row ticking; Pause freezes the countdown and relabels to Resume; Resume continues; Skip jumps to the next segment; End opens a native confirmation dialog — "End run" lands on the placeholder Summary screen; a full compressed session left alone also lands on Summary (completion path). Confirm no swipe-dismiss on the modal.

- [ ] **Step 5: Commit**

```bash
git add src/app/run.tsx src/app/run-summary.tsx src/app/_layout.tsx package.json bun.lock
git commit -m "feat: add active run screen driven by the engine snapshot"
```

---

### Task 10: Run summary screen

`router.replace` target after a finished run: congratulations header, stats, per-segment table, Done back to the tabs.

**Files:**
- Modify: `src/app/run-summary.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `db`, `runs`, `runSegments` row types (Task 4); `formatClock`, `sessionTitle` (Task 3); `runEngine` (Task 6).
- Produces: testID `summary-done` (Task 13 flows). Done performs `runEngine.reset()` + `router.dismissAll()` — the engine is idle again before the tabs re-appear.

- [ ] **Step 1: Replace `src/app/run-summary.tsx`**

One-shot reads (the rows are immutable once written — no live query needed). The `saveFailed` path arrives here with `runId=''` and shows the non-fatal fallback (spec §11: local save failure never blocks completion UX).

```tsx
import { Form, Host, LabeledContent, Section, Text } from '@expo/ui/swift-ui';
import { asc, eq } from 'drizzle-orm';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { db } from '@/db/client';
import { runSegments, runs } from '@/db/schema';
import { formatClock, sessionTitle } from '@/domain/format';
import { runEngine } from '@/services/run-engine';

type RunRow = typeof runs.$inferSelect;
type SegmentRow = typeof runSegments.$inferSelect;

const KIND_LABEL = { warmup: 'Warm up', run: 'Run', walk: 'Walk', cooldown: 'Cool down' } as const;

export default function RunSummaryScreen() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const [data, setData] = useState<{ run: RunRow; segments: SegmentRow[] } | null>(null);

  useEffect(() => {
    if (!runId) return;
    (async () => {
      const [run] = await db.select().from(runs).where(eq(runs.id, runId));
      if (!run) return;
      const segments = await db
        .select()
        .from(runSegments)
        .where(eq(runSegments.runId, runId))
        .orderBy(asc(runSegments.seq));
      setData({ run, segments });
    })();
  }, [runId]);

  const done = () => {
    runEngine.reset();
    router.dismissAll();
  };

  const doneButton = (
    <Pressable testID="summary-done" onPress={done} className="items-center rounded-full bg-primary py-4">
      <ThemedText className="text-white">Done</ThemedText>
    </Pressable>
  );

  if (!runId || !data) {
    return (
      <ThemedView className="flex-1 justify-between px-6 pb-16 pt-24">
        <ThemedText themeColor="textSecondary">
          {runId ? 'Loading…' : 'This run could not be saved. Sorry about that.'}
        </ThemedText>
        {doneButton}
      </ThemedView>
    );
  }

  const completed = data.run.status === 'completed';

  return (
    <ThemedView className="flex-1 px-6 pb-16 pt-24">
      <ThemedText type="subtitle">{completed ? 'Workout complete! 🎉' : 'Good effort!'}</ThemedText>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title="Session">
            <LabeledContent label="Session">
              <Text>{sessionTitle(data.run.sessionKey)}</Text>
            </LabeledContent>
            <LabeledContent label="Active time">
              <Text>{formatClock(data.run.activeDurationS)}</Text>
            </LabeledContent>
            {!completed ? (
              <LabeledContent label="Status">
                <Text>Partial</Text>
              </LabeledContent>
            ) : null}
          </Section>
          <Section title="Segments">
            {data.segments.map((segment) => (
              <LabeledContent
                key={segment.id}
                label={`${segment.seq + 1}. ${KIND_LABEL[segment.kind]}${segment.wasSkipped ? ' (skipped)' : ''}`}>
                <Text>{`${formatClock(segment.actualDurationS)} / ${formatClock(segment.plannedDurationS)}`}</Text>
              </LabeledContent>
            ))}
          </Section>
        </Form>
      </Host>
      {doneButton}
    </ThemedView>
  );
}
```

- [ ] **Step 2: Typecheck and verify on simulator**

Run: `bun run typecheck`
Expected: no errors.

Verify with argent (compressed plan ON): complete a `w1d1` session → summary shows "Workout complete! 🎉", session/active-time rows, and all segments with actual/planned times; Done returns to the Plan tab (sheet and modals all gone), `w1d1` now shows a checkmark and the next-badge moved to `w1d2`. Repeat with End-early → header "Good effort!", Status row "Partial", only reached segments listed. Confirm back-swipe/back cannot return to the finished run screen.

- [ ] **Step 3: Commit**

```bash
git add src/app/run-summary.tsx
git commit -m "feat: add run summary screen with per-segment results"
```

---

### Task 11: History tab

Basic list of finished runs (spec §13 Stage 1: no per-row maps, no swipe-to-delete yet — deletion UX waits until the drizzle #2620 empty-result bug can be designed around properly).

**Files:**
- Modify: `src/app/(tabs)/history.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `db`, `runs` (Task 4); `formatClock`, `sessionTitle` (Task 3); `useTheme`.
- Produces: testIDs `history-row-<sessionKey>` (Task 13 flows).

- [ ] **Step 1: Replace `src/app/(tabs)/history.tsx`**

Live query on `runs` (allowed table). The list starts empty and only grows in Stage 1, so the empty state relies on "empty → non-empty" transitions only — the #2620 direction that works.

```tsx
import { ContentUnavailableView, HStack, Host, List, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundColor, monospacedDigit } from '@expo/ui/swift-ui/modifiers';
import { desc } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { runs } from '@/db/schema';
import { formatClock, sessionTitle } from '@/domain/format';
import { useTheme } from '@/hooks/use-theme';

export default function HistoryScreen() {
  const colors = useTheme();
  const { data } = useLiveQuery(db.select().from(runs).orderBy(desc(runs.startedAt)));
  const visible = (data ?? []).filter((run) => !run.deletedAt);

  if (visible.length === 0) {
    return (
      <Host style={{ flex: 1 }}>
        <ContentUnavailableView
          title="No runs yet"
          systemImage="figure.run"
          description="Finish your first session and it will show up here."
        />
      </Host>
    );
  }

  return (
    <Host style={{ flex: 1 }}>
      <List>
        {visible.map((run) => (
          <HStack key={run.id} testID={`history-row-${run.sessionKey}`} spacing={12}>
            <VStack alignment="leading" spacing={2}>
              <Text modifiers={[foregroundColor(colors.text)]}>{sessionTitle(run.sessionKey)}</Text>
              <Text modifiers={[font({ textStyle: 'footnote' }), foregroundColor(colors.textSecondary)]}>
                {new Date(run.startedAt).toLocaleDateString()}
              </Text>
            </VStack>
            <Spacer />
            {run.status === 'partial' ? (
              <Text modifiers={[font({ textStyle: 'footnote' }), foregroundColor(colors.textSecondary)]}>
                Partial
              </Text>
            ) : null}
            <Text modifiers={[monospacedDigit(), foregroundColor(colors.text)]}>
              {formatClock(run.activeDurationS)}
            </Text>
          </HStack>
        ))}
      </List>
    </Host>
  );
}
```

- [ ] **Step 2: Typecheck and verify on simulator**

Run: `bun run typecheck`
Expected: no errors.

Verify with argent: fresh install shows the "No runs yet" empty state; after completing a compressed session, the History tab shows a "Week 1 · Day 1" row with today's date and the active duration — **without navigating away and back** (the live query refreshes it). An ended-early run shows the Partial label.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(tabs)/history.tsx"
git commit -m "feat: add History tab with live-updating run list"
```

---

### Task 12: Onboarding — versioned first-launch flow

Framework + three permission-free steps (spec §13: welcome, how C25K works, doctor note). Steps are versioned by id so a future update that adds a permission shows only the pending step to existing users.

**Files:**
- Create: `src/services/onboarding.ts`, `src/services/onboarding-store.ts`, `src/app/onboarding/_layout.tsx`, `src/app/onboarding/index.tsx`, `src/app/onboarding/how-it-works.tsx`, `src/app/onboarding/health-note.tsx`
- Test: `src/services/onboarding.test.ts`
- Modify: `src/app/_layout.tsx` (gate + route registration)

**Interfaces:**
- Consumes: `StringStorage` (Task 5); `ThemedText`/`ThemedView`.
- Produces:
  - `ONBOARDING_STEPS: readonly { id: OnboardingStepId; route: string }[]` with ids `'welcome-v1' | 'how-it-works-v1' | 'health-note-v1'` and routes `/onboarding`, `/onboarding/how-it-works`, `/onboarding/health-note`
  - `createOnboarding(storage)` → `{ pendingSteps(): { id; route }[]; completeStep(id): void }`
  - `onboarding` singleton and `completeAndAdvance(router, id)` from `@/services/onboarding-store`
  - testIDs `onboarding-continue-welcome`, `onboarding-continue-how-it-works`, `onboarding-continue-health-note` (Task 13 flows)

- [ ] **Step 1: Write the failing tests**

`src/services/onboarding.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { ONBOARDING_STEPS, createOnboarding } from './onboarding';
import type { StringStorage } from './storage';

function fakeStorage(): StringStorage {
  const map = new Map<string, string>();
  return {
    getItemSync: (key) => map.get(key) ?? null,
    setItemSync: (key, value) => void map.set(key, value),
  };
}

describe('createOnboarding', () => {
  test('all steps pending on first launch, in declared order', () => {
    const onboarding = createOnboarding(fakeStorage());
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(ONBOARDING_STEPS.map((s) => s.id));
  });

  test('completing steps removes them from pending, idempotently', () => {
    const onboarding = createOnboarding(fakeStorage());
    onboarding.completeStep('welcome-v1');
    onboarding.completeStep('welcome-v1');
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(['how-it-works-v1', 'health-note-v1']);
  });

  test('versioned resume: a partially-complete user sees only pending steps', () => {
    const storage = fakeStorage();
    createOnboarding(storage).completeStep('welcome-v1');
    // fresh instance over the same storage — e.g. an app update adding a step
    const later = createOnboarding(storage);
    expect(later.pendingSteps()[0].id).toBe('how-it-works-v1');
  });

  test('nothing pending once all steps are complete', () => {
    const onboarding = createOnboarding(fakeStorage());
    for (const step of ONBOARDING_STEPS) onboarding.completeStep(step.id);
    expect(onboarding.pendingSteps()).toEqual([]);
  });

  test('corrupted persisted JSON is treated as no steps completed', () => {
    const storage = fakeStorage();
    storage.setItemSync('onboarding.completedSteps', 'not-json{');
    const onboarding = createOnboarding(storage);
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(ONBOARDING_STEPS.map((s) => s.id));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/services/onboarding.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/services/onboarding.ts`**

```ts
import type { StringStorage } from './storage';

/**
 * Versioned first-launch steps (spec §13). A later release that needs a new
 * permission appends a step here; existing users then see only that step.
 */
export const ONBOARDING_STEPS = [
  { id: 'welcome-v1', route: '/onboarding' },
  { id: 'how-it-works-v1', route: '/onboarding/how-it-works' },
  { id: 'health-note-v1', route: '/onboarding/health-note' },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id'];
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const STORAGE_KEY = 'onboarding.completedSteps';

export function createOnboarding(storage: StringStorage) {
  const readCompleted = (): string[] => {
    const raw = storage.getItemSync(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return []; // corrupted storage must never crash startup — re-showing onboarding is benign
    }
  };

  return {
    pendingSteps(): OnboardingStep[] {
      const completed = readCompleted();
      return ONBOARDING_STEPS.filter((step) => !completed.includes(step.id));
    },
    completeStep(id: OnboardingStepId): void {
      const completed = readCompleted();
      if (!completed.includes(id)) {
        storage.setItemSync(STORAGE_KEY, JSON.stringify([...completed, id]));
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/services/onboarding.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the singleton + navigation helper**

`src/services/onboarding-store.ts`:

```ts
import { type ImperativeRouter } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';

import { createOnboarding, type OnboardingStepId } from './onboarding';

export const onboarding = createOnboarding(Storage);

/**
 * Mark this step done, then go to the next pending step or leave onboarding.
 *
 * Uses `replace` (not `push`) between steps so the nested onboarding Stack
 * never accumulates history — `dismissAll`/`back` target the CLOSEST stack,
 * so with local history they would pop back to an earlier onboarding screen
 * instead of leaving the flow. With a single-entry nested stack, `back()` on
 * the last step has nothing left to pop locally, bubbles to the root Stack,
 * and dismisses the whole onboarding group, revealing the tabs underneath.
 * (SDK 57 exports `ImperativeRouter`, not `Router`.)
 */
export function completeAndAdvance(router: ImperativeRouter, id: OnboardingStepId): void {
  onboarding.completeStep(id);
  const next = onboarding.pendingSteps()[0];
  if (next) {
    router.replace(next.route as Parameters<typeof router.replace>[0]);
  } else {
    router.back();
  }
}
```

- [ ] **Step 6: Create the step screens**

`src/app/onboarding/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`src/app/onboarding/index.tsx`:

```tsx
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { completeAndAdvance } from '@/services/onboarding-store';

export default function WelcomeScreen() {
  const router = useRouter();
  return (
    <ThemedView className="flex-1 justify-between px-6 pb-16 pt-24">
      <View className="gap-4">
        <ThemedText type="title">My Runner</ThemedText>
        <ThemedText themeColor="textSecondary">
          From the couch to 5 km in nine weeks. Free, private, and all yours — no account, no ads,
          everything stays on your phone.
        </ThemedText>
      </View>
      <Pressable
        testID="onboarding-continue-welcome"
        onPress={() => completeAndAdvance(router, 'welcome-v1')}
        className="items-center rounded-full bg-primary py-4">
        <ThemedText className="text-white">Continue</ThemedText>
      </Pressable>
    </ThemedView>
  );
}
```

`src/app/onboarding/how-it-works.tsx` — same shape, component `HowItWorksScreen`, testID `onboarding-continue-how-it-works`, step id `'how-it-works-v1'`, copy:

```tsx
<View className="gap-4">
  <ThemedText type="subtitle">How it works</ThemedText>
  <ThemedText themeColor="textSecondary">
    Three short sessions a week for nine weeks. Each one mixes walking and running — the app
    times every interval and tells you when to switch.
  </ThemedText>
  <ThemedText themeColor="textSecondary">
    The runs get gradually longer, and any session can be repeated whenever you like. By week
    nine you'll be running 30 minutes straight.
  </ThemedText>
</View>
```

`src/app/onboarding/health-note.tsx` — component `HealthNoteScreen`, testID `onboarding-continue-health-note`, step id `'health-note-v1'`, button label `Let's go`, copy:

```tsx
<View className="gap-4">
  <ThemedText type="subtitle">One gentle note</ThemedText>
  <ThemedText themeColor="textSecondary">
    Couch to 5K is designed for beginners, but if you have a health condition, an old injury, or
    you're just unsure — have a quick word with your doctor before starting. Take it easy and
    listen to your body.
  </ThemedText>
</View>
```

- [ ] **Step 7: Gate the tabs behind pending onboarding**

In `src/app/_layout.tsx`, add the gate component and register the route. Add to the imports:

```tsx
import { useRouter } from 'expo-router';
import { onboarding } from '@/services/onboarding-store';
```

Add above `RootLayout`:

```tsx
/** Pushes the first pending onboarding step as a full-screen modal over the tabs. */
function OnboardingGate() {
  const router = useRouter();
  useEffect(() => {
    const pending = onboarding.pendingSteps();
    if (pending.length > 0) {
      router.push(pending[0].route as Parameters<typeof router.push>[0]);
    }
  }, [router]);
  return null;
}
```

Render `<OnboardingGate />` as the first child inside `ThemeProvider` (next to the Stack), and register the route group in the Stack:

```tsx
<Stack.Screen name="onboarding" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
```

- [ ] **Step 8: Run all tests, typecheck, verify on simulator**

Run: `bun test && bun run typecheck`
Expected: PASS / no errors.

Verify with argent: delete the app from the simulator, rebuild (`bun expo run:ios`) → onboarding covers the tabs: Welcome → Continue → How it works → Continue → One gentle note → Let's go → lands on the Plan tab. Relaunch the app → no onboarding. (Versioned resume is covered by unit tests.)

- [ ] **Step 9: Commit**

```bash
git add src/services/onboarding.ts src/services/onboarding.test.ts src/services/onboarding-store.ts src/app/onboarding src/app/_layout.tsx
git commit -m "feat: add versioned onboarding flow with welcome, how-it-works, and health-note steps"
```

---

### Task 13: E2E foundation — first Maestro flows

The stage's E2E deliverable (ADR 0001): flows for onboarding, a full compressed session, and the run controls, plus on-device confirmation that SwiftUI `testID`s resolve as accessibility identifiers (ADR 0005 Stage-1 exit criterion).

**Files:**
- Create: `.maestro/config.yaml`, `.maestro/helpers/complete-onboarding.yaml`, `.maestro/helpers/enable-compressed-plan.yaml`, `.maestro/01-onboarding.yaml`, `.maestro/02-complete-session.yaml`, `.maestro/03-run-controls.yaml`

**Interfaces:**
- Consumes: every testID produced by Tasks 5–12; appId `se.lukaslindqvist.myrunner`; a booted simulator with the app built via `bun expo run:ios` and Metro running.
- Produces: the regression suite that AGENTS.md's before-merge policy runs (`maestro test .maestro/`).

- [ ] **Step 1: Confirm the testIDs resolve on device**

With the app running, use the Maestro MCP `inspect_screen` tool (or `argent describe`) on the Plan screen, the session sheet, and the run screen. Confirm the accessibility tree contains `plan-row-w1d1`, `session-start`, `run-countdown`, `run-pause`, `run-skip`, `run-end`. If an ID is missing (SwiftUI can merge children into one accessibility element), move the `testID` onto the interactive element it merged into and re-check — author the flows below against what `inspect_screen` actually reports.

- [ ] **Step 2: Create `.maestro/config.yaml`**

Only top-level flows are tests; `helpers/` are subflows.

```yaml
flows:
  - "*.yaml"
```

- [ ] **Step 3: Create the helper subflows**

`.maestro/helpers/complete-onboarding.yaml`:

```yaml
appId: se.lukaslindqvist.myrunner
---
- assertVisible:
    id: "onboarding-continue-welcome"
- tapOn:
    id: "onboarding-continue-welcome"
- tapOn:
    id: "onboarding-continue-how-it-works"
- tapOn:
    id: "onboarding-continue-health-note"
- assertVisible:
    id: "plan-row-w1d1"
```

`.maestro/helpers/enable-compressed-plan.yaml`:

```yaml
appId: se.lukaslindqvist.myrunner
---
- tapOn: "Settings"
- tapOn:
    id: "settings-compressed-plan"
- tapOn: "Plan"
```

- [ ] **Step 4: Create `.maestro/01-onboarding.yaml`**

```yaml
appId: se.lukaslindqvist.myrunner
---
- launchApp:
    clearState: true
- runFlow: helpers/complete-onboarding.yaml
- stopApp
- launchApp
- assertNotVisible:
    id: "onboarding-continue-welcome"
- assertVisible:
    id: "plan-row-w1d1"
```

- [ ] **Step 5: Create `.maestro/02-complete-session.yaml`**

Compressed `w1d1` runs ~40 s; the wait allows 2 minutes.

```yaml
appId: se.lukaslindqvist.myrunner
---
- launchApp:
    clearState: true
- runFlow: helpers/complete-onboarding.yaml
- runFlow: helpers/enable-compressed-plan.yaml
- tapOn:
    id: "plan-row-w1d1"
- tapOn:
    id: "session-start"
- assertVisible:
    id: "run-countdown"
- extendedWaitUntil:
    visible:
      id: "summary-done"
    timeout: 120000
- tapOn:
    id: "summary-done"
- tapOn: "History"
- assertVisible:
    id: "history-row-w1d1"
- tapOn: "Plan"
- assertVisible:
    id: "plan-next-w1d2"
```

- [ ] **Step 6: Create `.maestro/03-run-controls.yaml`**

Pause/resume, skip, and end-early on one compressed session, ending in a Partial history row.

```yaml
appId: se.lukaslindqvist.myrunner
---
- launchApp:
    clearState: true
- runFlow: helpers/complete-onboarding.yaml
- runFlow: helpers/enable-compressed-plan.yaml
- tapOn:
    id: "plan-row-w1d1"
- tapOn:
    id: "session-start"
- tapOn:
    id: "run-pause"
- assertVisible: "Resume"
- tapOn:
    id: "run-pause"
- tapOn:
    id: "run-skip"
- tapOn:
    id: "run-skip"
- tapOn:
    id: "run-end"
- tapOn: "End run"
- extendedWaitUntil:
    visible:
      id: "summary-done"
    timeout: 30000
- tapOn:
    id: "summary-done"
- tapOn: "History"
- assertVisible:
    id: "history-row-w1d1"
- assertVisible: "Partial"
```

- [ ] **Step 7: Run the suite**

Prerequisites: booted simulator, app built (`bun expo run:ios`), Metro running. Run via the Maestro MCP `run` tool with `{ dir: ".maestro/" }`, or:

```bash
maestro test .maestro/
```

Expected: 3 flows pass. If a selector fails, re-inspect with `inspect_screen` and fix the flow or the `testID` — do not add sleeps; prefer `extendedWaitUntil`/`assertVisible` waits. (Consult the Maestro MCP `cheat_sheet` tool for syntax.)

- [ ] **Step 8: Commit**

```bash
git add .maestro
git commit -m "test: add Maestro E2E foundation — onboarding, session completion, run controls"
```

---

### Task 14: Docs + final verification pass

Make the repo's own docs match the new reality, then run everything.

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the Stage-1 "works when" evidence (spec §13).

- [ ] **Step 1: Update AGENTS.md**

Three edits:

1. In **Commands**, replace the "No unit test runner is configured yet" clause with: `bun test` runs the unit suites (pure-TS `domain/` and services; no RN runtime needed), and add `bun run db:generate` — regenerates Drizzle migrations after editing `src/db/schema.ts` (commit the output).
2. In **E2E tests (Maestro)**, delete the final paragraph starting with "`.maestro/` does not exist yet" (it now exists) and note the flows rely on the dev-only compressed plan toggled via Settings → Developer.
3. In **Architecture**, replace the **Navigation** bullet (there is no `src/components/app-tabs.tsx` anymore) with: the root layout `src/app/_layout.tsx` runs the Drizzle migrations gate, then renders the root `Stack`; tabs live in `src/app/(tabs)/_layout.tsx` (`NativeTabs`; adding a tab = route file + trigger there); every modal surface is a root-Stack screen with a native `presentation` option (ADR 0006). Replace the **Current state** bullet with a short map of the real layers (`domain/` pure TS + `bun test`, `db/` Drizzle + generated migrations, `services/` engine + kv-store stores, screens per spec §8) and note Stage 1 is implemented (plan in `docs/superpowers/plans/2026-07-11-stage-1-interval-timer-mvp.md`).

- [ ] **Step 2: Full verification pass**

```bash
bun test && bun run typecheck && bun run lint
maestro test .maestro/
```

Expected: all green. Then the stage's manual "works when" check on the simulator with the **real NHS plan** (compressed OFF): start `w1d1`, let it run a couple of minutes with correct warmup countdown, pause/resume once, end early, confirm the partial run in History.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for Stage 1 architecture, bun test, and Maestro suite"
```

- [ ] **Step 4: Finish the branch**

Use the superpowers:finishing-a-development-branch skill — Stage 1 ships as a PR to `main` (squash-merge; PR title in Conventional Commits, e.g. `feat: Stage 1 — interval-timer MVP`). Per ADR 0001, the full Maestro suite must be green locally before merge.

---

## Stage 1 exit criteria (from spec §13)

- A full session runs screen-on with correct transitions and lands in History.
- Progression advances; any earlier session can be repeated.
- Onboarding shows once, in order, and never again after completion.
- `bun test`, `tsc --noEmit`, `expo lint` green; all three Maestro flows pass.
- SwiftUI `testID`s confirmed resolving in the real accessibility hierarchy (ADR 0005 exit criterion).
- Deliberately absent: sound, GPS, distance, maps, Health, crash resume.







