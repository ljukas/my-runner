# HIG Audit — Parked Follow-ups

Deferred items from the iOS 26 Apple-HIG audit (see PR #45,
`feat: Apple HIG audit …`). Everything here was **deliberately not applied** in
that PR because it needs a product/architecture decision, native work, or a
verification pass that a per-screen copy-paste fix can't cover. Each item notes
**why it's parked**, the **files** involved, a **severity**, and a **suggested
approach**. Tick them off as they're picked up.

Anything from the audit that *was* applied + verified on-simulator is in PR #45
and is not repeated here.

---

## Accessibility

- [ ] **Increased-contrast (Increase Contrast) variants** — *major, architectural*
  The theme provides only light/dark, no `UIAccessibilityContrast` branch, so
  "Increase Contrast" (Settings ▸ Accessibility ▸ Display & Text Size) changes
  nothing. React Native's `AccessibilityInfo` does **not** expose the iOS
  high-contrast trait, so this can't be done purely in JS/Uniwind.
  **Files:** `src/constants/theme.ts`, `src/global.css`, `src/hooks/use-theme.ts`.
  **Approach:** for the `@expo/ui` SwiftUI islands, move colors to SwiftUI
  semantic colors / `DynamicColorIOS({light,dark,highContrastLight,highContrastDark})`
  (adapts automatically); for the RN/className layer, either accept light/dark-only
  or add a small native module that reads the trait. Note Skia/Reanimated consumers
  (run screen) need **raw hex** and must not receive `DynamicColorIOS`.

- [ ] **Run-summary `L` — combine each stat tile into one VoiceOver element** — *major, needs on-device verify*
  Each stat tile currently exposes its icon/label/value as separate VoiceOver
  stops. Combining them (RN `accessible` + `accessibilityLabel`) hits the
  documented **PR#33 trap** (an RN `accessible` parent with a nested SwiftUI
  `Host` can occlude the RN sibling in the a11y tree) **and** re-points the
  Maestro `assertVisible: "intervals"` onto the composed Card label.
  **Files:** `src/components/stat-grid.tsx`.
  **Approach:** implement, then verify with a live VoiceOver swipe **and** the
  `e2e-ios` suite before merging; confirm `"intervals"` still resolves.

- [ ] **Run progress bar VoiceOver value (`M`)** — *minor*
  `src/components/run-progress-bar.tsx` exposes no `accessibilityRole`/`accessibilityValue`.
  Defensible to skip (a live value needs a JS seconds-mirror the component
  deliberately avoids), but a static role/label could be added.

- [ ] **Log `F2` — native `Island.Text` hard-codes hex over the system label color** — *minor, shared primitive*
  On the all-native Log/Plan lists, `Island.Text` emits `foregroundColor(hex)`
  even for the default tone, where SwiftUI's `label`/`.secondary` would apply for
  free and auto-adapt. **File:** `src/components/island/text.tsx` (app-wide — sweep + verify).
  **Approach:** for `tone="default"` omit `foregroundColor`; use
  `foregroundStyle({type:'hierarchical', style:'secondary'})` for secondary.

---

## Color / theming

- [ ] **`PlatformColor` migration for system-color duplicates** — *minor, app-wide*
  `theme.ts` hard-codes Apple system-color hex (system red/green/grays,
  grouped-background pair). Apple warns these values can shift between releases.
  **File:** `src/constants/theme.ts`.
  **Approach:** replace the *system-color duplicates* in the JS mirror with
  `PlatformColor('systemRed' | 'systemGreen' | 'systemGroupedBackground' | …)`;
  keep the custom brand blue as hex. `global.css` (Uniwind/Skia) can't reference
  `PlatformColor`, so scope to the JS side and accept the CSS divergence.

