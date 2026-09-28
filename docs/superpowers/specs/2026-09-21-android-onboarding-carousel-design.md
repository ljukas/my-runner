# Android onboarding: benefits carousel + permission steps — design

Date: 2026-09-21
Status: **Designed** — approved in conversation 2026-09-21 (option B of the
research; B4 layout for permission steps). No implementation plan yet.

Companions:

- Research and the option comparison:
  [`../research/2026-09-21-android-native-onboarding-patterns.md`](../research/2026-09-21-android-native-onboarding-patterns.md)
- Mockups (static, open in a browser):
  [`2026-09-21-android-onboarding-carousel-mockups.html`](2026-09-21-android-onboarding-carousel-mockups.html)
- Design canvas with all three options and the chosen column:
  https://claude.ai/artifact/FroHPCcdKZiQjRHN8tvX4b (private; the HTML above is
  the copy of record)

Governing decisions: ADR 0025 (Android is a staged, not 1:1, Material design),
ADR 0008 (location posture: foreground-only, primer before prompt, decline is
allowed and degrades honestly), ADR 0013 (component conventions), ADR 0003
(platform forks at the component seam), ADR 0016 (text-first selectors, for the
anchors this renames).

---

## 1. Goal and non-goals

**Goal.** Replace the Android onboarding, which today reuses the iOS
first-launch welcome template (centred app icon, "Welcome to / RunBro", tinted
feature rows, pinned pill CTA), with screens that read as Android: a
three-page *benefits carousel* as the welcome step, and one shared *permission
step* layout used by the location primer now and by the spoken-cues and Health
Connect primers when those stages land.

**Non-goals.**

- iOS is untouched. Every iOS file, string and Maestro anchor stays as it is.
- No change to which steps exist or their order; `ONBOARDING_STEPS` in
  `src/services/onboarding.ts` is the source of truth for that.
