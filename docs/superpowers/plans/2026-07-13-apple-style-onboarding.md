# Apple-Style Onboarding Welcome Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild onboarding as a single Apple-system-style welcome screen (icon, tinted large title, SF Symbol feature rows, health footnote, Liquid Glass Continue button) presented as a non-dismissible sheet, per `docs/superpowers/specs/2026-07-13-apple-style-onboarding-design.md`.

**Architecture:** The screen body is React Native styled with Uniwind classNames; only the CTA button is an `@expo/ui` SwiftUI island (`glassProminent` when available). Glass availability lives behind one app-owned helper (`src/lib/glass.ts`). The versioned onboarding step machinery and nested onboarding `Stack` are unchanged — the step list just shrinks to one entry.

**Tech Stack:** Expo SDK 57, React Native 0.86, expo-router, Uniwind (Tailwind v4 classNames), `@expo/ui/swift-ui` + modifiers, `expo-symbols`, `expo-glass-effect` (availability function only), Bun test, Maestro.

## Global Constraints

- Expo SDK 57 / RN 0.86 / React 19.2 / TS ~6.0 — check https://docs.expo.dev/versions/v57.0.0/ before deviating from any API shown here; do not rely on memorized Expo APIs.
- Package manager is **Bun**: `bun expo install <pkg>` for dependencies, `bun test`, `bun run lint`.
- Never edit `/ios` or `/android` (gitignored, generated via prebuild).
- Styling is Uniwind `className` (ADR 0002); `@expo/ui` islands are the only place SwiftUI modifiers appear (ADR 0005/0013). No NativeWind, no StyleSheet in new code.
- Screens compose only — no file-local components in `src/app/` (ADR 0013).
- Path aliases: `@/*` → `src/*`, `@/assets/*` → `assets/*`.
- Copy strings, testIDs, and step ids are exact as written in each task; the Maestro suite depends on `onboarding-continue-welcome` and `plan-row-w1d1`.
- Commit messages: Conventional Commits.
- Known quirk: after installing packages, ESLint may report bogus errors from a stale cache — delete `.expo/cache/eslint` and re-run.
- Dev-client Metro runs on port 8087 in this repo.

---

### Task 1: Dependencies + glass availability helper

**Files:**
- Modify: `package.json` (via `bun expo install`, not by hand)
- Create: `src/lib/glass.ts`

**Interfaces:**
- Consumes: `isLiquidGlassAvailable(): boolean` from `expo-glass-effect` (already in node_modules as a required peer of expo-router; its native module is already linked in the dev client — expo-router itself calls it).
- Produces: `isGlassAvailable(): boolean` from `@/lib/glass` — used by Task 4.

- [ ] **Step 1: Install the two packages as direct dependencies**

```bash
bun expo install expo-glass-effect expo-symbols
```

Expected: `package.json` gains `"expo-glass-effect": "~57.0.0"` and `"expo-symbols": "~57.0.0"` (SDK-matched versions). Both are already present transitively (peers of expo-router), so `bun.lock` changes should be minimal and **no new native build is expected**. If a later runtime step fails with "Cannot find native module", run `bun run ios` once to rebuild the dev client.

- [ ] **Step 2: Create the helper**

```ts
// src/lib/glass.ts
import { isLiquidGlassAvailable } from 'expo-glass-effect';

/**
 * The app's single glass-capability gate. Liquid Glass currently exists only
 * on iOS 26+ builds; when another platform gains a glass treatment, update
 * this function — call sites stay untouched.
 */
export function isGlassAvailable(): boolean {
  return isLiquidGlassAvailable();
}
```

No unit test: the wrapped function requires the native runtime, and `bun test` covers only pure-TS `domain/` and `services/`. Runtime behavior is verified on the simulator in Task 7.

- [ ] **Step 3: Verify types and lint**

```bash
bunx tsc --noEmit && bun run lint
```

