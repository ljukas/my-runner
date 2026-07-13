# E2E Text-First Selectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Maestro E2E suite to target user-visible text (ids only as documented escape hatches), restructure it into tagged journey flows, and strip the app-code testIDs no test needs anymore.

**Architecture:** Pure test-layer refactor in `.maestro/` plus dead-code removal in `src/`. Order keeps the suite green at every commit: restructure (moves only) → rewrite helpers → rewrite each flow → strip testIDs (only after no flow references them) → docs. The E2E flows themselves are the tests; every task ends with a Maestro run.

**Tech Stack:** Maestro CLI (flows in `.maestro/`), Maestro MCP `inspect_screen` for reading real element text/traits, Argent MCP for simulator setup/screenshots, Expo dev-client + Metro on port 8087, Bun.

**Spec:** `docs/superpowers/specs/2026-07-13-e2e-selector-refinement-design.md`

## Global Constraints

- Selector policy (ADR 0014, created in Task 7): taps/asserts target visible copy; `text` matching is an **anchored full-match regex**; assert a screen's unique heading before tapping its CTA; `index` for repeated text; `scrollUntilVisible` around scrollable-list targets; ids only as escape hatches with a comment at the use site.
- Escape hatches that survive: `id: xmark` (dev-launcher sheet), `plan-next-*` testID (icon-only arrow), `point: "85%,27%"` (toggle glyph), `settings-compressed-plan` testID **only if** Task 2's live check shows `text` cannot carry `checked: true`.
- Never guess a visible string — confirm against the running app with Maestro MCP `inspect_screen` before relying on it. Exact expected strings (from source): `My Runner`, `Continue`, `How it works`, `One gentle note`, `Let's go`, `Week 1 · 0/3`, `Day 1`, `Week 1 · Day 1`, `Start session`, `Warm up`, `Pause`, `Paused`, `Resume`, `Skip`, `End`, `End run`, `Workout complete! 🎉`, `Good effort!`, `Done`, `Partial`, `Compressed plan`, tabs `Plan`/`History`/`Settings`. The `·` is U+00B7.
- Environment for every Maestro run: booted iPhone 17 simulator, dev-client build installed (`bun run ios` if missing), Metro started with `bun expo start --port 8087` (never kill processes on 8081/8082 — other projects own them).
- Commits follow Conventional Commits; suite must be green (3/3 flows) at every commit.
- The compressed plan makes segments 2–5 s long; w1d1 completes in ~40 s. Timeouts in flows already account for this — don't shrink them.

---

### Task 1: Restructure the suite into tagged journey flows (moves only)

**Files:**
- Modify: `.maestro/config.yaml`
- Rename: `.maestro/01-onboarding.yaml` → `.maestro/tests/onboarding.yaml`
- Rename: `.maestro/02-complete-session.yaml` → `.maestro/tests/complete-session.yaml`
- Rename: `.maestro/03-run-controls.yaml` → `.maestro/tests/run-controls.yaml`

**Interfaces:**
- Produces: flow paths `tests/{onboarding,complete-session,run-controls}.yaml` and tags `onboarding`/`session` that Tasks 3–5 edit in place. Helpers stay at `.maestro/helpers/` and are referenced as `../helpers/<name>.yaml` from `tests/`.

- [ ] **Step 1: Environment + baseline.** Boot the simulator and start the app per the `argent-ios-simulator-setup` and `argent-react-native-app-workflow` skills; Metro: `bun expo start --port 8087` (background). Then verify the suite is green BEFORE any change:

Run: `maestro test .maestro/`
Expected: 3/3 flows pass. If not, stop — fix the environment (superpowers:systematic-debugging), not the flows.

- [ ] **Step 2: Move the flows and update discovery.**

```bash
mkdir -p .maestro/tests
git mv .maestro/01-onboarding.yaml .maestro/tests/onboarding.yaml
git mv .maestro/02-complete-session.yaml .maestro/tests/complete-session.yaml
git mv .maestro/03-run-controls.yaml .maestro/tests/run-controls.yaml
```

`.maestro/config.yaml` becomes exactly:

```yaml
flows:
  - "tests/*.yaml"
```

