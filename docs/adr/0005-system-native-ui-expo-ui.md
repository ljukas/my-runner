# 5. System-native UI via @expo/ui SwiftUI islands

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0020](0020-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-11

## Status

Accepted

## Context

The C25K design spec (§8) renders most product screens with system-native
components: SwiftUI `List`/`Form` for Plan, History, and Settings, `Gauge` and
rolling-digit countdowns on the run screen, `ContentUnavailableView` empty
states, glass buttons. AGENTS.md prefers Expo-official packages, and the
repo already ships `@expo/ui` ~57.0.4, `expo-glass-effect`, `expo-symbols`,
and `NativeTabs`. The open questions were whether this bet is sound — and
they were the riskiest in the spec, because they collide with two prior
decisions: E2E-from-Stage-1 (ADR 0001) and Android-later (ADR 0003).

Research findings (verified 2026-07-11 against the installed `@expo/ui`
57.0.4 source unless noted):

- **Stability:** Expo UI is officially stable since SDK 56
  ([expo.dev/blog/expo-ui-stable-sdk-56](https://expo.dev/blog/expo-ui-stable-sdk-56)).
- **Inventory:** every component the spec's screens name exists in the
  `swift-ui` entry point: `List`, `Section`, `Form`, `LabeledContent`,
  `Gauge`, `ProgressView`, `ContentUnavailableView`, `Text`,
  `HStack`/`VStack`, `Image`, `GlassEffectContainer`, plus a large modifier
  registry.
- **E2E compatibility (the ADR-0001 collision) is resolved in source:**
  `testID` is a common prop on *every* SwiftUI view
  (`CommonViewModifierProps`, documented "Used to locate this view in
  end-to-end tests") and maps directly to SwiftUI's `accessibilityIdentifier`
  (`View+AccessibilityModifiers.swift`); Maestro's `id:` selector matches
  accessibility IDs. `accessibilityLabel`/`Hint`/`Value` modifiers also exist.
- **Theming hooks:** `Host` exposes `colorScheme: 'light' | 'dark'` and
  `seedColor`; color modifiers accept raw color values.
- **Interop:** React Native children can be embedded inside SwiftUI
  (`RNHostView`, `matchContents`), and the official guide's guidance is to
  keep SwiftUI layouts self-contained with clearly defined boundaries.
- **Android is a parallel vocabulary, not a recompile:** the
  `jetpack-compose` entry point ships *different*, Material 3 components
  (`Card`, `LazyColumn`, `NavigationBar`, `Snackbar`…). Since SDK 56 a
  *universal* layer (root `@expo/ui` import) additionally maps a set of
  common primitives to the right platform implementation with no JS
  fallback — but the SwiftUI-specific vocabulary the spec leans on is
  iOS-only view code.

## Decision

**Product screens are system-native first, rendered as `@expo/ui` SwiftUI
islands inside `Host`, with React Native shells around them.** Per-screen
assignment follows spec §8 (Plan, pre-run sheet, summary stats, History,
Settings mostly SwiftUI; active-run screen hybrid; `RouteMap` an RN island).

1. **Boundary rules.** One visual system per block — never alternate RN and
   SwiftUI text/controls within the same visual cluster. SwiftUI islands are
   self-contained subtrees; RN embedded inside SwiftUI only through coarse
   `RNHostView` boundaries, and **never per-row inside a SwiftUI `List`**
   (hence no map thumbnails in the v1 History list).
   - *Realized 2026-07-14 (run screen):* two elements are the first concrete
     `RNHostView` boundaries — `number-flow-react-native`'s `SkiaTimeFlow`
     countdown (a Skia `Canvas`, edge-fade digit roll) and a Reanimated progress
     bar — while the phase label, phase-icon, and transport buttons stay SwiftUI.
     This is the sanctioned "mix on one screen" pattern: keep the SwiftUI
     `VStack` and swap only the elements an RN renderer earns; *coarse* per-element
     boundaries, not per-glyph mixing. Why the bar went RN: the SwiftUI `Gauge`
     needed a per-segment `key` remount to reset its fill without a backward
     sweep, and that remount bounced the centred layout on every segment change;
     the Reanimated bar resets imperatively (no remount → no shift) and gives a
     smoother `withTiming` fill. Gotchas found on-device: (a) each hosted RN tree
     needs a plain RN `View` at its root — a bare RN/Skia leaf as the *direct*
     `RNHostView` child mounts and measures but never paints; (b) a SwiftUI
     `testID` cannot reach into a hosted RN subtree, so each side must declare its
     own accessibility identity — the icon-only transport controls carry a SwiftUI
     `accessibilityLabel` (doubling as the Maestro text selector, ADR 0016) and the
     Skia canvas carries an RN one on its wrapper `View` for VoiceOver (*narrowed
     2026-07-28:* this clause also claimed hosted RN was opaque to the AX tree,
     which the reachability rule below corrects — and which the wrapper label it
     prescribes always presupposed); (c) SF Symbols render at slightly different heights at
     the same point size, so a centred phase icon+label wobbles the whole
     Spacer-centred column a few px per segment — the phase-label block is given a
     fixed `frame({ height })` to hold the layout still.
   - *Realized 2026-07-27, narrowed 2026-07-28 (the accessibility seam):* **RN that
     OVERLAPS a Host loses its accessibility identity; RN merely laid out beside one
     keeps it.** Observed on an iOS 26.5 simulator against the hierarchy VoiceOver
     and Maestro's `inspect_screen` read — *not* argent's a11y bridge, which
     AGENTS.md records as blind to every island screen in this app. An absolutely
     positioned RN `Pressable` stacked over a screen-covering
     `Island useViewportSizeMeasurement` painted and took a coordinate tap while
     being **absent** from that hierarchy — a real VoiceOver defect, and the same
     shape as the run summary's RN "Done" that painted and tapped while unfindable
     beneath a lingering form sheet (`session/[key].tsx:63-67`).

     **The first draft of this note blamed siblinghood, and shipped code falsifies
     that.** `runs/[runId]/index.tsx:81-99` lays an RN `ScrollView` beside
     `Footer → Island.Button fill "Done"` — a real Host — and CI-gated flows assert
     the RN strings inside it on that very screen (`run-distance.yaml:42-43`
     "Distance"/"Avg Pace"; `complete-session.yaml` "Nice work.*", "Warm Up"),
     while `segment-breakdown.tsx` records VoiceOver already speaking its RN legend.
     `session/[key].tsx` is the same shape. Non-overlapping RN siblings are
     therefore fine; **z-order over a Host is the hazard.**

     The rule that follows: **RN owns the screen root and SwiftUI goes into it as
     islands, sized to their content and laid out in flow.** Do not stack RN over a
     Host, and prefer several content-sized islands to one screen-covering one — a
     viewport-sized Island makes every RN sibling an overlap risk by construction,
     which is why the run screen was inverted. A screen that is *nothing but* an
     Island is fine where it renders no RN at all: Plan, Log and Settings are
     pure-SwiftUI leaves and stay that way, since giving Settings RN ownership at
     the row level — RN rows with SwiftUI controls inside them — would force a Host
     per row, which ADR 0005 §1 already forbids.
   - *Realized 2026-07-27 (native chrome vs. the CTA block):* `Stack.Toolbar` is
     for header and quick actions — the run-summary header's `xmark` is its only
     remaining use — and **not** for a screen's primary call to action. It was
     tried for CTA blocks and rejected: it is one self-sizing row,
     `StackToolbarViewProps` exposes no height control, it clipped a stacked
     secondary CTA, and it floats over content instead of participating in layout.
     A pinned CTA block is therefore ordinary RN — `ui/Footer`, which reserves its
     own space so nothing underneath needs clearance — with `Island.View` hosting a
     stacked pair of `Island.Button inline fill` inside **one** Host, so the gap
     between them is SwiftUI spacing rather than an RN gap between two Hosts. A
     lone CTA stays a standalone `Island.Button fill`. The components themselves
     follow ADR 0013.
2. **E2E rule.** Every SwiftUI element a Maestro flow taps or asserts carries
   a `testID`; flows match on `id:` (falling back to visible text where
   natural). The source-level mapping is verified; **Stage 1's exit criteria
   include confirming on-device that these IDs resolve in the real
   accessibility hierarchy** (SwiftUI can group children into one
   accessibility element — put IDs on the interactive element, author flows
   from `inspect_screen`, not guesses).
3. **Theming bridge.** SwiftUI trees take colors from the `Colors` mirror in
   `src/constants/theme.ts` via `Host` `seedColor`/`colorScheme` and color
   modifiers. `global.css` remains the styling source of truth for RN
   (ADR 0002); the mirror must stay in sync — now serving both its original
   JS consumers and every SwiftUI island.
4. **Android posture (decided now, built later).** SwiftUI-vocabulary screens
   are iOS-only *view* code. Screens therefore keep logic out of the view
   layer — engine subscriptions, live queries, and formatting come from
   shared hooks/`domain/` — so the Android pass forks only views:
   `jetpack-compose` (or universal-layer) variants where native feel earns
   it, RN + Uniwind otherwise, selected per screen with the ADR 0003 fork
   mechanics.
5. **Per-screen fallback.** Every screen remains an expo-router route
   regardless of what renders inside it, so any screen can drop to
   RN + Uniwind without touching navigation — @expo/ui adoption is reversible
   screen-by-screen, not app-wide.

## Consequences

- Native fidelity — real list/form behaviors, dynamic type, dark mode, and
  platform accessibility — comes from the platform rather than from styling
  effort. This is the product's differentiator against paid C25K apps.
- The ADR 0001 collision is retired at the source level; what remains is the
  cheap on-device confirmation folded into Stage 1's E2E exit criteria.
- Two UI vocabularies coexist in the codebase. The boundary rules contain
  the mixing cost, but contributors must know both idioms.
- The palette now has three consumer paths (Uniwind classes, `Colors` →
  SwiftUI, raw JS values). The manual `global.css` ↔ `theme.ts` sync from
  ADR 0002 becomes more load-bearing; a codegen step is the designated
  follow-up if drift bites.
- Android v1 parity is honestly priced: a second view-layer implementation
  per screen, budgeted by keeping views logic-free. It is *not* blocked —
  the universal layer and Compose entry point are already in the installed
  package.
- SwiftUI islands are invisible to RN unit-testing tools; screen correctness
  rides on Maestro flows (ADR 0001) plus the engine's unit tests. This was
  already the testing split chosen in ADR 0003.
- Version pinned (~57.0.4); component availability is verified against the
  installed source, not docs, when in doubt.

## Alternatives considered

- **Pure RN + Uniwind everywhere** — one vocabulary, cheapest Android story.
  Rejected for v1's core screens: recreating native list/form/sheet fidelity
  in styled RN is exactly the effort treadmill the system-UI bet avoids, and
  the per-screen fallback keeps this option open where SwiftUI disappoints.
- **Community native-look component kits** — rejected outright: against the
  official-tooling policy, and @expo/ui now ships official drop-in
  replacements for most of that niche.
- **Full SwiftUI app shell** (SwiftUI `TabView`/navigation) — rejected:
  navigation belongs to expo-router (spec §8; forthcoming ADR 0006), and
  fighting the router with a second navigation owner is the known failure
  mode of maximal SwiftUI adoption.
- **Defer @expo/ui until the Android pass** — rejected: v1 is iOS-first by
  decision, and deferral trades the product's fidelity goal for a parity
  problem v1 does not have.