Expected: both pass (delete `.expo/cache/eslint` if lint reports stale-cache nonsense).

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock src/lib/glass.ts
git commit -m "feat: add glass availability helper over expo-glass-effect"
```

---

### Task 2: Shrink onboarding to the single welcome step

**Files:**
- Modify: `src/services/onboarding.ts` (the `ONBOARDING_STEPS` list)
- Modify: `src/services/onboarding.test.ts`
- Delete: `src/app/onboarding/how-it-works.tsx`, `src/app/onboarding/health-note.tsx`

The route files must be deleted in this task: they call `completeAndAdvance` with step ids that stop existing, so leaving them breaks `tsc`.

**Interfaces:**
- Produces: `ONBOARDING_STEPS = [{ id: 'welcome-v1', route: '/onboarding' }]`; `OnboardingStepId = 'welcome-v1'`. `createOnboarding`, `completeAndAdvance`, `resetAndRestart`, and `OnboardingGate` keep their existing signatures untouched.

- [ ] **Step 1: Rewrite the test file for the single-step list**

Replace the full contents of `src/services/onboarding.test.ts` with:

```ts
import { describe, expect, test } from 'bun:test';

import { ONBOARDING_STEPS, createOnboarding } from './onboarding';
import { fakeStorage } from './test-helpers';

describe('createOnboarding', () => {
  test('the welcome step is pending on first launch', () => {
    const onboarding = createOnboarding(fakeStorage());
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(['welcome-v1']);
  });

  test('completing the welcome step empties pending, idempotently', () => {
    const onboarding = createOnboarding(fakeStorage());
    onboarding.completeStep('welcome-v1');
    onboarding.completeStep('welcome-v1');
    expect(onboarding.pendingSteps()).toEqual([]);
  });

  test('completion persists across instances over the same storage', () => {
    const storage = fakeStorage();
    createOnboarding(storage).completeStep('welcome-v1');
    expect(createOnboarding(storage).pendingSteps()).toEqual([]);
  });

  test('reset makes every step pending again', () => {
    const onboarding = createOnboarding(fakeStorage());
    for (const step of ONBOARDING_STEPS) onboarding.completeStep(step.id);
    onboarding.reset();
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(ONBOARDING_STEPS.map((s) => s.id));
  });

  test('corrupted persisted JSON is treated as no steps completed', () => {
    const storage = fakeStorage();
    storage.setItemSync('onboarding.completedSteps', 'not-json{');
    const onboarding = createOnboarding(storage);
    expect(onboarding.pendingSteps().map((s) => s.id)).toEqual(ONBOARDING_STEPS.map((s) => s.id));
  });
});
```

- [ ] **Step 2: Run tests to verify the first one fails**

```bash
bun test src/services/onboarding.test.ts
```

Expected: FAIL — pending list is `['welcome-v1', 'how-it-works-v1', 'health-note-v1']`, not `['welcome-v1']`.

- [ ] **Step 3: Shrink the step list**

In `src/services/onboarding.ts`, replace the `ONBOARDING_STEPS` literal (keep the doc comment above it — the versioned-step mechanism is unchanged and future permission steps append here):

```ts
export const ONBOARDING_STEPS = [
  { id: 'welcome-v1', route: '/onboarding' },
] as const satisfies readonly { id: string; route: Href }[];
```

- [ ] **Step 4: Delete the dead step routes**

```bash
rm src/app/onboarding/how-it-works.tsx src/app/onboarding/health-note.tsx
```

- [ ] **Step 5: Verify everything passes**

```bash
bun test && bunx tsc --noEmit && bun run lint
```

Expected: all pass (the deleted routes were the only consumers of the removed ids).

- [ ] **Step 6: Commit**

```bash
git add src/services/onboarding.ts src/services/onboarding.test.ts src/app/onboarding/
git commit -m "feat: collapse onboarding to a single welcome step"
```

---

### Task 3: `largeTitle` text type + FeatureRow component

**Files:**
- Modify: `src/components/themed-text.tsx` (add one entry to `typeClasses`)
- Create: `src/components/feature-row.tsx`

**Interfaces:**
- Consumes: `ThemedText` (existing), `useTheme()` from `@/hooks/use-theme` (returns the active `Colors` palette, e.g. `.primary`), `SymbolView` + `SymbolViewProps` from `expo-symbols` (Task 1 made it a direct dependency).
- Produces: `ThemedText type="largeTitle"` (34 pt bold — Apple Large Title metrics); `FeatureRow` with props `{ symbol: SymbolViewProps['name']; title: string; children: string }` — used by Task 5.

- [ ] **Step 1: Add the `largeTitle` type to ThemedText**

In `src/components/themed-text.tsx`, extend the `type` union and `typeClasses` map:

```ts
export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'largeTitle'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'link'
    | 'linkPrimary'
    | 'code';
  themeColor?: ThemeColor;
  className?: string;
};
```

and in `typeClasses`, after the `title` entry:

```ts
  largeTitle: 'text-[34px] leading-[41px] font-bold',