- [ ] **Step 3: Fix runFlow paths and add tags.** In each moved file, change every `runFlow: helpers/<x>.yaml` (and the `file: helpers/open-dev-server.yaml` inside onboarding's conditional runFlow) to `../helpers/<x>.yaml` — runFlow paths resolve relative to the flow file. Add a tags block to each header, e.g. for `tests/onboarding.yaml`:

```yaml
appId: se.lukaslindqvist.myrunner
tags:
  - onboarding
---
```

`complete-session.yaml` and `run-controls.yaml` get `tags: [session]` (same block style, tag `session`). No selector changes in this task.

- [ ] **Step 4: Verify discovery and green suite.**

Run: `maestro test --include-tags session .maestro/`
Expected: exactly 2 flows run, both pass.

Run: `maestro test .maestro/`
Expected: 3/3 pass (helpers not picked up as top-level flows).

- [ ] **Step 5: Commit**

```bash
git add .maestro
git commit -m "test: restructure Maestro suite into tagged journey flows"
```

---

### Task 2: Rewrite the helpers to text-first selectors

**Files:**
- Modify: `.maestro/helpers/complete-onboarding.yaml`
- Modify: `.maestro/helpers/enable-compressed-plan.yaml`
- (`.maestro/helpers/open-dev-server.yaml` is already text-based + the `xmark` escape hatch — leave it.)

**Interfaces:**
- Produces: `complete-onboarding.yaml` ends with the plan list visible (`Week 1 ·.*` asserted); `enable-compressed-plan.yaml` ends back on the Plan tab with the toggle verified on. Tasks 3–5 rely on those postconditions.

- [ ] **Step 1: Ground the strings live.** With the app freshly launched (`clearState`), use Maestro MCP `inspect_screen` on the welcome screen and confirm: heading `My Runner`, CTA `Continue`, and how the `Let's go` apostrophe renders on the health-note screen (source has ASCII `'`; if the tree shows U+2019 `’`, use the rendered form in YAML).

- [ ] **Step 2: Rewrite `helpers/complete-onboarding.yaml`** to exactly:

```yaml
appId: se.lukaslindqvist.myrunner
---
# Each step asserts the screen's own heading before tapping its CTA — the CTA
# labels repeat ("Continue"), the headings don't.
- assertVisible: "My Runner"
- tapOn: "Continue"
- assertVisible: "How it works"
- tapOn: "Continue"
- assertVisible: "One gentle note"
- tapOn: "Let's go"
- assertVisible: "Week 1 ·.*"
```

- [ ] **Step 3: Rewrite `helpers/enable-compressed-plan.yaml`** to exactly:

```yaml
appId: se.lukaslindqvist.myrunner
---
# The Toggle's accessibility element spans the whole List row (label + switch
# merged), but a real touch only registers over the switch glyph itself —
# tapping the element's center (over the label) silently does NOT flip it.
# Tap the glyph directly (top-right of the row) and assert the checked state
# so a layout shift fails loudly instead of silently running the real (slow) plan.
- tapOn: "Settings"
- assertVisible: "Compressed plan"
- tapOn:
    point: "85%,27%"
- assertVisible:
    text: "Compressed plan"
    checked: true
- tapOn: "Plan"
```

- [ ] **Step 4: Verify — this is the live `checked`-trait check from the spec.**

Run: `maestro test .maestro/tests/complete-session.yaml`
Expected: PASS (flow still id-based; testIDs still exist — only the helpers changed).

If the `checked: true` assert fails while `inspect_screen` at Settings shows the toggle IS on: text can't carry the trait on this merged element — revert that one assert to `id: "settings-compressed-plan"` + `checked: true`, and record in the task notes that Task 6 must KEEP that testID and Task 7's registry must list it as a kept escape hatch.

- [ ] **Step 5: Run the flows that consume the helpers.**

Run: `maestro test .maestro/`
Expected: 3/3 pass.

- [ ] **Step 6: Commit**

```bash
git add .maestro/helpers
git commit -m "test: rewrite Maestro helpers to text-first selectors"
```

---

### Task 3: Rewrite tests/onboarding.yaml

**Files:**
- Modify: `.maestro/tests/onboarding.yaml`

**Interfaces:**
- Consumes: helper postconditions from Task 2.

- [ ] **Step 1: Check the relaunch assertion live.** After completing onboarding (app on the plan list), `inspect_screen`: is `My Runner` visible anywhere (nav header, dev-launcher chrome)? If NO → use `assertNotVisible: "My Runner"` below. If YES → replace both asserts marked `# welcome-marker` with the welcome body copy pattern `"From the couch.*"` (add `assertVisible: "From the couch.*"` to the helper's welcome step in Task 2's file so the marker is guaranteed meaningful, and `assertNotVisible: "From the couch.*"` here).

- [ ] **Step 2: Rewrite `tests/onboarding.yaml`** to exactly:

```yaml
appId: se.lukaslindqvist.myrunner
tags:
  - onboarding
---
- launchApp:
    clearState: true
- runFlow: ../helpers/open-dev-server.yaml
- runFlow: ../helpers/complete-onboarding.yaml
- stopApp
- launchApp
# State survives the relaunch, but the dev-launcher may show its home screen
# again instead of auto-loading the last bundle — reconnect if it does.
- runFlow:
    when:
      visible:
        text: ".*8087.*"
    file: ../helpers/open-dev-server.yaml
# Onboarding must not restart after a relaunch: no welcome screen, plan list shows.
- assertNotVisible: "My Runner" # welcome-marker
- assertVisible: "Week 1 ·.*"
- assertVisible: "Day 1"
```

- [ ] **Step 3: Verify.**

Run: `maestro test .maestro/tests/onboarding.yaml`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .maestro
git commit -m "test: rewrite onboarding flow to text-first selectors"
```

---

### Task 4: Rewrite tests/complete-session.yaml (+ shared session-start helper)

**Files:**
- Create: `.maestro/helpers/start-first-session.yaml`
- Modify: `.maestro/tests/complete-session.yaml`

**Interfaces:**
- Consumes: helper postconditions from Task 2.
- Produces: `helpers/start-first-session.yaml` — postcondition "fresh install, w1d1 compressed session just started (run screen mounting)"; Task 5 consumes it. Also the only remaining flow reference to `plan-next-w1d2` (Task 6 keeps that testID because of this line).

- [ ] **Step 1: Create `helpers/start-first-session.yaml`** (shared by both session flows; sibling runFlow paths are relative to this file) with exactly:

```yaml
appId: se.lukaslindqvist.myrunner
---
# Fresh install → w1d1 session just started on the compressed plan.
- launchApp:
    clearState: true
- runFlow: open-dev-server.yaml
- runFlow: complete-onboarding.yaml
- runFlow: enable-compressed-plan.yaml
# "Day 1" repeats in every week section — the first match is Week 1's.
- scrollUntilVisible:
    element:
      text: "Day 1"
      index: 0
- tapOn:
    text: "Day 1"
    index: 0
- assertVisible: "Week 1 · Day 1"
- tapOn: "Start session"
```

- [ ] **Step 2: Rewrite `tests/complete-session.yaml`** to exactly:

```yaml
appId: se.lukaslindqvist.myrunner
tags:
  - session
---
- runFlow: ../helpers/start-first-session.yaml
# Every session opens with a warm-up segment.
- assertVisible: "Warm up"
- extendedWaitUntil:
    visible:
      text: "Workout complete.*"
    timeout: 120000
- tapOn: "Done"
- tapOn: "History"
- scrollUntilVisible:
    element:
      text: "Week 1 · Day 1"
- tapOn: "Plan"
# The next-session marker is an icon-only arrow — no text to target (ADR 0014).
- assertVisible:
    id: "plan-next-w1d2"
```

If Maestro rejects `index` inside `scrollUntilVisible`'s element, drop that `scrollUntilVisible` block from the helper entirely (Week 1's rows are on-screen at launch) and keep the indexed `tapOn`.

- [ ] **Step 3: Verify.**

Run: `maestro test .maestro/tests/complete-session.yaml`
Expected: PASS in ~1–2 min (compressed session ≈ 40 s).

- [ ] **Step 4: Commit**

```bash
git add .maestro
git commit -m "test: rewrite complete-session flow to text-first selectors"
```

---

### Task 5: Rewrite tests/run-controls.yaml

**Files:**
- Modify: `.maestro/tests/run-controls.yaml`

**Interfaces:**
- Consumes: helper postconditions from Task 2 and `helpers/start-first-session.yaml` from Task 4 (postcondition: w1d1 compressed session just started).

- [ ] **Step 1: Rewrite `tests/run-controls.yaml`** to exactly:

```yaml
appId: se.lukaslindqvist.myrunner
tags:
  - session
---
- runFlow: ../helpers/start-first-session.yaml
- tapOn: "Pause"
- assertVisible: "Paused"
- tapOn: "Resume"
- tapOn: "Skip"
- tapOn: "Skip"
- tapOn: "End"
- tapOn: "End run"
- extendedWaitUntil:
    visible:
      text: "Good effort!"
    timeout: 30000
- tapOn: "Done"
- tapOn: "History"
- scrollUntilVisible:
    element:
      text: "Week 1 · Day 1"
- assertVisible: "Partial"
```

(`End` is safe as text: matching is a full anchored regex, so it cannot hit `End run` or `End this run?`.)

- [ ] **Step 2: Verify this flow, then the whole suite** (last commit before ids disappear must prove no flow needs the testIDs about to be stripped — `grep -rn "id:" .maestro/` should list ONLY `xmark` and `plan-next-w1d2`, plus `settings-compressed-plan` iff Task 2 fell back).

Run: `maestro test .maestro/tests/run-controls.yaml` → PASS
Run: `maestro test .maestro/` → 3/3 PASS

- [ ] **Step 3: Commit**

```bash
git add .maestro
git commit -m "test: rewrite run-controls flow to text-first selectors"
```

---

### Task 6: Strip unused testIDs from app code

**Files:**
- Modify: `src/components/primary-button.tsx`, `src/components/onboarding-step-screen.tsx`, `src/components/segment-bar.tsx`
- Modify: `src/app/onboarding/index.tsx`, `src/app/onboarding/how-it-works.tsx`, `src/app/onboarding/health-note.tsx`
- Modify: `src/app/run.tsx`, `src/app/run-summary.tsx`, `src/app/session/[key].tsx`
- Modify: `src/app/(tabs)/index.tsx`, `src/app/(tabs)/history.tsx`, `src/app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: Task 5's guarantee that no flow references the stripped ids. **Keep** `plan-next-*` (Task 4 asserts it) and `settings-compressed-plan` iff Task 2 fell back to id.

- [ ] **Step 1: Baseline screenshot** of the run screen (Argent, mid-session on the compressed plan) — evidence for the HStack unwrap.

- [ ] **Step 2: Remove the dead props and testIDs.**

`primary-button.tsx`: delete the `testID` prop from the signature, type, and `<Pressable>`. `onboarding-step-screen.tsx`: delete `buttonTestID` (prop + type + pass-through). The three onboarding screens: delete their `buttonTestID="…"` attributes. `segment-bar.tsx`: delete the `testID` prop; `session/[key].tsx`: drop `testID="session-segment-bar"` and `testID="session-start"`. `run-summary.tsx`: drop `testID="summary-done"`. `(tabs)/index.tsx`: drop `testID={`plan-row-${session.key}`}` from the row `<Button>` — KEEP the `testID={`plan-next-${session.key}`}` on the arrow `<Image>` and add above it:

```tsx
{/* E2E escape hatch (ADR 0014): icon-only, no text to target. */}
```

`(tabs)/history.tsx`: drop `testID={`history-row-${run.sessionKey}`}` (the HStack itself stays — it's real layout). `(tabs)/settings.tsx`: drop `testID="settings-reset-onboarding"`; drop `testID="settings-compressed-plan"` unless Task 2 fell back to id (then keep it with the same escape-hatch comment).

In `run.tsx`, drop the four control testIDs (`run-pause`, `run-skip`, `run-end`, `run-keep-awake`) and unwrap the two testID-only HStacks to bare `<Text>` (the wrappers existed only to surface a testID on a SwiftUI Text):

```tsx
<Text
  modifiers={[
    font({ size: 80, weight: 'bold' }),
    monospacedDigit(),
    contentTransition('numericText', { countsDown: true }),
    foregroundColor(colors.text),
  ]}>
  {formatClock(snapshot.segmentSecondsRemaining)}
</Text>
```

```tsx
<Text modifiers={[monospacedDigit(), foregroundColor(colors.textSecondary)]}>
  {`${formatClock(snapshot.activeElapsedSeconds)} / ${formatClock(snapshot.totalSeconds)}`}
</Text>
```

- [ ] **Step 3: Static checks.**

Run: `grep -rn "testID" src/`
Expected: only `plan-next-` in `(tabs)/index.tsx` (plus `settings-compressed-plan` iff kept).
Run: `bun run typecheck && bun run lint` → clean (note: stale `.expo/cache/eslint` can false-fail after installs — clear it if lint errors look unrelated).

- [ ] **Step 4: Runtime verification.** Reload the app (Metro is running), screenshot the run screen again and compare with Step 1 — layout unchanged. Then prove the flows never needed those ids:

Run: `maestro test .maestro/`
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor: strip testIDs no longer used by E2E flows"
```

---

### Task 7: Docs — ADR 0014 + AGENTS.md rewrite

**Files:**
- Create: `docs/adr/0014-text-first-maestro-selectors.md`
- Modify: `AGENTS.md` (E2E section + ADR list)

- [ ] **Step 1: Write the ADR** with this content (adjust the registry line iff `settings-compressed-plan` was kept):

```markdown
# 14. Text-first Maestro selectors

Date: 2026-07-13

## Status

Accepted

## Context

The Stage-1 Maestro flows targeted `testID`s for almost every tap and assert.
Maestro's own guidance is the opposite: target user-visible text so tests
validate what the user actually sees; use `id` for icons, images, and
localized apps. Id-first flows also forced testIDs (and container wrappers
whose only job was carrying them) onto app components.

## Decision

- Taps and asserts target visible copy. `text` matching is an anchored
  full-match regex; dynamic strings use patterns (`Week 1 ·.*`).
- Before tapping a screen's CTA, assert that screen's unique heading —
  CTA labels repeat across screens, headings don't.
- Repeated text is disambiguated with `index` (or relational selectors);
  targets inside scrollable lists are wrapped in `scrollUntilVisible`.
- Ids are escape hatches only, each commented at the use site and listed
  in AGENTS.md. Current registry: the dev-launcher sheet's `xmark`, the
  icon-only `plan-next-*` arrow, and the compressed-plan toggle's
  `85%,27%` point-tap.
- A `testID` exists in app code only while a flow uses it.

## Consequences

- Tests break when user-visible copy or flow structure breaks — an
  intended tripwire, since copy is part of the UX. Copy edits now touch
  flows too.
- The app is English-only; localization would reopen this decision
  (Maestro's own guidance flips to ids for localized apps).
- App components stay free of test-only props.
```

- [ ] **Step 2: Rewrite AGENTS.md's E2E authoring guidance.** In the `# E2E tests (Maestro)` section, replace the **Authoring** bullet and the **Dev-only compressed plan** bullet with:

```markdown
- **Layout:** journey flows live in `.maestro/tests/` (tagged `onboarding` /
  `session`), shared steps in `.maestro/helpers/`; `config.yaml` discovers
  `tests/*.yaml`. Targeted runs: `maestro test --include-tags session .maestro/`.
- **Selectors ([ADR 0014](docs/adr/0014-text-first-maestro-selectors.md)):**
  target user-visible text (anchored regex — `Week 1 ·.*`); assert a screen's
  unique heading before tapping its CTA; disambiguate repeats with `index`;
  wrap scrollable-list targets in `scrollUntilVisible`. Ids are escape hatches
  only, commented at each use site — currently the dev-launcher sheet's
  `xmark` and the icon-only `plan-next-*` arrow. Ground every string with the
  MCP `inspect_screen` tool against the running app; consult the MCP
  `cheat_sheet` tool and https://docs.maestro.dev/llms.txt for flow syntax.
  If a future escape hatch needs a `testID` on a bare `@expo/ui` SwiftUI
  `Text`, wrap it in a container (`HStack`) — the id doesn't surface otherwise.
- **Dev-only compressed plan:** the suite swaps the real NHS plan for a
  seconds-long one via Settings → Developer → "Compressed plan" so a full
  session finishes in seconds. The iPhone 17-profile point tap (`85%,27%`)
  stays because the @expo/ui Toggle row only registers touches on the switch
  glyph; the guard `assertVisible: { text: "Compressed plan", checked: true }`
  fails loudly if layout shifts instead of silently running the real plan.
```

Also update the intro line's flow location if it says flows live "at the repo root", and add to the ADR list at the bottom of AGENTS.md:

```markdown
- [ADR 0014 — Text-first Maestro selectors](docs/adr/0014-text-first-maestro-selectors.md)
```

- [ ] **Step 3: Final full verification.**

Run: `bun test && bun run typecheck && bun run lint` → clean
Run: `maestro test .maestro/` → 3/3 PASS

- [ ] **Step 4: Commit**

```bash
git add docs/adr AGENTS.md
git commit -m "docs: adopt ADR 0014 — text-first Maestro selectors"
```
