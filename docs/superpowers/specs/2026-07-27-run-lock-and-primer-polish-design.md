# Run Lock & Primer Polish — Design Spec

**Date:** 2026-07-27
**Status:** Implemented with exceptions (see §3's outstanding copy rows and §6) —
amended 2026-07-28 to describe the shipped code
**References:** Apple Health feature-intro sheets ("Shared Passwords and Passkeys",
"Blood Pressure Log", "Support Your Mental Wellbeing", "Test Your Hearing"),
provided as screenshots 2026-07-27

> **Three things changed during implementation.** The sections below are amended
> rather than left as designed, and each delta is marked *Shipped*.
> **(1) The forced-awake path is gone** — the display is held awake *only* while
> locked (`{locked ? <KeepAwakeWhileMounted /> : null}`), and the run-screen
> banner shortened to "Distance and pace unavailable.", mentioning neither cues
> nor the screen. **(2) The unlock shipped at fallback tier 3** (pure SwiftUI
> `onLongPressGesture`), so there is no progress ring, and the hold constant is
> **seconds** — `UNLOCK_HOLD_SECONDS = 1.2` — not milliseconds. **(3) The lock
> sits below the stats, centred**, not top-right. §1 and every decisions-log row
> left unmarked record the situation as it stood on 2026-07-27.

## 1. Overview

Two changes that touch the same files and the same story about what the app does
while you are actually running.

**The run lock.** `keepScreenAwake` today is a Settings toggle
(`src/app/(tabs)/settings/index.tsx:37`), default on
(`src/services/settings.ts:24`), whose purpose is unclear from where it sits: it
was added when audio cues needed the screen on, and background location (ADR
0008) has since made that premise false. It is replaced by a **per-run lock
button on the run screen** that both holds the display awake and makes the
transport controls inert — one control for one situation, "I am putting this
phone in my pocket and running".

**Primer polish.** The two permission/feature primers adopt the metrics of
Apple's feature-intro sheet template, which is what they actually are. The
first-launch welcome screen keeps the Games/Journal welcome metrics that
[the 2026-07-13 onboarding spec](2026-07-13-apple-style-onboarding-design.md)
chose for it.

### Why the lock survives when the setting did not

Three jobs were attached to `keepScreenAwake`. Background location retired two
of them and cannot retire the third:

| Job | Status |
|---|---|
| Audio cues keep playing | **Retired.** Location heartbeat (ADR 0008) plus `shouldPlayInBackground` keep cues audible with the screen off and the phone locked. |
| Glanceability | **Narrow.** Treadmill/handheld only, and ADR 0022's Live Activity is designed to serve it from the Lock Screen. |
| **Haptic cue accents** | **Permanent.** iOS plays haptics only for the foreground-active app. Screen-on is the only switch that exists for this channel. |

The haptic exclusion is a platform rule, not a configuration gap. Apple's
position on `UIFeedbackGenerator`: *"It is currently expected behavior that using
the UIFeedbackGenerator API will not produce haptics when your app is not in the
foreground active state"* — and the same guidance confirms that enabling a
background mode does not grant eligibility. Core Haptics behaves the same way:
backgrounding invokes the engine's `stoppedHandler` with the
`applicationSuspended` reason, tearing the engine down rather than muting it.
Both channels Pulsar uses are therefore closed while backgrounded, which makes
the `AppState.currentState === 'active'` guard at
`src/services/cue-service/adapter.ios.ts:78` an accurate statement of the
platform contract rather than a conservative one.

Background location grants **process liveness**. From liveness an app inherits
only those capabilities holding their own background entitlement — audio has one,
which is why cues survive; haptics have none, so no amount of liveness reaches
them. The gate is not "are you running", it is "are you the app the user is
looking at".

### Decisions log (agreed 2026-07-27)

| Topic | Decision |
|---|---|
| Control identity | One **lock**, not a screen-awake toggle: locked = display held awake **and** transport controls inert. Merging them is what makes the padlock icon correct rather than borrowed — it names the user's situation, not the mechanism |
| Placement | Run screen only, apart from the transport row. Settings' **Display** section is deleted. *Shipped:* centred **below the stats** rather than top-right, on its own line, so the "Hold to unlock" caption can appear under it without crowding the metrics |
| Icon | `lock.open.display` → `lock.display`. Literal, and the touch-lock half resolves the collision with the Nike Run Club / Apple Fitness padlock convention |
| Lifetime | **Per-run, not persisted.** A lock is a mode, not a preference. Every run — including a resumed one — starts unlocked. `keepScreenAwake` is deleted from settings entirely |
| Default | Unlocked. The flagship scenario (spec §6) is a pocketed locked phone, where screen-on is pure battery waste |
| Lock gesture | Plain tap. Entering a safe state needs no ceremony |
| Unlock gesture | **Press and hold 1.2 s** (Apple Watch Water Lock deliberateness). Asymmetric on purpose: only leaving a safe state needs ceremony. *Shipped:* §2.5 tier 3, so **no progress ring** — a `symbolEffect` pulse plus the "Hold to unlock" caption carries the affordance |
| Forced-awake path | ~~Independent of the lock: with location not granted the display is held awake regardless~~ — **dropped before merge.** A forced screen-on run spends battery the runner never agreed to, and the lock is the honest place to offer that trade instead. The display is held awake only while locked; ADR 0008 §5 now carries the resulting honesty gap as a **named open risk** |
| Durable explanation | Settings **Coaching** footer — where a user wondering *why don't I feel the buzz* would look |
| Primer scoping | The two primers only (`audio-cues`, `location-primer`); the welcome screen keeps its own template |
| Recording | Amend the master spec; no new ADR. ~~ADRs 0008 §5 and 0009 §7 stay true and gain the lock as their mechanism~~ — *this is the prediction that failed: 0009 §7's mechanism and 0008 §5's whole degraded mode both needed rewriting (see §5). No supersede either way* |

## 2. The run lock

### 2.1 States

| | Display | Touches | Haptic cues | Audio cues |
|---|---|---|---|---|
| **Unlocked** (default) | sleeps on the system's schedule | live | none once asleep | continue via the location heartbeat — *only with location granted* |
| **Locked** | held awake | inert | **live for as long as the lock is on** | continue |

Unlocked is the pocket run: let it sleep, listen. Locked is the opt-in that buys
the haptic channel, paid for with the display — and it earns that cost by making
a pocketed screen-on phone safe from an accidental Pause, which is the reason a
screen-on pocket run was uncomfortable in the first place.

The audio-cues column has one exception the shipped build does not cover. With
location denied there is no background heartbeat, so an unlocked run loses the
coach the moment the display sleeps; nothing forces the display awake for it (see
the dropped forced-awake row above) and the banner does not mention it. ADR 0008
§5 carries that as an open risk rather than this spec resolving it.

### 2.2 One rule

```
display held awake  =  locked
touches locked      =  locked
```

*Amended 2026-07-28.* This was designed as two rules, the first reading
`locked || location !== 'granted'` so a location-denied run could not lose its
cues to a sleeping screen. **That second term was dropped before merge:** it is
the app spending the runner's battery on a decision the runner never made, and
the lock is the honest place to offer that trade instead. The lock is now the
sole input to both rules, and the run-screen banner reports only what is
measurably lost — "Distance and pace unavailable." The cost of dropping the term
is recorded as a named open risk in ADR 0008's Consequences, not absorbed here.

### 2.3 Composition

`KeepAwakeWhileMounted` (`src/app/run.tsx:44`) is unchanged — `useKeepAwake`
takes no enabled argument, so conditionality is expressed by mounting, and that
remains the correct shape. What drives it is the lock alone:
`{locked ? <KeepAwakeWhileMounted /> : null}`.

Locking is applied by putting `disabled(locked)` on every interactive element
except the lock itself: the End / Pause / Skip buttons and the location banner's
CTA. SwiftUI's native dimming of a disabled control *is* the "you are locked"
feedback, so no overlay is drawn and no hit-testing is intercepted. The run
screen is already `gestureEnabled: false` (`src/app/_layout.tsx:96`), so
swipe-dismissal needs no further work.

***Shipped: `disabled` is a prop on both island buttons.*** This section
originally asserted that `Island.IconButton` gains no new props, which was
unsatisfiable next to the requirement above — neither island button exposes a
`modifiers` escape hatch, so `disabled(locked)` had nowhere to go. Both
`Island.IconButton` and `Island.Button` therefore take `disabled`, defaulting to
`false`, and apply the modifier themselves (only the icon button gained it here;
the location CTA had already made it a prop on `Island.Button`). The icon button
additionally dims itself by hand: its explicit glyph `color` reaches SwiftUI as a
`foregroundStyle` that outranks the disabled rendering, so the modifier alone
would leave a disabled control looking live. The lock stays a distinct component
(§2.5) because it carries a gesture the plain icon button should not learn about,
and it is outside the disabled set simply by never being passed the prop.

**Lifetime.** Locked state lives and dies with the run screen. A run that
completes while locked still navigates to the summary (`run.tsx:74-79`) — that is
programmatic, not a touch — and the summary is never locked, with the display
returning to the system's schedule as the run screen unmounts.

**One honest limit.** `useKeepAwake` suppresses *auto*-lock only. A user who locks
the run and then presses the side button still backgrounds the app, and haptics
stop there as they would anywhere else. The lock buys the haptic channel against
the screen timing out, not against the user deliberately switching the phone off.

### 2.4 Unlock: two clocks, on purpose

> *Moot as shipped, retained as a constraint.* Tier 3 (§2.5) has no ring, so
> there is only the recognizer's clock and nothing to keep separate. Everything
> below binds again the moment anyone adds a progress ring. Note the units differ
> per tier: RNGH's `minDuration` below is **milliseconds**; the SwiftUI modifier
> that shipped takes **seconds**.

The unlock is gated by the gesture recognizer's own duration and the ring is
decoration driven separately. They must not share a clock.

**This is a named constraint, not a preference.** Reanimated's `withTiming`
collapses to zero duration under Reduce Motion, and this repo has already shipped
a defect of exactly that shape (collapsed timings yielding 0:00 completed runs).
If the unlock fired when the ring finished, every Reduce Motion user would unlock
on touch-down and the control would be defeated for precisely the users most
likely to need deliberate input.

`react-native-gesture-handler` (already a dependency at `~2.32.0`) makes the
separation structural rather than a guard to remember:

- `Gesture.LongPress().minDuration(1200)` owns the gate. `onStart` fires from the
  native recognizer's clock when the hold completes → unlock.
- `onBegin` fires on touch-down → start the ring. `onFinalize` → reset it.
  `onBegin` guarantees a later `onFinalize`, so the ring cannot be orphaned by a
  cancelled gesture.

The hold stays 1.2 s regardless of motion settings. Reduce Motion is about
vestibular safety, not about making a deliberate safety gesture easier; under it
the ring may snap or render as a static indeterminate state, but the duration
does not change.

A single impact haptic on unlock completion confirms it without looking — safe
here by definition, since a locked run is foreground-active. It is UI feedback,
not a cue: it does not touch `CueService` or ADR 0009.

### 2.5 Mechanism, risk, and fallback tiers

~~The lock renders as an RN element inside `RNHostView` within the SwiftUI
tree.~~ *As shipped it is pure SwiftUI — tier 3 below; the RN path was never
taken, so nothing in this section's risk analysis was put on the critical path.*

**Highest-risk assumption in this spec:** that RNGH gestures are recognized
there. Two unknowns compound. First, `GestureHandlerRootView` is required to wrap
the app root with all gesture consumers as its descendants, and there is none
anywhere in `src/` today. Second, the existing `RNHostView` children
(`SkiaCountdown`, `RunProgressBar`) are both non-interactive — they prove
*rendering* inside the SwiftUI host, not touch delivery. Whether an `RNHostView`
mounted by a SwiftUI `Host` remains inside the root view's native subtree, where
RNGH intercepts touches, is unverified.

Resolve it with a spike before building the ring, and degrade in this order:

1. **RNGH** — `Gesture.LongPress` as above. Preferred: the gate and the
   decoration have separate clocks by construction. Requires adding
   `GestureHandlerRootView` to `src/app/_layout.tsx`, which must be verified not
   to disturb the migrations gate, the splash hand-off, or the root `Stack`.
2. **`Pressable`** — `onPressIn` / `onPressOut` with an explicit elapsed-time
   gate (a captured timestamp compared on completion, never the animation's
   callback). Uses RN's own responder system; keeps the two-clock rule, by
   discipline rather than by construction.
3. **Pure SwiftUI** — `onLongPressGesture(handler, 1.2)` on the lock glyph
   (`@expo/ui/swift-ui/modifiers`). The second argument is SwiftUI's
   `minimumDuration`: a `Double` in **seconds**, not the milliseconds tier 1's
   RNGH `minDuration` takes. Guaranteed to work, but the modifier fires only on
   completion and exposes no press stream, so there is no ring. Feedback degrades
   to a `symbolEffect` pulse plus the caption. Ship this rather than stall.

Tier 3 remains a correct, shippable control. The ring is an enhancement, and the
spec should not let it block the lock.

***Shipped: tier 3.*** `src/components/run-lock.tsx` carries the whole control —
no ring, no RNGH, and no `GestureHandlerRootView` added to the root layout, so
the highest-risk assumption above was never put on the critical path. The
constant is `UNLOCK_HOLD_SECONDS = 1.2`.

One finding the tiers did not anticipate: the two states must be **separate
subtrees**, because a SwiftUI `Button` outranks a long press attached to it in
the gesture arena and swallows the hold. Unlocked is an `Island.IconButton`;
locked drops the Button entirely and puts `onLongPressGesture` on a plain
`Image`, which then has to rebuild by hand what the button gave it for free — a
44 pt `frame`, `contentShape(shapes.rectangle())` so the whole frame hit-tests,
and its own `accessibilityAddTraits(['isButton'])` / `accessibilityLabel` /
`accessibilityHint`. The glyph is 32 pt on that 44 pt target.

### 2.6 Feedback and accessibility

While locked, a secondary line sits under the lock glyph: **"Hold to unlock"** —
an `Island.Text` at `font({ textStyle: 'caption' })`, matching the banner
treatment already used at `run.tsx:112`. Always present while locked — not revealed after a failed
tap, because a disabled Pause swallows the tap that would trigger the disclosure,
and a runner who cannot find Pause needs the answer immediately rather than
progressively.

An icon-only control's label is the only text it exposes, so it is simultaneously
the VoiceOver name and the Maestro anchor (ADR 0016): **"Lock screen"** /
**"Unlock screen"**. Unlocked inherits its label and the 44 pt floor from
`Island.IconButton`, which exposes no hint prop — a plain tap needs none. Locked
is not a Button (§2.5), so it declares the `isButton` trait, the label, the 44 pt
frame *and* the `accessibilityHint` carrying the press-and-hold instruction
itself; both halves of the control had to be checked separately for this reason.

## 3. Settings and copy

| Site | Change |
|---|---|
| `src/services/settings.ts:8,24,39` | `keepScreenAwake` deleted from `SettingsValues`, the defaults, and `load()` |
| `src/services/settings.test.ts:11,46,50,60,70,81` | assertions updated for the shrunken shape |
| `src/app/(tabs)/settings/index.tsx:36-38` | **Display** section deleted — the toggle was its only row |
| Settings **Coaching** footer | gains the durable explanation: vibration accompanies cues only while the screen is on, and the run screen's lock is how to keep it there |
| `src/app/run.tsx` banner | *Shipped differently:* with the forced-awake path dropped the banner can only speak to measurement, so it is one short string — **"Distance and pace unavailable."** — regrouped into a `VStack` above its own Enable Location / Open Settings CTA. It mentions neither cues nor the screen. (The pure helper `src/domain/run-display.ts`, extracted for the two-term rule, is left orphaned by this.) |
| `src/app/onboarding/location-primer.tsx` footnote | ~~"you'll just need the screen on to hear the coach" → the app arranges this itself~~ — **outstanding.** It now reads "the screen stays on so you can hear the coach", i.e. it still says the app arranges it, which the dropped forced-awake path made false |
| `src/app/(tabs)/settings/index.tsx` Location footer | Same intent, same outcome: "the screen stays on so cues keep playing" is still shipping and is no longer true. **These two rows are the inventory ADR 0008's open-risk bullet points at**; the Coaching footer's "lock the run screen to keep it on" did land |

`location-primer.tsx:72` ("Location is what lets the coach keep talking after
your screen turns off — put the phone away and just listen") and
`audio-cues.tsx:52` ("A gentle vibration accompanies each cue while the screen is
on") both stay **as written**. They already describe this design precisely. What
changes is that they become true: default-on keep-awake meant the screen never
turned off, so the first promise was never exercised, and the second's "while the
screen is on" condition was silently always satisfied.

## 4. Primer metrics

Scope: `src/app/onboarding/audio-cues.tsx` and
`src/app/onboarding/location-primer.tsx`. `src/app/onboarding/index.tsx` is out
of scope — see §4.2.

No presentation change: `presentation: 'modal'` with `gestureEnabled: false`
(`src/app/_layout.tsx:114`) is already the full-height bordered card over the
tabs that the references show, and the 2026-07-13 spec chose it deliberately (its
decisions log, Presentation row).

### 4.1 Measured deltas

Taken from the reference screenshots (602 px ≈ 393 pt, ÷1.53) against exact
current values read from the code:

| | Reference | Current (pre-change, 2026-07-27) | Change |
|---|---|---|---|
| Hero symbol | ~52–56 pt | 72 pt | shrink |
| Hero → title | ~55 pt | 36 pt (`pt-9`) | open up |
| Title | ~28 pt bold, one string, natural wrap | 34 pt bold, two hard-split `Text` nodes | down one step, one node |
| Title → first row | ~22 pt | 28 pt (`pt-7`) | tighten |
| Row icon | ~28 pt | 32 pt | shrink |
| Icon gutter | ~43 pt | 56 pt (`w-10` + `gap-4`) | tighten |
| Row title → body | 0 (single leading) | 2 pt (`gap-0.5`) | remove |
| Between rows | ~20 pt | 24 pt (`gap-6`) | tighten |
| Footnote | plain 13 pt secondary | 13 pt + tinted 20 pt SF Symbol above it | drop the glyph |

Two are more than nudges:

- **The hard-split title.** Two `Text` nodes fake a wrap the reference gets
  naturally, emit two a11y headers where there should be one, and break
  unpredictably at large Dynamic Type. One string, natural wrap, one
  `accessibilityRole="header"`.
- **The tinted footnote glyph.** The single strongest tell that these are not
  Apple's sheets — that template never decorates a footnote (the "Test Your
  Hearing" reference simply prefixes plain grey text with "Note:").

The reference column is a hypothesis measured off JPEGs. `screenshot-diff`
against the four references on the simulator is the gate, which AGENTS.md
requires for visible UI regardless.

### 4.2 Why the welcome screen is excluded

Apple runs two templates and both are real. The Games/Journal **first-launch
welcome** uses 34 pt and a tinted footnote glyph; the Health **feature-intro
sheet** uses ~28 pt and an undecorated footnote. The 2026-07-13 spec chose the
former deliberately (§2 items 2 and 4) for a screen that is genuinely a
first-launch welcome — app-icon hero, "Welcome to RunBro".

The two primers are the other kind: SF Symbol hero, one feature explained, a
permission ask. Scoping the restyle to them lets the app do what Apple does — a
grander first-launch screen, then plainer feature sheets — without overriding a
prior decision that was correct for its own screen. The 88 pt app icon against
the primers' symbol heroes already differentiates them.

**Separate drift worth fixing either way:** the 2026-07-13 spec called for a
two-colour title ("Welcome to" in `text-primary`, the name in `text-foreground`),
and `onboarding/index.tsx:37-42` renders both lines in the default tone. That
two-colour treatment is what justified the hard split on *that* screen; without
it the split is unmotivated there too.

### 4.3 Type ramp

`largeTitle` (`text-[34px] font-bold`, `src/components/ui/text.tsx:17`) is used
only by the three onboarding screens. Add `title1: text-[28px] font-bold` for the
primers and keep `largeTitle` for the welcome screen — both Apple steps are now
genuinely in use, and the names stop misdescribing Apple's ramp.

### 4.4 Shared components

Per ADR 0013, the shared metric changes land in `src/components/feature-row.tsx`
(icon size, gutter, title→body gap). All three onboarding routes share the
`OnboardingStepScreen` scaffold and `ui/Text` too, but `feature-row` is the one
shared component whose *metrics* differ between the templates, so it is the only
place the prop rule bites: it takes `template: 'welcome' | 'primer'`,
**defaulting to `'welcome'`**, so the welcome screen keeps its metrics untouched
and only the primers opt in. Not by forking the component.

*Corrected 2026-07-28:* hero size and hero→title / title→first-row spacing are
**not** in `src/components/onboarding-step-screen.tsx`. That scaffold owns only
the scroll view and the pinned footer; each route file lays out its own hero and
title. Those metrics are therefore edited per route, and the welcome screen is
left alone by simply not touching `src/app/onboarding/index.tsx`.

## 5. Amendments to existing documents

- **`docs/superpowers/specs/2026-07-11-c25k-app-design.md`** — the decisions-log
  row at line 29 and the run-screen paragraph in §8 (line 232) both describe a
  "screen-awake toggle (default on, persisted)". They become the per-run lock,
  default unlocked, with the touch-lock half and the haptics rationale recorded.
  §8's Stage-1 screen list (line 291) mentions `useKeepAwake` and stays accurate.
- **`docs/adr/0008-background-execution-location-heartbeat.md` §5** —
  ~~still true; gains one line that it is now automatic rather than a user
  setting~~. **Wrong.** Dropping the forced-awake path falsified all three of
  §5's clauses at once: there is no automatic hold, the banner does not say cues
  require the screen on, and `useKeepAwake` no longer supports a denied-location
  run at all. §5 was **rewritten** 2026-07-28 to what ships, and the honesty gap
  it leaves is recorded as a named open risk in that ADR's Consequences. **No
  supersede** — the decision stands, only the degraded mode changed.
- **`docs/adr/0009-cue-audio-tts-prerecorded-fallback.md`** — its foreground-only
  haptics *decision* is unchanged and is now the reason the lock exists, but the
  ADR describes the mechanism as a persistent setting in six places: lines 49,
  52, **102-103** (§7: "the run screen's keep-awake toggle (default on,
  persisted; spec §8)"), 131 and 154 — all pre-amendment line numbers. All six
  were **rewritten** 2026-07-28 to the per-run lock, not merely cross-referenced. **No supersede** — the decision stands, only
  its mechanism changed.

  *(Corrected 2026-07-27 after task 1's review pass: the original inventory here
  was built by grepping the literal token `keepScreenAwake`, which matches none
  of these — every stale reference is hyphenated prose.)*
- **`docs/superpowers/specs/2026-07-13-apple-style-onboarding-design.md`** — §2
  items 2 and 4 apply to the welcome screen only; the primers follow §4 here.

## 6. Testing and verification

- **Unit (`bun test`):** settings suite updated for the removed key.
  ~~The `locked || location !== 'granted'` rule is worth extracting as a pure
  helper~~ — the rule collapsed to `locked` (§2.2), which leaves the extracted
  `src/domain/run-display.ts` imported only by its own test; nothing
  permission-derived is left to unit-test here.
- **Argent (iOS simulator):** the required loop for visible UI. Lock and unlock
  during a run; confirm the transport row dims and does not respond; confirm the
  hold releases at ~1.2 s and that a shorter hold does not; confirm the ring
  tracks the hold. Verify with **Reduce Motion on** that the hold still takes
  1.2 s — this is the regression the two-clock rule exists to prevent.
  `screenshot-diff` both primers against the four references, light and dark.
- **Maestro:** the lock's `label` is the anchor (ADR 0016). A targeted flow locks
  mid-run, asserts Pause does not respond, holds to unlock, and asserts control
  returns. *Resolved:* this bullet's doubt about Maestro having no press-and-hold
  equivalent was unfounded — `longPressOn` clears the 1.2 s gate, established by
  running the gesture against the running app (not by `inspect_screen`, which
  dumps a hierarchy and could never settle a gesture-timing question).
  `longPressOn` exposes no duration parameter, so its driver-defined hold is
  simply longer than 1.2 s. **The flow itself is still unwritten.**
- **Anchors this renames** — *corrected 2026-07-27; the original list named the
  wrong files.* The primer titles are referenced in exactly two places, both
  re-grounded in commit `b1fec09`:
  `.maestro/helpers/onboarding-to-primer.yaml:14,19` (which sits on the critical
  path of the whole suite via `complete-onboarding.yaml`, so it could not wait
  for the E2E task) and `.maestro/tests/onboarding.yaml:10,11`.
  `location-primer-allow.yaml`, `location-primer-deny.yaml` and
  `run-denied-path.yaml` never matched a primer title, and no flow asserts a
  primer footnote or the Settings location footer. `onboarding.yaml`'s
  `"Welcome to"` survives — the welcome screen is out of scope.

  Two of those four were `assertNotVisible` markers, which this inventory should
  have called out first. ADR 0016's `text` is an anchored **full** match, so
  joining each title into one node did not fail them — it made them **vacuously
  true**, silently dropping two of the three onboarding steps from the relaunch
  assertion. A renamed `assertVisible` fails loudly; a renamed `assertNotVisible`
  **fails open**. Treat every negative assertion as an anchor to re-ground, not
  merely to re-read.

  Still outstanding after the design pass: `run-denied-path.yaml:20` asserts
  `"Distance is not recorded.*"`, which the shortened banner no longer renders.
- **Device gate:** haptic audibility through a pocket and real battery cost of a
  locked screen-on run belong to
  [docs/milestone-0-device-checklist.md](../../milestone-0-device-checklist.md),
  not to E2E.

## 7. Out of scope

- **Dimming the display while locked.** A real battery mitigation for a
  screen-on run and a common pattern in running apps, but it needs a brightness
  capability the app does not have. Worth a later look; not scoped here.
- **Live Activity** (ADR 0022) — gated on all five v1 stages; it will serve the
  glanceability job the lock currently carries as a side effect.
- **Restyling the welcome screen** to the feature-sheet template (§4.2), and the
  two-colour title drift, which is noted for a decision rather than fixed here.
- **Touch-locking anything outside the run screen.**
- **A haptics-in-background workaround.** A local notification is the only
  sanctioned way to make a locked phone vibrate; it is a different product
  decision and redundant while audio cues play.