```

(34/41 are Apple's Large Title metrics; the existing `title` type is 48 pt and stays for the run screen.)

- [ ] **Step 2: Create FeatureRow**

```tsx
// src/components/feature-row.tsx
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

/** One tinted-symbol feature row on the onboarding welcome screen (Apple first-launch template). */
export function FeatureRow({
  symbol,
  title,
  children,
}: {
  symbol: SymbolViewProps['name'];
  title: string;
  children: string;
}) {
  const colors = useTheme();
  return (
    <View className="flex-row gap-4">
      <View className="w-10 items-center pt-1">
        <SymbolView name={symbol} size={32} tintColor={colors.primary} />
      </View>
      <View className="flex-1 gap-0.5">
        <ThemedText className="font-semibold">{title}</ThemedText>
        <ThemedText themeColor="textSecondary">{children}</ThemedText>
      </View>
    </View>
  );
}
```

No unit test: RN components have no test runtime under `bun test` in this repo; visual verification happens in Task 7.

- [ ] **Step 3: Verify types and lint**

```bash
bunx tsc --noEmit && bun run lint
```

Expected: pass. If TS rejects an Android symbol name later, the `name` prop also accepts `{ ios: ... }` alone plus the `fallback` prop.

- [ ] **Step 4: Commit**

```bash
git add src/components/themed-text.tsx src/components/feature-row.tsx
git commit -m "feat: add largeTitle text type and FeatureRow component"
```

---

### Task 4: IslandButton — the glass CTA island

**Files:**
- Create: `src/components/island/button.tsx`

**Interfaces:**
- Consumes: `isGlassAvailable()` from `@/lib/glass` (Task 1); `PrimaryButton` from `@/components/primary-button` (existing — props `{ label, onPress, testID? }`); `useTheme()`.
- Produces: `IslandButton` with props `{ label: string; onPress: () => void; testID?: string }` — used by Task 5.

- [ ] **Step 1: Create the component**

```tsx
// src/components/island/button.tsx
import { Button, Host, Text } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, font, frame, padding, tint } from '@expo/ui/swift-ui/modifiers';
import { Platform } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { useTheme } from '@/hooks/use-theme';
import { isGlassAvailable } from '@/lib/glass';

/**
 * The app's primary CTA as a system-native SwiftUI island: Liquid Glass when
 * the build supports it, bordered-prominent otherwise; the RN pill on Android
 * until the compose side of the seam lands (ADR 0005 §4). Becomes
 * `Island.Button` when the ADR 0013 island layer is fully adopted.
 */
export function IslandButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useTheme();
  if (Platform.OS !== 'ios') {
    return <PrimaryButton testID={testID} label={label} onPress={onPress} />;
  }
  return (
    <Host matchContents style={{ width: '100%' }}>
      <Button
        testID={testID}
        onPress={onPress}
        modifiers={[
          buttonStyle(isGlassAvailable() ? 'glassProminent' : 'borderedProminent'),
          controlSize('large'),
          tint(colors.primary),
        ]}>
        {/* SwiftUI sizes a button by its label — the maxWidth frame on the
            label (not the button) is what makes the capsule span the screen. */}
        <Text
          modifiers={[
            font({ textStyle: 'body', weight: 'semibold' }),
            frame({ maxWidth: 10000 }),
            padding({ vertical: 2 }),
          ]}>
          {label}
        </Text>
      </Button>
    </Host>
  );
}
```

- [ ] **Step 2: Verify types and lint**

```bash
bunx tsc --noEmit && bun run lint
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/island/button.tsx
git commit -m "feat: add IslandButton glass CTA island"
```

Contingency (checked in Task 6): if Maestro cannot see `onboarding-continue-welcome` because the child-label form swallows `testID`, switch to `<Button label={label} …/>` (drop the `Text` child and its three modifiers) and accept the intrinsic-width capsule — settings proves `testID` surfaces on `label`-form buttons.

---

### Task 5: Welcome screen composition + sheet presentation

**Files:**
- Modify: `src/components/onboarding-step-screen.tsx` (rework scaffold)
- Modify: `src/app/onboarding/index.tsx` (full rewrite)
- Modify: `src/app/_layout.tsx` (one line: onboarding presentation)

**Interfaces:**
- Consumes: `IslandButton` (Task 4), `FeatureRow` (Task 3), `ThemedText type="largeTitle"` (Task 3), `completeAndAdvance(router, id)` (existing), `useSafeAreaInsets` from `react-native-safe-area-context` (already a dependency).
- Produces: `OnboardingStepScreen` with props `{ stepId, buttonLabel, buttonTestID, footnote?: ReactNode, children }` — the scaffold future permission steps will reuse.

- [ ] **Step 1: Rework the scaffold**

Replace the full contents of `src/components/onboarding-step-screen.tsx` with:

```tsx
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IslandButton } from '@/components/island/button';
import { ThemedView } from '@/components/themed-view';
import { completeAndAdvance } from '@/services/onboarding-store';
import type { OnboardingStepId } from '@/services/onboarding';