- No change to permission posture: still foreground location only
  (ADR 0008's 2026-09-21 amendment); still no `POST_NOTIFICATIONS` request
  (recorded there as a separate product decision).
- No auto-advancing carousel, no Skip. See §3.

---

## 2. Flow

Steps and bookkeeping are unchanged; only what each step *shows* changes.

```
welcome-v1 (Android)          location-primer-v1 (Android)
┌─────────────────────────┐   ┌──────────────────────────┐
│ page 1 · From couch to  │   │ Location for distance    │
│         5K              │   │ and cues                 │
│ page 2 · Guided         │──▶│ [Not now]     [Continue] │──▶ tabs
│         intervals       │   └──────────────────────────┘
│ page 3 · Private and    │        Continue → system prompt
│         free            │        (grant | deny | dismiss) → advance
│   ●○○   [Next]          │        Not now → advance
│   ○○●   [Get started]   │
└─────────────────────────┘
```

- **One step = one route.** `welcome-v1` is the carousel; tapping
  "Get started" on page 3 calls `completeAndAdvance` exactly as "Continue" does
  today. `location-primer-v1` is the permission step.
- **Later Android steps slot in behind it.** When stage 3 re-enables
  `audio-cues-v1` and stage 5 re-enables `health-primer-v1` on Android, each is
  a permission-step screen (§5) appended in `ONBOARDING_STEPS` order. Nothing
  in this design needs to change for that; the template is the deliverable.
- **Nothing is skippable.** The carousel has no Skip; the user pages through
  it (swipe or Next). Permission steps keep their decline ("Not now") because
  ADR 0008 §5 and Play's disclosure rules require an explicit way to say no,
  but there is no way past the *screen* without choosing.

---

## 3. Welcome carousel (`welcome-v1`)

### 3.1 Anatomy (per page, portrait, 390 dp reference)

Top to bottom, all centred on the horizontal axis:

| Element | Spec |
|---|---|
| Page counter | Top-right, `labelLarge`, `onSurfaceVariant`: "1 of 3". Also the TalkBack announcement on settle. |
| Hero | 260 dp square. A Material 3 Expressive shape in `primaryContainer` with a 92 dp Material Symbol in `onPrimaryContainer`. Page 1: four-lobe clover (`Shape.Polygon`/`Star` family). Page 2: eight-point pill star. Page 3: rotated squircle. One shape per page, never the app icon. |
| Headline | `headlineMedium` (28/36), weight 500, centred, 48 dp below the hero. |
| Body | `bodyLarge` (16/24), `onSurfaceVariant`, centred, max width 310 dp, 12 dp below the headline. |
| Health note | Page 1 only: `bodySmall` (12/16), `onSurfaceVariant`, centred, 20 dp below the body. The same safety copy as the iOS welcome footnote, so the first screen still carries it. |
| Footer row | Pinned above the gesture inset (`max(inset, 16)`), 24 dp side padding. Left: page indicator. Right: the advance button. Nothing else. |
| Page indicator | Three dots, 8 dp, `outlineVariant`; the active one is a 24×8 dp pill in `primary`. Animates width on settle. |
| Advance button | Pages 1–2: **filled tonal** "Next" (`secondaryContainer` / `onSecondaryContainer`). Page 3: **filled** "Get started" (`primary`) with a trailing `arrow_forward`. 52 dp tall (matches `Island.Button`'s `CTA_HEIGHT`), pill shape, `labelLarge`-plus (16 sp, 500). Wrap-content width; never full-width. |

Background is `surface`. Side padding 24 dp throughout. No status bar work, no
top app bar, no back affordance drawn (see §3.3).

### 3.2 Copy (sentence case, final)

| Page | Headline | Body |
|---|---|---|
| 1 | From couch to 5K | Three short sessions a week for nine weeks. Walking at first, running thirty minutes straight by the end. |
| 1 note | — | Couch to 5K is made for beginners. If you have a health condition or an old injury, have a word with your doctor first, and listen to your body. |
| 2 | Guided intervals | The timer tells you when to walk and when to run, and a cue lets you know at every switch. |
| 3 | Private and free | No account, no ads, no tracking. Your runs live on your phone and nowhere else. |

Buttons: "Next", "Get started". Counter: "1 of 3", "2 of 3", "3 of 3".
Page 2 deliberately says "a cue", not "vibration" or "voice": true in stage 1
(vibration + chime) and stage 3 (speech) alike, so the copy does not need a
stage-3 edit.

### 3.3 Behaviour

- **Advance:** swipe left/right between pages, or tap Next. Next animates to
  the following page (`HorizontalPager` handle `animateScrollToPage`). "Get
  started" completes the step.
- **No auto-advance.** The Material 2 carousel model auto-rotated every 2–3 s;
  the current Android Developers onboarding guidance drops that and the copy
  here is meant to be read. Static pages, user-driven.
- **System back:** on pages 2–3, back goes to the previous page. On page 1,
  back is consumed and does nothing. Onboarding is already non-dismissible on
  iOS (`gestureEnabled: false` in `src/app/onboarding/_layout.tsx`); Android
  needs an explicit back handler to match, otherwise back bubbles to the root
  Stack and dismisses the group. Same rule on permission steps (§5.3).
- **Button label and dots follow the settled page**, not the in-flight scroll
  (`onSettledPageChange`), so a half-swipe never flips "Next" to "Get started".
- **Double-tap guard** carries over from `OnboardingStepScreen` (`busy` ref):
  one completion per step.

### 3.4 Colour, type, motion

- **Dynamic colour.** All roles above are Material roles resolved by the
  existing `materialTheme()` (`src/constants/material-theme.android.ts`) so
  the wallpaper palette flows through; the mockup's blue is a stand-in.
  Dark mode is the same roles in the dark scheme, nothing bespoke.
- **Type.** Material 3 roles as named; Compose text gets them via
  `typography`, RN text via the Android Uniwind tokens. System font (Roboto
  on stock Android). No bundled typeface: the mockup's Roboto Flex is only a
  browser stand-in.
- **Motion.** Pager settle and the indicator width change use Compose
  defaults (the M3 Expressive motion scheme where the device has it). The hero
  may cross-fade or shape-morph between pages as a stretch goal; not required.
  Honour "Remove animations" (Android's reduce-motion): no morph, instant dot.

---

## 4. Layout at scale

- **Font scale 1.3.** Everything fits at 844 dp without scrolling; the hero
  shrinks before text does (hero is `flex: 0 1 260dp` with a 160 dp floor).
- **Font scale ≥ 1.5 or short screens (< 700 dp).** The page content scrolls
  inside the page; the footer row stays pinned. The hero floor is 160 dp; below
  that it is dropped in favour of the text (the icon alone remains, 64 dp).
- **Landscape / tablets** are out of scope for this stage (the app is
  portrait-locked on Android as on iOS); nothing here should break there, but
  no layout is designed for it.

---

## 5. Permission step (`location-primer-v1`, and the template)

### 5.1 Anatomy (B4)

Same visual language as the carousel, one screen, no page indicator:

| Element | Spec |
|---|---|
| Hero | 180 dp scalloped circle in `primaryContainer`, 64 dp symbol in `onPrimaryContainer` (`my_location` for location). Top margin 32 dp under the 64 dp top inset. |
| Headline | `headlineMedium`, centred, 32 dp below hero. |
| Body | `bodyLarge`, `onSurfaceVariant`, centred, max 320 dp. |
| Benefit list | Three rows, full width, 2 dp gaps, `surfaceContainer`; outer corners 20 dp, inner 6 dp (the grouped-list idiom Settings uses). Each row: 22 dp symbol in `primary`, `bodyMedium` text. Left-aligned inside the row. |
| Disclosure | `bodySmall`, `onSurfaceVariant`, centred, 20 dp below the list. This is the Play prominent-disclosure text and must stay on screen (not behind a link or a scroll). |
| Footer row | Left: **text button** "Not now" (`primary`, 40 dp tall, 12 dp padding). Right: **filled** "Continue" (52 dp, pill). |

### 5.2 Copy (location, final)

- Headline: **Location for distance and cues**
- Body: While you run, RunBro measures distance and pace, draws your route,
  and keeps the timer going when the screen is off.
- Rows: "Distance and pace, live from GPS" · "Your route, drawn in the run
  log" · "A run notification keeps cues going with the screen off"
- Disclosure: RunBro collects location data to measure distance, draw your
  route and keep cues running while the screen is off, including when the app
  is in the background. Location stays on your phone and is never shared. Not
  now is fine: every run is still timed, and you can change this in Settings.
- Buttons: "Not now" · "Continue"

"Continue" replaces the iOS "Enable Location": Play's disclosure guidance
prefers a neutral verb over "Allow access", and the system dialog that follows
is where "Allow" lives.

### 5.3 Behaviour (unchanged semantics, ADR 0008)

- **Continue** → `locationTracker.requestPermission()` → the system dialog
  (While using the app / Only this time / Don't allow) → **advance regardless
  of the answer**. A denial degrades exactly like "Not now" (ADR 0008 §5): the
  run screen's location banner and Settings deep link take over.
- **Not now** → advance. The just-in-time ask at first run start remains the
  second chance (ADR 0008 §2).
- **System back** is consumed (no-op): the step is mandatory to *see*, and the
  carousel it followed was replaced, not pushed, so there is nothing to go
  back to.
- **Dismissed dialog** (tap outside) counts as undetermined; the just-in-time
  ask still fires later. Same as today.
- Errors from the permission call are logged and treated as "Not now", as
  `location-primer.tsx` does now.

### 5.4 The template for later steps

Stage 3 (`audio-cues-v1`) and stage 5 (`health-primer-v1`) reuse §5.1 with
their own hero symbol, headline, three rows, disclosure and CTA pair. The
Health Connect step should additionally follow Health Connect's own onboarding
guidance (education → consent → permission request) and list the data types it
writes in the three rows. Those copy decisions belong to their stage plans.

---

## 6. Component architecture

Per ADR 0025, forks live at the component seam; per ADR 0013, screens compose
and do not define file-local components. iOS files are not edited.

| File | Change |
|---|---|
| `src/components/onboarding-step-screen.android.tsx` (**new fork**) | The permission-step scaffold: RN `ScrollView` content + the §5.1 footer row. Same props as the iOS scaffold (`stepId`, `buttonLabel`, `secondaryLabel`, `onPrimaryPress`, `onSecondaryPress`, `children`; `footnote` renders as the centred disclosure) so `location-primer.tsx` needs no logic change. Adds the consumed back handler. |
| `src/components/onboarding-step-screen.tsx` | Renamed to `.ios.tsx`? **No.** Keep the unsuffixed file as the iOS body (the tab routes set that precedent: unsuffixed iOS + `.android.tsx`). |
| `src/components/onboarding-carousel.android.tsx` (**new domain component**) | Owns the Compose `HorizontalPager` island, the three pages (hero shape + texts as Compose children), the settled-page state, the indicator and the advance button. Props: `pages` (headline, body, note?, hero variant, symbol), `onFinish`. |
| `src/components/onboarding-hero.android.tsx` (**new**) | A `Surface` with a `Shape.*` and a centred symbol; `variant: 'clover' \| 'pillStar' \| 'squircle' \| 'scallop'`, `size`. Used by the carousel pages and the permission step. |
| `src/components/island/button.android.tsx` | Add `variant: 'tonal'` → `FilledTonalButton`, `variant: 'text'` → `TextButton`. Existing `primary`/`secondary`/`destructive` unchanged. iOS `IslandButton` gets the same variant names mapped to its nearest SwiftUI styles only if a type error forces it; otherwise the union stays Android-only via the fork. |
| `src/app/onboarding/index.android.tsx` (**new route fork**) | Renders `OnboardingCarousel` with the §3.2 copy and `completeAndAdvance(router, 'welcome-v1')` on finish. The unsuffixed `index.tsx` stays the iOS welcome. |
| `src/app/onboarding/location-primer.tsx` | Android copy differs from iOS (§5.2 vs the current strings), so this also forks: `location-primer.android.tsx` with the B4 rows and copy, calling the same `locationTracker.requestPermission()` and `completeAndAdvance`. |
| `src/components/feature-row.tsx` | Unused by the Android screens after this; unchanged for iOS. |
| `src/services/onboarding.ts` | Unchanged. |

Rules that bite (from ADR 0025's platform-forks notes and AGENTS.md): every
module a route fork imports must resolve on both platforms, so the new
`.android.tsx` components need no iOS twin only because nothing unsuffixed
imports them; `expo-symbols` names must be `{ ios, android }` pairs even in an
Android-only file; a Compose `Host` needs `matchContents` so the pager reports
its height to RN.

Icons inside Compose: `@expo/ui`'s `Icon` takes an image source (Material
Symbols via its asset transformer), not a symbol name. If wiring that up costs
more than it should, the fallback is an RN `SymbolView` overlaid on an RN-hosted
`Shape` island for the hero, and RN `Text` for the copy, with only the pager
chrome in Compose. Either satisfies this spec; the plan decides after a spike.

---

## 7. Accessibility

- Every page's counter ("2 of 3") is announced by TalkBack when the page
  settles; headline is a heading; hero symbols are decorative
  (`importantForAccessibility="no"`).
- Touch targets ≥ 48 dp; the text button gets 48 dp hit slop even at 40 dp
  visual height.
- Contrast: all text pairs are Material roles on their designated containers,
  so they meet 4.5:1 in both schemes by construction; the mockup's
  `onSurfaceVariant` on `surface` is 7.9:1.
- Font scale: §4. Nothing is truncated with ellipsis; text wraps.
- Reduce motion: §3.4.

---

## 8. Verification (design acceptance, not a test plan)

Interactive, on the Pixel 9 Pro API 36 emulator through argent
(`argent-device-interact`), fresh state via the dev-only onboarding reset:

1. Light and dark, and one wallpaper change: roles recolour, nothing hard-coded
   remains (screenshot each page and B4 in both schemes).
2. Font scale 1.0, 1.3, 2.0 (`adb shell settings put system font_scale`): no
   clipping; at 2.0 the page scrolls and the footer stays.
3. Paging: swipe and Next both move exactly one page; dots and the counter
   agree; "Get started" appears only on page 3; back on page 1 does nothing,
   back on page 2 returns to page 1.
4. Location step: Continue shows the system dialog; grant, deny and dismiss all
   land on the tabs; Not now lands on the tabs; the run screen then shows the
   expected banner state (ADR 0008 §5).
5. TalkBack pass over the carousel and B4 (page announcements, heading, button
   names).

Unit tests: the step list (`onboarding.test.ts`) is unchanged; a page-copy
table, if extracted, gets a shape test. Maestro: the iOS suite is untouched and
must still pass; there is no Android E2E lane until stage 7, so the anchors this
design introduces are recorded here for that lane: "From couch to 5K", "Next",
"Get started", "Location for distance and cues", "Not now", "Continue".

---

## 9. Risks and open points

- **`HorizontalPager` inside an RN screen.** Height reporting through `Host`
  and nested-scroll behaviour with the page's own vertical scroll at large
  font scales are the two things to spike first. If the pager cannot host
  scrollable pages cleanly, pages stop scrolling and the hero floor rule (§4)
  carries the load.
- **Compose `Icon` sourcing.** See §6; fallback named.
- **Back handling.** RN `BackHandler` inside expo-router screens must consume
  the event before the native Stack does; verify on the emulator, not assumed.
- **Copy drift with iOS.** The two platforms now say different things on the
  welcome and location steps by design (ADR 0025). Anyone editing one should
  read the other; a line in AGENTS.md's platform-forks bullet should say so
  when this ships.

---

## 10. Out of scope, deliberately

- Option C (quickstart, carousel on the Plan tab) and option A (setup-wizard
  anatomy): researched, mocked, not chosen. They stay on the canvas for
  reference.
- A notifications permission step for the foreground-service notification
  (ADR 0008 amendment): a separate product decision.
- Any iOS change, including harmonising copy.