- [ ] **`ui/text` — re-base the type scale on semantic iOS text styles (`F17`)** — *minor*
  Variants use hard-coded px sizes. (The line-height Dynamic-Type fix already
  shipped in PR #45.) A cleaner long-term move is mapping variants to iOS text
  styles for correct per-style Dynamic Type ramps. **File:** `src/components/ui/text.tsx`.

- [ ] **`--color-separator` token (session detail `F13`)** — *minor*
  The session sheet's hairline reuses `background-selected` as a divider color;
  add a dedicated `--color-separator` token. **Files:** `src/global.css`, `src/constants/theme.ts`.

### Accepted trade-offs (documented, not bugs)
- Green `success` badge/label is ~2.2:1 as text on white (system green is
  mid-luminance) — **kept vibrant by choice** (Apple ships green status text at
  similar levels). Revisit only if strict WCAG-AA text contrast becomes a goal.
- Segment-bar palette is **vibrant Apple system colors** (orange/blue/gray/teal),
  decoupled from the run-summary tile palette; some accents are sub-3:1 on white
  but are backed by text labels — accepted for the vibrant look.

---

## Per-screen

- [ ] **Settings — Licenses / Acknowledgements screen** — *likely a store obligation*
  No open-source acknowledgements screen exists. Add a `/settings/licenses` route
  + an About nav row. **Files:** new `src/app/(tabs)/settings/licenses.tsx` +
  `settings/_layout.tsx` + a row in `settings/index.tsx`. Close before store submission.

- [ ] **Onboarding — make it skippable** — *product decision*
  Onboarding is a mandatory 2-step gate (Apple HIG: onboarding should be
  skippable). Add a `skipOnboarding()` helper (mark all steps complete) +
  a `Skip` control. **Files:** `src/services/onboarding-store.ts`,
  `src/components/onboarding-step-screen.tsx`. (Presentation stays a page-sheet
  modal — confirmed Apple-consistent with Health/Reminders.)

- [ ] **Host'd large-title collapse / floating-tab-bar bottom inset** — *verify-gated, shared across tab roots*
  The tab-root screens host a SwiftUI `List`/`Form` inside an `@expo/ui` `Host`;
  react-native-screens drives large-title collapse + safe-area insets off an RN
  scroll view it may not track. On-device checks so far showed Plan/Log behaving,
  but Settings (Host'd `Form`) is unverified. **Approach:** verify at AX5 whether
  the title collapses and the last row clears the floating tab bar; if not, host
  the list in an RN `ScrollView contentInsetAdjustmentBehavior="automatic"` (as
  run-summary/onboarding already do) or add a bottom inset. **Files:**
  `src/app/(tabs)/settings/index.tsx` (+ Log/Plan if it recurs).

- [ ] **Session detail — sheet ScrollView + detent (`F1`)** — *minor, verify-gated*
  The sheet content isn't scrollable; at very large Dynamic Type it can clip past
  the `fitToContents` detent. Wrap the body in a `ScrollView` **paired with** a
  `sheetAllowedDetents` change (they must land together). **Files:**
  `src/app/session/[key].tsx`, `src/app/_layout.tsx`.

- [ ] **Session detail — explicit Close control (`F15`)** — *minor / design*
  The formSheet is swipe/grabber-dismissable only (no explicit Cancel/Close).
  Common for iOS peek sheets, but HIG prefers swipe **plus** an explicit control.
  Add a Close/Cancel if desired. **File:** `src/app/_layout.tsx` (session screen options).

- [ ] **Session detail — promote the session description (`F5`)** — *minor / design*
  The "Alternates 1-minute runs …" description is dimmed footnote; consider
  promoting/undimming it. **File:** `src/app/session/[key].tsx`.

- [ ] **Log — `listSectionMargins` iOS-26-only, no deployment floor (`F3`)** — *minor, owner decision*
  `listSectionMargins` (top inset under the large title) is iOS 26+; `app.json`
  sets no `ios.deploymentTarget` and there's no `expo-build-properties`, so on
  iOS 18–25 the 16pt gap silently disappears — colliding with ADR 0010's iOS-18
  floor. **Approach:** either set `ios.deploymentTarget: "26.0"` (reconcile with
  ADR 0010) or use a cross-version inset. **Files:** `app.json` / `src/app/(tabs)/log/index.tsx`.

- [ ] **Run — Skia countdown Dynamic-Type scaling (`F`)** — *minor, likely leave-as-is*
  `src/components/skia-countdown.tsx` hard-codes `FONT_SIZE = 80`; it doesn't
  track Dynamic Type. Defensible under HIG §15 (a large glanceable custom metric),
  and scaling a near-full-width timer larger would overflow. Revisit only if a
  smaller default is chosen. Do **not** touch the Skia `color` prop (needs raw hex).

---

## How this was produced
Each screen was reviewed by 4 adversarial HIG reviewers (layout · typography ·
color · controls/accessibility), synthesized into concrete fixes, then run past
2 adversarial fix-reviewers before applying and verifying on the iPhone 17 Pro
simulator (light / dark / AX5). The items above are what survived triage as
"needs more than a safe per-screen edit."