/**
 * Shared scaffold for onboarding steps, matching Apple's first-launch welcome
 * template: scrollable content, an optional footnote block, and the advance
 * CTA pinned to the bottom of the sheet.
 */
export function OnboardingStepScreen({
  stepId,
  buttonLabel,
  buttonTestID,
  footnote,
  children,
}: {
  stepId: OnboardingStepId;
  buttonLabel: string;
  buttonTestID: string;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <ThemedView className="flex-1 px-6" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false}>
        <View className="pb-6 pt-10">{children}</View>
      </ScrollView>
      <View className="gap-5 pt-2">
        {footnote}
        <IslandButton
          testID={buttonTestID}
          label={buttonLabel}
          onPress={() => completeAndAdvance(router, stepId)}
        />
      </View>
    </ThemedView>
  );
}
```

- [ ] **Step 2: Rewrite the welcome screen**

Replace the full contents of `src/app/onboarding/index.tsx` with:

```tsx
import { SymbolView } from 'expo-symbols';
import { Image, View } from 'react-native';

import { FeatureRow } from '@/components/feature-row';
import { OnboardingStepScreen } from '@/components/onboarding-step-screen';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export default function WelcomeScreen() {
  const colors = useTheme();
  return (
    <OnboardingStepScreen
      stepId="welcome-v1"
      buttonLabel="Continue"
      buttonTestID="onboarding-continue-welcome"
      footnote={
        <View className="gap-2">
          <SymbolView
            name={{ ios: 'heart.text.square', android: 'favorite' }}
            size={20}
            tintColor={colors.primary}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Couch to 5K is designed for beginners. If you have a health condition or an old
            injury, have a quick word with your doctor before starting — and listen to your body.
          </ThemedText>
        </View>
      }>
      <Image
        source={require('@/assets/images/icon.png')}
        className="mt-6 h-[88px] w-[88px] self-center rounded-[20px]"
        style={{ borderCurve: 'continuous' }}
      />
      <View className="pt-9">
        <ThemedText type="largeTitle" themeColor="primary">
          Welcome to
        </ThemedText>
        <ThemedText type="largeTitle">My Runner</ThemedText>
      </View>
      <View className="gap-6 pt-7">
        <FeatureRow symbol={{ ios: 'figure.run', android: 'directions_run' }} title="From Couch to 5 km">
          Three short sessions a week for nine weeks — walking at first, running 30 minutes
          straight by the end.
        </FeatureRow>
        <FeatureRow symbol={{ ios: 'timer', android: 'timer' }} title="Guided Intervals">
          The app times every walk and run and tells you exactly when to switch.
        </FeatureRow>
        <FeatureRow symbol={{ ios: 'lock.fill', android: 'lock' }} title="Private and Free">
          No account, no ads, no tracking — everything stays on your phone.
        </FeatureRow>
      </View>
    </OnboardingStepScreen>
  );
}
```

Contingency: this is the repo's first asset `require()` through the alias — if Metro fails to resolve `@/assets/images/icon.png` at runtime, use the relative path `../../../assets/images/icon.png` instead.

- [ ] **Step 3: Switch the onboarding presentation to the sheet look**

In `src/app/_layout.tsx`, change the onboarding screen registration to:

```tsx
<Stack.Screen name="onboarding" options={{ presentation: 'modal', gestureEnabled: false }} />
```

(`'modal'` = iOS pageSheet: rounded top corners with the status bar visible above the card. `gestureEnabled: false` keeps it non-dismissible; the run/run-summary screens keep `fullScreenModal`.)

- [ ] **Step 4: Verify the suite**

```bash
bun test && bunx tsc --noEmit && bun run lint
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/onboarding-step-screen.tsx src/app/onboarding/index.tsx src/app/_layout.tsx
git commit -m "feat: Apple-style onboarding welcome screen as pageSheet"
```

---

### Task 6: Update Maestro flows and run them

**Files:**
- Modify: `.maestro/helpers/complete-onboarding.yaml`
- Verify (no change expected): `.maestro/01-onboarding.yaml`

**Interfaces:**
- Consumes: testIDs `onboarding-continue-welcome` (Task 5) and `plan-row-w1d1` (existing plan list).

Prerequisites: booted iOS simulator with the app built (`bun run ios`) and Metro on 8087 — same setup as Task 7; run these two tasks in one session.

- [ ] **Step 1: Shrink the helper to the single step**

Replace the full contents of `.maestro/helpers/complete-onboarding.yaml` with:

```yaml
appId: se.lukaslindqvist.myrunner
---
- assertVisible:
    id: "onboarding-continue-welcome"
