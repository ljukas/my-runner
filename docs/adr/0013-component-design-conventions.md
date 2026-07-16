# 13. Component design: variant-carrying primitives and compound modules

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0018](0018-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-12

## Status

Accepted

## Context

Stage 1 shipped its screens without a component convention. An architecture
review of the view layer (2026-07-12, run with the `improve-codebase-architecture`
skill against the PR #20 branch) found the predictable result:

- **Shallow modules.** `ThemedText` exposes an interface (`type` ×
  `themeColor` × `className`) as wide as the two lookup tables it hides;
  `ThemedView` fails the deletion test outright — deleting it moves nothing
  but a `bg-background` class to call sites. Both restate the palette that
  `global.css` and `constants/theme.ts` already carry, bringing the count of
  palette restatements to five when ADRs 0002/0005 budget for a two-way sync.
- **Single-purpose components where variants belong.** `PrimaryButton`
  hardcodes one look (`bg-primary` + `text-white`, the latter outside the
  token system entirely); a second, unrelated "primary button" lives as a
  copy-pasted SwiftUI modifier stack (`buttonStyle('borderedProminent')` +
  `tint`) in two screens. "The primary button" is two implementations with
  no shared seam.
- **An unnamed seam.** ADR 0005's RN↔SwiftUI island boundary exists only as
  prose: `Host` is spelled three different ways across six screens, every
  SwiftUI `Text` threads `useTheme()` + `foregroundColor(colors.…)` by hand,
  and the settings `Toggle`'s testID quirk (id spans the merged row, so taps
  no-op) is documented in a Maestro YAML comment and worked around with a
  coordinate tap instead of being owned by a component.
- **Concepts without modules.** The "labeled stat row" is implemented three
  times in two vocabularies, one copy trapped as a file-local helper inside a
  route file.

The convention below is modeled on how shadcn/ui and Radix design components:
open, copy-owned component code; variants declared with `cva` and typed with
`VariantProps`; caller `className` merged conflict-safely; multi-part
components as compound namespaces wired by context. Verified against current
shadcn/ui sources and the Uniwind docs (whose FAQ prescribes exactly the
shadcn `cn()` = clsx + tailwind-merge pattern; Tailwind's compiler constraint
— complete class names statically present in source — is satisfied by cva's
static variant maps).

Constraints carried in from prior ADRs, not re-litigated here: Uniwind
`className` styling for all RN-rendered UI (ADR 0002); system-native product
screens as `@expo/ui` SwiftUI islands with the `Colors` mirror as the theming
bridge (ADR 0005); every SwiftUI element a Maestro flow touches carries a
`testID` (ADRs 0001/0005).

## Decision

### 1. Three component layers

```
src/lib/cn.ts             clsx + tailwind-merge helper
src/components/ui/        style primitives   (Button, Text, …)
src/components/island/    the @expo/ui seam  (Island, Island.Text, …)
src/components/           domain components  (SegmentBar, StatList, SettingsToggle, …)
src/app/                  screens — compose only, never define components
```

- **`ui/` primitives** carry cva variants and know nothing about the app's
  domain, stores, or services. They are pure: props in, styled RN primitives
  out.
- **`island/` modules** are the one place the `@expo/ui` SwiftUI vocabulary
  is wrapped: `Island` (the `Host` wrapper, one spelling), `Island.Text`,
  `Island.Label`, `Island.Button` (the `borderedProminent` stack, named
  once). They thread the `Colors` mirror internally so screens stop
  hand-plumbing `useTheme()` into modifier arrays. ADR 0005 §4's Android
  fork then edits this seam, not six screens. Screens that are pure SwiftUI
  islands may still import `@expo/ui` directly for layout vocabulary
  (`VStack`, `Section`, …); the island modules exist to name the *repeated*
  idioms, not to proxy the entire library.
- **Domain components** (root of `src/components/`) name app concepts. They
  may compose either side of the island seam and — unlike `ui/` — may bind
  stores/services (`SettingsToggle` binds `settings-store`;
  `OnboardingStepScreen` keeps its `completeAndAdvance` wiring).
- **Screens compose.** A screen never defines a file-local component; the
  moment one wants to exist, it is promoted (the session sheet's private
  `StatRow` is the standing example).

### 2. Authoring format for `ui/` primitives

The shadcn recipe, adapted to React Native:

```tsx
// src/components/ui/button.tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { Pressable, type PressableProps } from 'react-native';

import { cn } from '@/lib/cn';
import { Text } from '@/components/ui/text';

export const buttonVariants = cva('items-center justify-center rounded-full', {
  variants: {
    variant: {
      primary: 'bg-primary',
      secondary: 'bg-background-element',
      destructive: 'bg-destructive',
      ghost: 'bg-transparent',
    },
    size: {
      default: 'py-4 px-6',
      sm: 'py-2 px-4',
    },
  },
  defaultVariants: { variant: 'primary', size: 'default' },
});

// RN text does not inherit color from its container (unlike CSS), so the
// label carries its own variant map, keyed by the same axis.
const buttonTextVariants = cva('', {
  variants: {
    variant: {
      primary: 'text-primary-foreground',
      secondary: 'text-foreground',
      destructive: 'text-destructive-foreground',
      ghost: 'text-primary',
    },
  },
  defaultVariants: { variant: 'primary' },
});

export type ButtonProps = PressableProps &
  VariantProps<typeof buttonVariants> & { label: string };

export function Button({ className, variant, size, label, ...props }: ButtonProps) {
  return (
    <Pressable className={cn(buttonVariants({ variant, size }), className)} {...props}>
      <Text className={cn(buttonTextVariants({ variant }))}>{label}</Text>
    </Pressable>
  );
}
```

Rules, in decreasing order of load-bearing-ness:

- **Variants via `cva`, typed via `VariantProps`, merged via `cn()`** —
  caller `className` is merged **last** so it reliably wins
  (tailwind-merge resolves conflicts; plain template concat is the bug class
  this replaces). Every component exports itself *and* its `xVariants`.
- **Primitives reuse the React Native names.** Screens import `Text` and
  `Button` from `@/components/ui/*`; RN's `Text` and `Pressable` appear only
  inside `src/components/`. Layout primitives (`View`, `ScrollView`, …) are
  fine anywhere with `className` — deleting `ThemedView` depends on that.
  (An ESLint `no-restricted-imports` rule is the designated enforcement if
  discipline slips.)
- **Variant axes use shadcn-style names:** `variant`
  (`primary | secondary | destructive | ghost`), `size` (`default | sm | lg`),
  and `tone` for Text color (`default | secondary`). We deviate from
  shadcn's `variant: "default"` in favor of the self-documenting `primary`.
- **Plain functions, props spread, React 19 ref-as-prop.** No `forwardRef`,
  no class components, kebab-case files, one component family per file.
- **`testID` is part of every interactive primitive's interface** and is
  placed on the actually-tappable element.
- **No `asChild`/Slot for now** — RN has no official Slot primitive, and
  expo-router's `<Link asChild>` covers the case that matters. Recorded as
  an explicit deferral; revisit if a second real polymorphism case appears.

### 3. Compound components

Multi-part components are **dot-notation namespaces** — the Radix shape, which
reads as a domain vocabulary at call sites:

```tsx
<RadioToggle.Group value={plan} onValueChange={setPlan}>
  <RadioToggle.Item value="nhs" label="NHS plan" />
  <RadioToggle.Item value="compressed" label="Compressed" />
</RadioToggle.Group>
```

- Authored as separate functions, exported once:
  `export const RadioToggle = { Group: RadioToggleGroup, Item: RadioToggleItem }`
  (or `Object.assign(Root, { Part })` when the root itself renders, as with
  `Island`).
- Parts that share state are wired through **internal React context**
  (Radix model). Callers never thread group state into items by hand.
- Compound parts follow the same cva/cn/testID rules as primitives.

### 4. Tokens: the paired-foreground rule

- Any surface color a component renders content on gets a `-foreground`
  partner: `bg-primary` pairs with `text-primary-foreground`. Seeded now
  with `primary-foreground` and `destructive`/`destructive-foreground`;
  further pairs are added **on demand**, not speculatively.
- **Raw palette classes (`text-white`, hex values) never appear outside
  `ui/`.** `island/` reads the `Colors` mirror (the ADR 0005 bridge).
  Variant recipes therefore read as semantics
  (`bg-destructive text-destructive-foreground`), and the one
  contrast-critical color that was hardcoded (`text-white` on the CTA)
  enters the `global.css` ↔ `theme.ts` sync system.
- Deleting `ThemedText`/`ThemedView`'s class maps returns the palette to the
  three restatements the ADRs budget for (`global.css`, `Colors`,
  `SegmentColors`).

### 5. Staged adoption — separate PRs, in order

1. **This ADR** (docs-only).
2. After PR #20 merges: **`ui/` primitives + tokens** — `lib/cn.ts`,
   `ui/text.tsx`, `ui/button.tsx`, the token pairs; delete `ThemedView`,
   `ThemedText`, `PrimaryButton` and migrate call sites. Adds the three
   deps (`class-variance-authority`, `clsx`, `tailwind-merge` — all pure JS).
3. **Island module set + `SettingsToggle`** — touches all six screens;
   `SettingsToggle` needs the on-device testID iteration deferred from the
   Stage-1 cleanup before the Maestro coordinate tap can be retired.
4. **`StatList.Row`** — opportunistically, when a task next touches those
   rows.

Stage 2 builds on the convention from day one. Each PR re-runs the full
Maestro suite (ADR 0001 policy).

## Consequences

- Call sites read as a design system: `<Button variant="destructive" …>`
  instead of a bespoke component per look; a new look is a variant entry,
  not a new file.
- The `cn()` merge makes caller overrides deterministic — the current
  silent-conflict class (`ThemedText` concat) goes away.
- Three small pure-JS dependencies enter in adoption PR ② — consistent with
  the official-tooling posture (they are the exact stack both shadcn and the
  Uniwind docs prescribe), but they are dependencies nonetheless.
- The import-discipline rule ("no raw RN `Text`/`Pressable` in screens") is
  convention-enforced only until a lint rule lands; drift is possible and
  cheap to correct.
- Two UI vocabularies remain (ADR 0005), but both now have named modules;
  "how do I build a screen here" is answerable from `src/components/`'s
  directory listing instead of by reading six screens.
- The SwiftUI islands stay invisible to RN unit tests; the convention keeps
  `ui/` primitives pure so they *are* unit-testable, and keeps testIDs on
  tappable elements so Maestro flows stay geometry-free (the settings
  coordinate tap is retired in PR ③).
- `CONTEXT.md` now carries the view-layer glossary (island, primitive,
  domain component, token pair) so future architecture reviews and sessions
  use these names.

## Alternatives considered

- **`tailwind-variants` (`tv()`)** — one dep instead of three, built-in
  merge, slots. Rejected: not what shadcn itself uses, and its slots
  feature overlaps with the compound-component pattern we standardize
  anyway.
- **Hand-rolled typed variant maps** (the `ThemedText` status quo) — zero
  deps. Rejected: no conflict-safe merging, no compound variants, every
  component reinvents the plumbing; this is the pattern the review flagged
  as shallow.
- **Flat prefixed exports (shadcn-literal: `CardHeader`)** — rejected in
  favor of Radix dot-notation; the compound reads as a domain vocabulary
  (`RadioToggle.Group`), which was the explicit design goal.
- **Distinct component names (`AppText`, `AppButton`)** — rejected: the
  design-system primitive should be the default vocabulary; an import path
  disambiguates.
- **Full shadcn token palette up front** (muted, accent, card, ring, …) —
  rejected: most tokens unused in a five-screen MVP and the manual
  `global.css` ↔ `theme.ts` sync surface would double. The paired rule
  grows the palette on demand.
- **`@rn-primitives/slot` for `asChild`** — rejected for now: a third-party
  dep for a polymorphism need we have not hit; expo-router's `Link asChild`
  covers the real case.
- **A full RN component kit (Tamagui, gluestack, react-native-reusables)** —
  rejected: conflicts with the system-native @expo/ui direction (ADR 0005)
  and the official-tooling posture; react-native-reusables remains useful
  as prior art for individual component recipes.
