# Android-native onboarding patterns — research

Date: 2026-09-21
Status: **Researched → Decided 2026-09-21: option B (benefits carousel) with the B4 permission-step layout**, spec in
[`../specs/2026-09-21-android-onboarding-carousel-design.md`](../specs/2026-09-21-android-onboarding-carousel-design.md).
Originally a design reference for redesigning the Android
onboarding steps (`src/app/onboarding/*` under `index.android.tsx` forks). Not a
decision to build; no ADR warranted yet (ADR 0025 already says the two apps are
deliberately not a 1:1 design).

**The question:** the Android intro screen (`welcome-v1`) is a port of the iOS one,
which was designed to look like an iOS first-launch welcome sheet. What do
onboarding screens that feel native to Android actually look like, and which
Google-made examples should the redesign copy?

---

## 1. Why the current screen reads as iOS

Every element on the Android intro today comes from Apple's welcome-screen
template (the one Apple's own apps use on first launch):

| Element on the Android intro today | Where it comes from | Android equivalent |
|---|---|---|
| Centred, rounded app icon at the top | Apple welcome template | No app icon. A small leading icon top-left (Setup Wizard) or a shape/illustration hero |
| Two-line "Welcome to / RunBro" large title, centred block | Apple welcome template | Single left-aligned `headlineLarge`/`displaySmall`, supporting text below |
| Three tinted-symbol feature rows with bold title + grey body | Apple's feature-list template | Grouped list container (`surfaceContainer`, rounded) with `ListItem` rows, or cards; or a 3-page benefits carousel |
| Heart icon + small grey health footnote | Apple privacy-splash idiom | Plain `bodySmall` supporting text, or fold it into the disclosure step |
| One full-width pill "Continue" pinned to the bottom | iOS sheet CTA | Footer row: text/outlined secondary left, filled primary right; buttons do not stretch across the screen |
| Title Case labels ("Guided Intervals", "Not Now", "Enable Location") | Apple style | Sentence case everywhere ("Guided intervals", "Not now", "Enable location") |

The two permission primers (`location-primer-v1`, and `health-primer-v1` on iOS)
follow the same template with a 64pt centred symbol, so the same audit applies.

---

## 2. What Google actually says

### 2.1 Android Developers: Authentication & Onboarding (current, 2025–26)

The live pattern page is
[developer.android.com/design/ui/mobile/guides/patterns/onboarding](https://developer.android.com/design/ui/mobile/guides/patterns/onboarding).
Key points, quoted or close to it:

- "Before implementing a full walkthrough, critically evaluate if your
  application truly requires one." Always give a clear, persistent way to skip.
- Two entry-point placements: **welcome placement** (all education up front;
  higher abandonment risk) vs **contextual / just-in-time** onboarding, which
  "enables permission priming at the moment of need" and "allows the user to
  learn while doing."
- Permission priming: "Explain why your app needs specific permissions when they
  are needed." Don't bulk-request at start.
- Use steppers and progress indicators for "visual signposting" in multi-step
  flows; cache progress so the user can resume.
- Layout don'ts: "Stretch interactive components across entire screen width",
  "Allow buttons and inputs to stretch across a screen", long scrolling forms.
  Use containment (group related items).
- Google ships an **Android Onboarding Figma Kit** (goo.gle/android-onboarding-figma)
  with templates and flows.

### 2.2 Material onboarding guideline (M1/M2, archived but never superseded)

Material 3 has no dedicated onboarding page; the model vocabulary still comes from
[m2.material.io/design/communication/onboarding](https://m2.material.io/design/communication/onboarding.html)
and the static
[m1 archive](https://m1.material.io/growth-communications/onboarding.html):

- **Three models.** *Self-select* (a short series of choices that change the
  first-run experience; "don't combine Self Select with Top User Benefits"),
  *Quickstart* (land in the UI; "give users something to do"; prioritise the
  first key action), *Top user benefits* (auto-advancing carousel of "up to
  three of the primary benefits", 1:1 illustrations, dots, advance every 2–3 s,
  stop on touch, "Get started" visible throughout).
- Benefits, not features: "Don't be UI literal — show user benefit, not
  interface details." Keep illustration style continuous across pages.
- Portrait spec: centred copy under the illustration, headline 24sp/32sp,
  subhead 15sp/24sp, 24dp bottom padding. In M3 terms that is
  `headlineSmall` + `bodyLarge`.
- "Fewer than ten choices" per screen; show onboarding to first-time users only.

### 2.3 Permissions: educate, then ask

- Material permissions pattern
  ([m1 archive](https://m1.material.io/patterns/permissions.html),
  [m2 platform guidance](https://m2.material.io/design/platform-guidance/android-permissions.html)):
  four strategies — educate before asking, ask up-front, ask in context, educate
  in context. "Critical permissions should be requested up-front. Secondary
  permissions may be requested in-context." If the app has a warm welcome, use it
  to "explain what your app does and why unexpected permissions will be
  requested." Always give feedback when a permission is denied.
- Android Developers
  [Request runtime permissions](https://developer.android.com/training/permissions/requesting)
  and [Explain access to more sensitive information](https://developer.android.com/training/permissions/explaining-access):
  the rationale UI must say what data is accessed and what benefit the user gets,
  and must offer a way to cancel the flow.
- Google Play **prominent disclosure**
  ([best practices](https://support.google.com/googleplay/android-developer/answer/11150561)):
  for location (and the stage-2 foreground service) the disclosure must sit in
  the normal flow right before the system prompt, describe the data and its use,
  require an affirmative action, and offer a decline. Google's copy advice:
  "Agree"/"Continue" over "Allow access"; give at least two options; match the
  app's theme so the prompt reads as the app's, not the system's.

### 2.4 Material 3 Expressive (2025–26 baseline on Pixel)

- [Start building with M3 Expressive](https://m3.material.io/blog/building-with-m3-expressive)
  and the [Google Design research write-up](https://design.google/library/expressive-material-design-google-research):
  46 studies, 18k participants; expressive screens let people find key elements
  "up to four times faster"; preference strongest among 18–24-year-olds. Five
  levers: **color, shape, size, motion, containment**. "Hero moments" frame
  essential information in an editorial way. Caveat from Google: it "isn't a
  one-size-fits-all solution" — keep established interaction patterns.
- New/updated components relevant to onboarding: emphasized type scale, the
  35-shape library with shape morph, **button groups**, taller common buttons,
  the shape-cycling **loading indicator**, wavy progress indicators, toolbars.
  Tonal button is Material's suggested style for "Next in an onboarding flow"
  ([buttons guideline](https://m3.material.io/components/buttons/guidelines)).

---

## 3. Google-made examples to copy from

### A. Android Setup Wizard (GLIF / Setup Design library) — the system's own first run

The screens every Pixel owner sees before any app. Anatomy (from AOSP
`platform/external/setupdesign` and its predecessor
[`setupwizardlib` GlifLayout](https://android.googlesource.com/platform/frameworks/opt/setupwizard/+/9958648/library/main/src/com/android/setupwizardlib/GlifLayout.java)):

1. Small leading icon (primary colour) top-left.
2. Left-aligned headline directly under it.
3. Description text, then the screen's content (list, toggles, illustration).
4. A **footer bar**: secondary text/outlined button on the left ("Skip", "Not
   now"), primary filled button on the right ("Next", "Continue"). Sticky when
   the content scrolls.

Android 16 QPR2 Beta 2 gave it the M3 Expressive refresh — "thicker buttons",
list choices in a "card-like UI", a "squiggly progress indicator", uniform button
styling — see
[Android Authority](https://www.androidauthority.com/android-16-qpr2-beta-2-setup-wizard-material-3-expressive-refresh-3598892/).
Android 12 was the previous restyle
([Android Police](https://www.androidpolice.com/2021/07/19/even-the-pixel-setup-process-is-getting-a-material-you-facelift-in-android-12/)).

Footnote: the QPR2 Beta 1 "Hello" welcome screen cycles greetings through
languages, which Android Authority
[calls out as borrowed from the iPhone](https://www.androidauthority.com/google-pixel-new-welcome-screen-3589850/).
Borrowing an idea is not what makes a screen feel foreign; using the other
platform's component grammar is.

### B. Now in Android — Google's Material 3 reference app (self-select, inline)

Source: [`ForYouScreen.kt`](https://github.com/android/nowinandroid/blob/main/feature/foryou/impl/src/main/kotlin/com/google/samples/apps/nowinandroid/feature/foryou/impl/ForYouScreen.kt),
design rationale in the
[Material 3 case study](https://medium.com/androiddevelopers/now-in-android-a-material-3-case-study-21e44bdfd2bc)
and the [Figma community file](https://www.figma.com/community/file/1504624682223501920/now-in-android-design-file).

- Onboarding is not a separate flow. The feed screen opens with a header
  ("What are you interested in?", `titleMedium`) and a subtitle (`bodyMedium`),
  then a horizontally scrolling 3-row grid of topic cards (312 dp wide, ≥56 dp
  tall, 8 dp corners, 12 dp gaps, 24 dp content padding), then a filled
  `Button` ("Done", up to 364 dp wide, centred). Dynamic colour throughout.
- Lesson for RunBro: the choice changes the experience (which topics you
  follow). A self-select step only earns its place when the answer matters —
  e.g. cue style (vibration vs spoken) or "which week are you starting from".

### C. Owl (official Compose sample) — topic-grid onboarding

[`Onboarding.kt`](https://github.com/android/compose-samples/blob/5dd149f2a5d35527cb628972c6c058057233647f/Owl/app/src/main/java/com/example/owl/ui/onboarding/Onboarding.kt):
bold colour, headline, selectable topic chips in a staggered grid, a FAB to
finish. The Material study for "energy, daring, fun" — useful as the far end of
the expressive spectrum.

### D. Health Connect — permission education the Google way

[Plan for onboarding users](https://developer.android.com/health-and-fitness/health-connect/ui/onboard-users)
and [UI guidelines](https://developer.android.com/health-and-fitness/guides/health-connect/design/ui-guidelines):
an app-owned onboarding activity must "display any relevant user education such
as explaining what data is written or read", ask consent, then request. The
system rationale screen lists each data type with a toggle and an **Allow all**
switch, and a filled "Allow" at the bottom. This is the reference for the Android
counterpart of the iOS Health primer when stage 4 (Health Connect) arrives.

### E. Fitbit (M3 Expressive redesign, preview Nov 2025 → 2026 rollout)

[9to5Google](https://9to5google.com/2025/11/09/fitbit-material-3-expressive/),
[Android Authority](https://www.androidauthority.com/android-app-design-3631537/)
("I wish every Android app looked as good as this one"). Not an onboarding flow,
but the current vocabulary for a Google fitness app: a **sheet motif** (key stats
on a tinted background layer, cards scroll up on a sheet), teal/purple section
colours, charts that draw in left-to-right on launch, a contained loading
indicator cycling M3E shapes, goal checkmarks housed in expressive shapes, a
connected **button group** for time ranges (it dropped the floating toolbar in
[March 2026](https://9to5google.com/2026/03/12/fitbit-material-3-expressive-toolbar/)).
Android Authority's point: it uses only "elements accessible to any developer in
Google's latest design library."

### F. Pixel Watch companion app — story carousel as onboarding

[Android Authority](https://www.androidauthority.com/pixel-watch-app-new-icon-material-3-epressive-3600939/):
"a new story-style carousel now lives at the top of the app's main screen,
walking you through features like Fitbit, Personal Safety, Gemini, and Wallet" —
Google's current take on the *top user benefits* model, but inline and
dismissible rather than a blocking walkthrough. Lists grouped in rounded
containers.

### G. Google Photos — a setup screen that does setup

[Android Authority APK teardown](https://www.androidauthority.com/google-photos-new-onboarding-screen-apk-teardown-3547158/):
the redesigned first-run screen emphasises the account, puts the "use mobile
data for backup" **toggle on the screen itself**, and states the default
("backed up in Original quality") as fine print. The Android habit: a first-run
screen carries the real switch, not a marketing paragraph.

### H. Files by Google — expressive carousel

[9to5Google](https://9to5google.com/2025/08/18/files-m3-expressive-redesign/):
M3 multi-browse carousel with shape morphing and parallax, pill-shaped overflow,
centred toolbar. Reference if a benefits carousel is chosen.

### I. Google Fit (legacy, still on the Play Store)

Onboarding journey: tagline screen → Google sign-in → profile (sex, DOB, height,
weight) → goals (Move Minutes, Heart Points) → daily view. Self-select model;
a community re-creation exists as a
[Figma file](https://www.figma.com/community/file/1331672642289290968/google-fit-onboarding-flow).

### J. Galleries for side-by-side comparison

- Mobbin: [Android onboarding flows](https://mobbin.com/explore/mobile/flows/onboarding),
  [welcome / get-started screens](https://mobbin.com/explore/mobile/screens/welcome-get-started).
- Page Flows: [Nike Run Club Android onboarding](https://pageflows.com/post/android/onboarding/nike-run-club/),
  [Strava Android recordings](https://pageflows.com/android/products/strava/) —
  both note the Android flows differ from iOS in back handling and Material
  components.
- Kits: [Material 3 Design Kit](https://www.figma.com/community/file/1035203688168086460/material-3-design-kit),
  Android Onboarding Figma Kit (goo.gle/android-onboarding-figma).

---

## 4. The Android onboarding grammar, distilled

1. **Headline left, no app icon.** `headlineLarge` (or emphasized `displaySmall`
   for the hero) left-aligned, `bodyLarge` under it. A 24 dp primary-colour
   leading icon above the headline is the Setup Wizard signature. Sentence case.
2. **Hero = shape or illustration, tonal.** A 1:1 illustration or an M3E shape
   in `primaryContainer`, following dynamic colour, replaces the icon block.
3. **Contain the list.** Feature rows live in a `surfaceContainer` group with
   large corners, `ListItem`-style rows, leading icons in small tonal circles;
   or each benefit is a card. Nothing floats on bare background.
4. **Footer row, not a stacked pill.** Secondary (text or outlined) left,
   primary filled right, wrap-content widths, 16 dp gutter; a
   `ButtonGroup` where the two options are peers. Filled tonal is Material's
   suggestion for "Next".
5. **Signpost progress.** Page dots for a carousel; a wavy linear progress or a
   stepper for a multi-step flow. Never a bare "Continue" with no sense of
   length.
6. **Permission steps are disclosures.** Say what is accessed and why, list the
   data, one screen, right before the system prompt, "Continue" + "Not now".
   For location + foreground service this is also the Play prominent disclosure.
7. **Self-select only when it changes something.** Chips/cards for a real
   choice; otherwise skip the step (Quickstart).
8. **Motion is part of it.** Shape morph or spring on the hero, staggered
   list entry, the shape-cycling loading indicator if anything waits.

---

## 5. Three shapes the RunBro redesign could take

Android currently shows two steps: `welcome-v1` and `location-primer-v1`
(`audio-cues-v1`/`health-primer-v1` are iOS-only per
`src/services/onboarding.ts`). Stage 2 adds the foreground-service heartbeat, so
the location step also becomes a Play prominent disclosure.

| Option | Welcome | Location step | Fits which guidance |
|---|---|---|---|
| **A. Setup-wizard** (recommended) | Leading icon + "Run 5K in nine weeks" headline; the three benefits as a contained list; footer "Skip" (text) / "Continue" (filled) | Same anatomy: icon, "Location for distance and cues", a 3-row data list (distance, route, background cues), disclosure sentence, "Not now" / "Continue" | Setup Wizard, Health Connect, Android Dev "containment" and button rules |
| **B. Benefits carousel** | 3 pages (Couch to 5K / Guided intervals / Private and free), 1:1 shape-hero each, dots, "Skip" left / "Next" right, "Get started" on the last | As A | M2 top-user-benefits model, Files/Pixel Watch carousels |
| **C. Quickstart + inline** | Drop the welcome; land on the Plan tab with a dismissible story carousel at the top (Pixel Watch style) | Ask in context at first run start (already the ADR 0008 second chance) | Android Dev "critically evaluate if you need a walkthrough"; Now in Android |

A is the least work and the most unambiguously Android. C is the most
Android-idiomatic per the current Android Developers page but changes flow
semantics (onboarding step bookkeeping, Maestro anchors, the ADR 0008 primer
decision), so it is a separate conversation.

Whichever is chosen, the copy changes are free and should land regardless:
sentence case throughout, "Not now" instead of "Not Now", "Get started" instead
of "Continue" on the last step.

---

## 6. Implementation notes for this repo (to verify before a plan)

- The shared scaffold `src/components/onboarding-step-screen.tsx` and
  `feature-row.tsx` are platform-blind RN. Per ADR 0025 the Android look should
  be an `.android.tsx` fork at the component seam (`onboarding-step-screen`,
  `feature-row`), leaving the iOS files untouched.
- `Island.Button` on Android already wraps Compose `Button`/`OutlinedButton`
  (`src/components/island/button.android.tsx`, 52 dp tall). The footer row
  needs a `TextButton` or a second `OutlinedButton` in a `Row` — check what
  `@expo/ui/jetpack-compose` exports in this SDK via Context7 before planning
  (do not assume `ButtonGroup`, `ListItem`, or the loading indicator exist
  there yet).
- Dynamic colour already flows through `use-theme.android.ts` into Uniwind
  tokens, so tonal containers can be RN `View`s with `bg-*-container` classes
  while buttons stay Compose.
- Maestro anchors: any redesign renames "Welcome to" and the CTAs; audit
  `.maestro/helpers/launch-and-onboard.yaml` and the five flows that launch
  without it (ADR 0016 text-first selectors).

---

## Sources

Guidance: [Android Developers — Authentication & Onboarding](https://developer.android.com/design/ui/mobile/guides/patterns/onboarding) ·
[Material onboarding (m2)](https://m2.material.io/design/communication/onboarding.html) ·
[Material onboarding (m1 archive)](https://m1.material.io/growth-communications/onboarding.html) ·
[Material permissions (m1)](https://m1.material.io/patterns/permissions.html) ·
[Material Android permissions (m2)](https://m2.material.io/design/platform-guidance/android-permissions.html) ·
[Request runtime permissions](https://developer.android.com/training/permissions/requesting) ·
[Explain access to sensitive info](https://developer.android.com/training/permissions/explaining-access) ·
[Play prominent disclosure best practices](https://support.google.com/googleplay/android-developer/answer/11150561) ·
[Start building with M3 Expressive](https://m3.material.io/blog/building-with-m3-expressive) ·
[Google Design — Expressive research](https://design.google/library/expressive-material-design-google-research) ·
[M3 buttons guidelines](https://m3.material.io/components/buttons/guidelines) ·
[M3 typography — applying type](https://m3.material.io/styles/typography/applying-type) ·
[Compose pager](https://developer.android.com/develop/ui/compose/layouts/pager) ·
[Custom page indicator](https://developer.android.com/develop/ui/compose/quick-guides/content/custom-page-indicator)

Examples: [GlifLayout (AOSP)](https://android.googlesource.com/platform/frameworks/opt/setupwizard/+/9958648/library/main/src/com/android/setupwizardlib/GlifLayout.java) ·
[Setup Wizard M3E refresh](https://www.androidauthority.com/android-16-qpr2-beta-2-setup-wizard-material-3-expressive-refresh-3598892/) ·
[Pixel "Hello" welcome screen](https://www.androidauthority.com/google-pixel-new-welcome-screen-3589850/) ·
[Android 12 setup facelift](https://www.androidpolice.com/2021/07/19/even-the-pixel-setup-process-is-getting-a-material-you-facelift-in-android-12/) ·
[Now in Android repo](https://github.com/android/nowinandroid) ·
[Now in Android M3 case study](https://medium.com/androiddevelopers/now-in-android-a-material-3-case-study-21e44bdfd2bc) ·
[Now in Android Figma](https://www.figma.com/community/file/1504624682223501920/now-in-android-design-file) ·
[Owl onboarding](https://github.com/android/compose-samples/blob/5dd149f2a5d35527cb628972c6c058057233647f/Owl/app/src/main/java/com/example/owl/ui/onboarding/Onboarding.kt) ·
[Health Connect onboarding](https://developer.android.com/health-and-fitness/health-connect/ui/onboard-users) ·
[Health Connect UI guidelines](https://developer.android.com/health-and-fitness/guides/health-connect/design/ui-guidelines) ·
[Fitbit M3E redesign](https://9to5google.com/2025/11/09/fitbit-material-3-expressive/) ·
[Fitbit drops floating toolbar](https://9to5google.com/2026/03/12/fitbit-material-3-expressive-toolbar/) ·
[Android Authority on Fitbit's design](https://www.androidauthority.com/android-app-design-3631537/) ·
[Pixel Watch app carousel](https://www.androidauthority.com/pixel-watch-app-new-icon-material-3-epressive-3600939/) ·
[Google Photos setup screen](https://www.androidauthority.com/google-photos-new-onboarding-screen-apk-teardown-3547158/) ·
[Files by Google M3E](https://9to5google.com/2025/08/18/files-m3-expressive-redesign/) ·
[Google Fit onboarding Figma](https://www.figma.com/community/file/1331672642289290968/google-fit-onboarding-flow) ·
[Mobbin onboarding flows](https://mobbin.com/explore/mobile/flows/onboarding) ·
[Page Flows — Nike Run Club Android](https://pageflows.com/post/android/onboarding/nike-run-club/) ·
[Page Flows — Strava Android](https://pageflows.com/android/products/strava/) ·
[Material 3 Design Kit](https://www.figma.com/community/file/1035203688168086460/material-3-design-kit) ·
[9to5Google M3 Expressive rollout tracker](https://9to5google.com/2025/11/17/google-material-3-expressive-redesign/)