- tapOn:
    id: "onboarding-continue-welcome"
- assertVisible:
    id: "plan-row-w1d1"
```

- [ ] **Step 2: Run the onboarding flow**

Via the Maestro MCP (`list_devices` → `run` with `files: [".maestro/01-onboarding.yaml"]`) or:

```bash
maestro test .maestro/01-onboarding.yaml
```

Expected: PASS. If `tapOn` cannot find `onboarding-continue-welcome`, apply the Task 4 contingency (label-form Button) and re-run.

- [ ] **Step 3: Commit**

```bash
git add .maestro/helpers/complete-onboarding.yaml
git commit -m "test: single-step onboarding Maestro flow"
```

- [ ] **Step 4 (pre-merge, after Task 7 passes): full suite**

```bash
maestro test .maestro/
```

Expected: all flows PASS (repo policy for changes under `src/`).

---

### Task 7: Simulator verification against the references

No file changes — runtime evidence only. Load the repo `verify` skill (or `argent-ios-simulator-setup` + `argent-device-interact` + `argent-test-ui-flow`) and drive the iOS simulator via argent MCP tools (never `xcrun simctl` directly).

- [ ] **Step 1: Launch and reach onboarding fresh**

Boot the simulator, start the app (dev client, Metro 8087). Onboarding auto-appears on a cleared install; otherwise Settings → Developer → "Reset onboarding".

- [ ] **Step 2: Light-mode comparison**

Screenshot the welcome screen in light mode. Check against the Journal reference: pageSheet rounded corners with status bar above; centered rounded icon; two-line title ("Welcome to" in blue `#3c87f7`, "My Runner" in black); three feature rows with blue symbols; footnote block; full-width tinted glass Continue at the bottom.

- [ ] **Step 3: Dark-mode comparison**

Switch appearance (`xcrun simctl ui <udid> appearance dark` is acceptable — device option, not interaction), re-screenshot, and check tokens flipped (white text on near-black, secondary gray legible) against the Apple Games reference. Flag pure-black background to the user if it reads wrong vs the reference — spec leaves that judgment to this step.

- [ ] **Step 4: Glass + fallback sanity**

On the iOS 26 simulator confirm the Continue button renders Liquid Glass (translucent tinted capsule, not flat). Tap it: onboarding dismisses to tabs, and relaunching does not re-show onboarding.

- [ ] **Step 5: Small-device scroll check**

On a small simulator profile (e.g. iPhone SE class) confirm content scrolls and the footnote + button stay pinned without clipping.

- [ ] **Step 6: Android sanity check (secondary)**

On the Android emulator: welcome renders, symbols show (or `fallback` hides gracefully), Continue is the RN pill, flow completes. Defer to a follow-up only if no emulator is available — note it to the user.

- [ ] **Step 7: Report**

Present before/after screenshots (light + dark) to the user alongside the two references for sign-off.
