# GitHub Actions Maestro E2E (iOS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free, required iOS E2E status check on this public repo that runs the Maestro suite against a Metro-free `e2e-simulator` build.

**Architecture:** A new `eas.json` build profile (`e2e-simulator`) produces a release-style simulator app with `EXPO_PUBLIC_E2E=1` inlined. A tiny product-code helper makes the compressed (fast) plan reachable and default-on only when that flag (or `__DEV__`) is set, so store builds are unaffected. The Maestro flows drop the dev-launcher/Metro steps and target that build. A GitHub Actions workflow builds it locally on a free `macos-15` runner (zero EAS cloud minutes) and runs the suite; it becomes a required check on the `protect-main` ruleset.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19.2, TypeScript ~6.0, Bun 1.3.14, EAS CLI (`--local`), Maestro, GitHub Actions.

## Global Constraints

- Read Expo SDK 57 versioned docs before writing Expo/EAS code — APIs are newer than training data (AGENTS.md "Expo HAS CHANGED").
- Package manager is **Bun**; frozen install is `bun ci`; `.bun-version` = `1.3.14`.
- Maestro `appId` / bundle id is `se.lukaslindqvist.myrunner` (both `ios.bundleIdentifier` and `android.package`).
- **Never** modify `cli.appVersionSource: "remote"` in `eas.json`, `fingerprint.config.js`, or `runtimeVersion` policy in `app.json` (AGENTS.md "Releases").
- `EXPO_PUBLIC_E2E` is set **only** by the `e2e-simulator` build profile — never in `app.json`, `.env`, or any other profile.
- `bun test` runs pure-TS `src/domain/` + `src/services/` with **no** React Native runtime: nothing they import may reference `__DEV__` at module top level (keep `__DEV__` inside function bodies only).
- Maestro selectors are text-first (ADR 0016); ids are commented escape hatches only.
- iOS only this stage. Runner is `macos-15` (standard → free/unlimited on public repos).
- `EXPO_TOKEN` is already a repo secret; `protect-main` ruleset id is `18800808`; the `e2e-ios` required context is added **after** the PR's first green run.
- PR title must be Conventional Commits (squash-merged, drives release-please). This PR is user-facing tooling: use a `ci:` title (e.g. `ci: add GitHub Actions Maestro E2E gate`).

---

### Task 1: E2E build-flag helper module

**Files:**
- Create: `src/services/e2e.ts`
- Test: `src/services/e2e.test.ts`

**Interfaces:**
- Produces: `isE2EBuild(): boolean` (reads `process.env.EXPO_PUBLIC_E2E`, no `__DEV__` — safe for `bun test` importers) and `compressedPlanReachable(): boolean` (`__DEV__ || isE2EBuild()`).

- [ ] **Step 1: Write the failing test**

Create `src/services/e2e.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';

import { compressedPlanReachable, isE2EBuild } from './e2e';

const ORIGINAL_E2E = process.env.EXPO_PUBLIC_E2E;

afterEach(() => {
  if (ORIGINAL_E2E === undefined) delete process.env.EXPO_PUBLIC_E2E;
  else process.env.EXPO_PUBLIC_E2E = ORIGINAL_E2E;
  // Bare `__DEV__` reads resolve to this global; clear it between tests.
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
});

describe('isE2EBuild', () => {
  test('false when EXPO_PUBLIC_E2E is unset', () => {
    delete process.env.EXPO_PUBLIC_E2E;
    expect(isE2EBuild()).toBe(false);
  });

  test('true only when EXPO_PUBLIC_E2E is exactly "1"', () => {
    process.env.EXPO_PUBLIC_E2E = '1';
    expect(isE2EBuild()).toBe(true);
    process.env.EXPO_PUBLIC_E2E = 'true';
    expect(isE2EBuild()).toBe(false);
  });
});

describe('compressedPlanReachable', () => {
  test('true in a dev build regardless of the E2E flag', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    delete process.env.EXPO_PUBLIC_E2E;
    expect(compressedPlanReachable()).toBe(true);
  });

  test('true in a non-dev E2E build', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    process.env.EXPO_PUBLIC_E2E = '1';
    expect(compressedPlanReachable()).toBe(true);
  });

  test('false in a non-dev, non-E2E build', () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    delete process.env.EXPO_PUBLIC_E2E;
    expect(compressedPlanReachable()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/e2e.test.ts`
Expected: FAIL — `Cannot find module './e2e'` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/services/e2e.ts`:

```ts
/**
 * Build-time E2E signal, set ONLY by the eas.json `e2e-simulator` profile
 * (`env.EXPO_PUBLIC_E2E=1`, inlined into the bundle by Metro at build time).
 * Read at call time and free of `__DEV__`, so pure-TS `bun test` importers stay
 * runtime-clean.
 */
export function isE2EBuild(): boolean {
  return process.env.EXPO_PUBLIC_E2E === '1';
}

/**
 * Whether the compressed dev/E2E plan is reachable in this build: dev builds or
 * the E2E build only, never production. `__DEV__` is referenced only inside this
 * function body (see the `bun test` constraint).
 */
export function compressedPlanReachable(): boolean {
  return __DEV__ || isE2EBuild();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/e2e.test.ts`
Expected: PASS (5 tests across 2 describes).

- [ ] **Step 5: Commit**

```bash
git add src/services/e2e.ts src/services/e2e.test.ts
git commit -m "feat: add E2E build-flag helper (isE2EBuild, compressedPlanReachable)"
```

---

### Task 2: Wire reachability into plan selection and settings default

**Files:**
- Modify: `src/services/active-plan.ts`
- Modify: `src/services/settings.ts`
- Test: `src/services/settings.test.ts` (add one case)

**Interfaces:**
- Consumes: `isE2EBuild`, `compressedPlanReachable` from Task 1.
- Produces: no new exports; behavior change — `useActivePlan()` returns `COMPRESSED_PLAN` only when reachable-and-enabled; `createSettingsStore` defaults `useCompressedPlan` to `isE2EBuild()`.

- [ ] **Step 1: Write the failing test (settings default under E2E)**

Add this test inside the existing `describe('createSettingsStore', ...)` block in `src/services/settings.test.ts`:

```ts
  test('useCompressedPlan defaults to true in the E2E build', () => {
    const original = process.env.EXPO_PUBLIC_E2E;
    process.env.EXPO_PUBLIC_E2E = '1';
    try {
      const store = createSettingsStore(fakeStorage());
      expect(store.getSnapshot().useCompressedPlan).toBe(true);
    } finally {
      if (original === undefined) delete process.env.EXPO_PUBLIC_E2E;
      else process.env.EXPO_PUBLIC_E2E = original;
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/settings.test.ts`
Expected: FAIL — the new test expects `true` but the current hard-coded default is `false`.

- [ ] **Step 3: Implement — settings default reads the flag at store creation**

In `src/services/settings.ts`: (a) add the import, (b) update the `useCompressedPlan` doc comment, (c) replace the module-level `DEFAULTS` const with a per-store `defaults` computed via `isE2EBuild()` so it is evaluated when the store is created (test-friendly and correct for the build).

Replace the top import and the `SettingsValues` comment:

```ts
import { isE2EBuild } from './e2e';
import { readJson, type StringStorage } from './storage';

export interface SettingsValues {
  /** Dev/E2E only: swap the NHS plan for the seconds-long compressed plan. */
  useCompressedPlan: boolean;
  /** Keep the display on for the whole run (spec decisions log). */
  keepScreenAwake: boolean;
}

const STORAGE_KEY = 'settings';
```

(Delete the old `const DEFAULTS: SettingsValues = { ... };` line — it is module-private and unused elsewhere.)

Then replace the body of `createSettingsStore` down through `load()`:

```ts
export function createSettingsStore(storage: StringStorage) {
  // Compressed plan is default-on in the E2E build so flows need no toggle;
  // dev and production default it off. Evaluated per store creation so tests can
  // vary EXPO_PUBLIC_E2E.
  const defaults: SettingsValues = { useCompressedPlan: isE2EBuild(), keepScreenAwake: true };
  let snapshot = load();
  const listeners = new Set<() => void>();

  function load(): SettingsValues {
    const parsed = readJson(storage, STORAGE_KEY);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...defaults }; // non-object JSON is corruption too
    }
    const values = parsed as Partial<SettingsValues>;
    return {
      useCompressedPlan: values.useCompressedPlan ?? defaults.useCompressedPlan,
      keepScreenAwake: values.keepScreenAwake ?? defaults.keepScreenAwake,
    };
  }
```

(The `return { getSnapshot, set, subscribe }` block below `load()` is unchanged.)

- [ ] **Step 4: Update `active-plan.ts` to use the helper**

Replace the whole of `src/services/active-plan.ts`:

```ts
import { COMPRESSED_PLAN, NHS_PLAN, type PlanSession } from '@/domain/plan';

import { compressedPlanReachable } from './e2e';
import { useSetting } from './settings-store';

/** The compressed plan is a dev/E2E tool only — reachable in dev or E2E builds, never production. */
export function useActivePlan(): PlanSession[] {
  const compressed = useSetting('useCompressedPlan');
  return compressedPlanReachable() && compressed ? COMPRESSED_PLAN : NHS_PLAN;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/services/settings.test.ts src/services/e2e.test.ts`
Expected: PASS — the new E2E-default test passes, and the existing default/corrupt/non-object cases still expect `false` (env unset under `bun test`).

- [ ] **Step 6: Run the full unit suite (no regressions)**

Run: `bun test`
Expected: PASS — all suites (previously 55 tests) plus the new cases.

- [ ] **Step 7: Commit**

```bash
git add src/services/active-plan.ts src/services/settings.ts src/services/settings.test.ts
git commit -m "feat: make compressed plan reachable + default-on in the E2E build"
```

---

### Task 3: Add the `e2e-simulator` build profile to `eas.json`

**Files:**
- Modify: `eas.json`

**Interfaces:**
- Produces: a build profile named `e2e-simulator` consumed by the workflow in Task 5 (`--profile e2e-simulator`).

- [ ] **Step 1: Add the profile**

In `eas.json`, inside `"build"`, add this profile after the `"internal"` entry (leave `cli.appVersionSource` untouched):

```jsonc
    "e2e-simulator": {
      "extends": "preview",
      "ios": { "simulator": true },
      "autoIncrement": false,
      "env": { "EXPO_PUBLIC_E2E": "1" }
    },
```

- [ ] **Step 2: Validate JSON and confirm the profile resolves**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('eas.json','utf8')); console.log('eas.json valid')"
grep -q '"e2e-simulator"' eas.json && grep -q 'EXPO_PUBLIC_E2E' eas.json && echo "profile present"
```
Expected: `eas.json valid` and `profile present`.
(Authoritative validation is the local build in Task 5 / the first CI run — a release-config simulator build with the flag inlined.)

- [ ] **Step 3: Commit**

```bash
git add eas.json
git commit -m "ci: add e2e-simulator EAS build profile (EXPO_PUBLIC_E2E flavor)"
```

---

### Task 4: Rewrite the Maestro flows to be Metro-free

**Files:**
- Delete: `.maestro/helpers/open-dev-server.yaml`
- Delete: `.maestro/helpers/enable-compressed-plan.yaml`
- Modify: `.maestro/helpers/launch-and-onboard.yaml`
- Modify: `.maestro/helpers/start-first-session.yaml`
- Modify: `.maestro/tests/onboarding.yaml`

**Interfaces:**
- Consumes: the `e2e-simulator` build (compressed-by-default, no dev launcher) from Tasks 2–3.
- Produces: flows that launch the app directly (no port-8087 pick, no dev-launcher sheet, no compressed-plan toggle). `complete-onboarding.yaml`, `complete-session.yaml`, and `run-controls.yaml` are unchanged.

- [ ] **Step 1: Delete the two dev-launcher/toggle helpers**

```bash
git rm .maestro/helpers/open-dev-server.yaml .maestro/helpers/enable-compressed-plan.yaml
```

- [ ] **Step 2: Simplify `launch-and-onboard.yaml`**

Replace the full contents of `.maestro/helpers/launch-and-onboard.yaml`:

```yaml
appId: se.lukaslindqvist.myrunner
---
# E2E build launches straight to the app (no dev launcher). Clear state for a
# fresh install, then complete the single welcome step. Ends on the plan list.
- launchApp:
    clearState: true
- runFlow: complete-onboarding.yaml
```

- [ ] **Step 3: Simplify `start-first-session.yaml`**

Replace the full contents of `.maestro/helpers/start-first-session.yaml`:

```yaml
appId: se.lukaslindqvist.myrunner
---
# Fresh install → w1d1 session just started. The E2E build runs the compressed
# plan by default (EXPO_PUBLIC_E2E), so no Developer toggle step is needed.
- runFlow: launch-and-onboard.yaml
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

- [ ] **Step 4: Remove the dev-server reconnect from `onboarding.yaml`**

In `.maestro/tests/onboarding.yaml`, delete the conditional `runFlow` block that reconnects to Metro (it referenced the now-deleted helper). The file becomes:

```yaml
appId: se.lukaslindqvist.myrunner
tags:
  - onboarding
---
- runFlow: ../helpers/launch-and-onboard.yaml
- stopApp
- launchApp
# Onboarding must not restart after a relaunch: no welcome screen, plan list shows.
- assertNotVisible: "Welcome to" # welcome-marker
- assertVisible: "Week 1 ·.*"
- assertVisible: "Day 1"
```

- [ ] **Step 5: Verify no flow references a deleted helper**

Run:
```bash
grep -rn "open-dev-server\|enable-compressed-plan\|8087\|85%,27%" .maestro/ && echo "FOUND STALE REFERENCE" || echo "clean"
```
Expected: `clean` (no matches).
(Full flow execution is verified by the workflow on the first CI run — it needs the built app on a simulator.)

- [ ] **Step 6: Commit**

```bash
git add .maestro/
git commit -m "test: target the Metro-free E2E build in Maestro flows"
```

---

### Task 5: GitHub Actions E2E workflow

**Files:**
- Create: `.github/workflows/e2e.yml`

**Interfaces:**
- Consumes: `e2e-simulator` profile (Task 3), the rewritten flows (Task 4), secret `EXPO_TOKEN`.
- Produces: a job with context id `e2e-ios` (no `name:` override) used as the required check in Task 7.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/e2e.yml`:

```yaml
name: E2E

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: e2e-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  e2e-ios:
    runs-on: macos-15
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      # Required-check-safe short-circuit: default to RUNNING; skip the heavy
      # build only when a PR/push is provably docs-only. The job always reports a
      # conclusion, so it never hangs a required check (ci-checks spec learning).
      - name: Decide whether app-affecting files changed
        id: decide
        run: |
          if [ "${{ github.event_name }}" = "pull_request" ]; then
            BASE="${{ github.event.pull_request.base.sha }}"
          else
            BASE="${{ github.event.before }}"
          fi
          if ! git rev-parse --quiet --verify "${BASE}^{commit}" >/dev/null 2>&1; then
            echo "Unknown base ($BASE) — running to be safe."
            echo "run=true" >> "$GITHUB_OUTPUT"; exit 0
          fi
          FILES=$(git diff --name-only "$BASE" "${{ github.sha }}")
          echo "Changed files:"; echo "$FILES"
          run=false
          while IFS= read -r f; do
            [ -z "$f" ] && continue
            case "$f" in
              docs/*|*.md|.claude/*|LICENSE|.github/ISSUE_TEMPLATE/*) ;;
              *) run=true; break ;;
            esac
          done <<< "$FILES"
          [ -z "$FILES" ] && run=true
          echo "run=$run" >> "$GITHUB_OUTPUT"

      - name: Set up Bun
        if: steps.decide.outputs.run == 'true'
        uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version

      - name: Set up Java (Maestro requires a JDK)
        if: steps.decide.outputs.run == 'true'
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - name: Install dependencies (frozen)
        if: steps.decide.outputs.run == 'true'
        run: bun ci

      - name: Build E2E simulator app (local — zero EAS cloud minutes)
        if: steps.decide.outputs.run == 'true'
        env:
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
        run: |
          bunx eas-cli build \
            --platform ios \
            --profile e2e-simulator \
            --local \
            --non-interactive \
            --output "$RUNNER_TEMP/app.tar.gz"

      - name: Extract app and boot a simulator
        if: steps.decide.outputs.run == 'true'
        id: sim
        run: |
          mkdir -p "$RUNNER_TEMP/app"
          tar -xzf "$RUNNER_TEMP/app.tar.gz" -C "$RUNNER_TEMP/app"
          APP_PATH=$(find "$RUNNER_TEMP/app" -maxdepth 3 -name '*.app' -type d | head -1)
          echo "App: $APP_PATH"
          UDID=$(xcrun simctl list devices available --json \
            | jq -r '[.devices[][] | select(.name | test("^iPhone"))] | last | .udid')
          echo "Simulator UDID: $UDID"
          xcrun simctl boot "$UDID"
          xcrun simctl bootstatus "$UDID" -b
          xcrun simctl install "$UDID" "$APP_PATH"
          echo "udid=$UDID" >> "$GITHUB_OUTPUT"

      - name: Install Maestro
        if: steps.decide.outputs.run == 'true'
        run: |
          curl -fsSL "https://get.maestro.mobile.dev" | bash
          echo "$HOME/.maestro/bin" >> "$GITHUB_PATH"

      - name: Run Maestro suite
        if: steps.decide.outputs.run == 'true'
        run: maestro --device "${{ steps.sim.outputs.udid }}" test .maestro/

      - name: Upload Maestro artifacts on failure
        if: failure() && steps.decide.outputs.run == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: maestro-output
          path: ~/.maestro/tests/**
          if-no-files-found: ignore
```

- [ ] **Step 2: Lint the workflow YAML (best-effort)**

Run:
```bash
node -e "require('fs').readFileSync('.github/workflows/e2e.yml','utf8')" && echo "readable"
command -v actionlint >/dev/null && actionlint .github/workflows/e2e.yml || echo "actionlint not installed — skipped"
```
Expected: `readable`; actionlint clean if installed.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/e2e.yml
git commit -m "ci: add GitHub Actions Maestro E2E workflow (macos-15, local build)"
```

**First-CI-run verification notes** (validate on the PR, adjust if needed — these are the empirically-uncertain spots):
- `eas build --local` iOS-simulator output: confirm the tarball contains a single `*.app` at the extracted path; adjust the `find` depth if not.
- Simulator pick: `last` iPhone = newest model on the image; confirm its iOS runtime meets the app's deployment target (iOS 18 floor, ADR 0010). Pin an explicit device if the pick is wrong.
- Maestro CLI: confirm `maestro --device <udid> test` is the correct invocation for selecting the booted simulator on this Maestro version; the `cheat_sheet` MCP tool / https://docs.maestro.dev/llms.txt is the reference.

---

### Task 6: Documentation — ADR 0001 amendment + AGENTS.md

**Files:**
- Modify: `docs/adr/0001-local-first-maestro-e2e-testing.md`
- Modify: `AGENTS.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Amend ADR 0001**

Append a dated amendment section to `docs/adr/0001-local-first-maestro-e2e-testing.md` (keep the original Decision text; record the change rather than rewriting history):

```markdown
## Amendment (2026-07-13): GitHub Actions is the CI gate

The repo is public, so GitHub-hosted **standard macOS runners are free with
unlimited minutes** — the cost objection to a server-side gate no longer holds,
while the EAS Workflows `maestro` job still requires a paid plan. The E2E CI gate
is therefore a GitHub Actions workflow (`.github/workflows/e2e.yml`,
`e2e-ios` job), enforced as a required status check.

To run without Metro or the dev launcher, the suite targets a Metro-free
`e2e-simulator` build (an EAS build profile that sets `EXPO_PUBLIC_E2E=1`). The
compressed plan — previously `__DEV__`-only — is reachable via that flag
(`src/services/e2e.ts`) and default-on in the E2E build, so the flows no longer
drive the Developer toggle or the dev server. The dev-launcher helpers
(`open-dev-server.yaml`, `enable-compressed-plan.yaml`) are removed. Local
regression runs now build the `e2e-simulator` app; interactive dev-loop work
still uses the dev client + argent (the tool-split is unchanged). iOS only for
now; Android E2E on free Linux runners is a possible follow-up.

Design: `docs/superpowers/specs/2026-07-13-github-actions-maestro-e2e-design.md`.
The EAS `maestro` job remains the option to revisit if a paid EAS plan is adopted.
```

- [ ] **Step 2: Update the AGENTS.md E2E section**

In `AGENTS.md`, under "# E2E tests (Maestro)", make these edits:
- Change the opening line from "run **locally**" to note the CI gate:
  > E2E tests are Maestro flows in `.maestro/tests/`, run **locally against the `e2e-simulator` build** and enforced in CI by `.github/workflows/e2e.yml` (the `e2e-ios` required check) — see [ADR 0001](docs/adr/0001-local-first-maestro-e2e-testing.md).
- In **Prerequisites**, replace the `bun run ios` dev-client build with: build the E2E app via `eas build --local -p ios -e e2e-simulator`, install it on a booted simulator; the suite no longer needs Metro or the dev client.
- In **Selectors**, remove the `xmark` dev-launcher and `85%,27%` compressed-plan-toggle escape hatches from the "currently" list (both flow steps are deleted); keep the `plan-next-*` arrow id.
- Delete the **"Dev-only compressed plan"** bullet and replace with: the `e2e-simulator` build sets `EXPO_PUBLIC_E2E=1`, which makes the seconds-long compressed plan reachable (`src/services/e2e.ts`) and default-on, so a full session finishes in seconds with no toggle interaction.

- [ ] **Step 3: Verify references resolve**

Run:
```bash
grep -q "e2e-simulator" AGENTS.md && grep -q "e2e-ios" docs/adr/0001-local-first-maestro-e2e-testing.md && echo "docs updated"
grep -rn "85%,27%\|open-dev-server\|xmark" AGENTS.md && echo "STALE DOC REFERENCE" || echo "clean"
```
Expected: `docs updated` and `clean`.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/adr/0001-local-first-maestro-e2e-testing.md
git commit -m "docs: record GitHub Actions E2E gate (amend ADR 0001, update AGENTS.md)"
```

---

### Task 7: Full local gate, PR, and required-check enforcement

**Files:** none (verification + repo config).

**Interfaces:** consumes everything above.

- [ ] **Step 1: Generate typed routes so typecheck/lint can run in this fresh worktree**

The worktree lacks the gitignored `expo-env.d.ts` and `.expo/types/router.d.ts` (typed routes), so `tsc` fails until they exist. Start the dev server briefly to generate them, then stop it:

```bash
bun expo start --port 8099 >/tmp/expo-gen.log 2>&1 &
EXPO_PID=$!
for i in $(seq 1 60); do [ -f .expo/types/router.d.ts ] && break; sleep 1; done
kill "$EXPO_PID" 2>/dev/null || true
ls .expo/types/router.d.ts expo-env.d.ts
```
Expected: both files listed. (Do not commit them — they are gitignored. Never copy `.expo/types/router.d.ts` from another checkout.)

- [ ] **Step 2: Run the full local gate**

Run:
```bash
bun test && bun run typecheck && bun run lint
```
Expected: unit suite passes; `tsc --noEmit` clean; `expo lint` clean (ADR 0014 rules). Fix any issues before opening the PR.

- [ ] **Step 3: Push the branch and open one PR (spec + implementation)**

```bash
git push -u origin worktree-github-actions-e2e
gh pr create --title "ci: add GitHub Actions Maestro E2E gate" \
  --body "Implements docs/superpowers/specs/2026-07-13-github-actions-maestro-e2e-design.md — a free, required iOS E2E check on public-repo macOS runners against a Metro-free e2e-simulator build. Spec + implementation in one PR."
```

- [ ] **Step 4: Confirm the `e2e-ios` job runs green on the PR**

Watch the run; iterate on the "first-CI-run verification notes" from Task 5 if the build/extract/Maestro steps need adjustment:
```bash
gh pr checks --watch
```
Expected: `e2e-ios` succeeds; a docs-only follow-up commit would show `e2e-ios` green without building (verify opportunistically).

- [ ] **Step 5: Add `e2e-ios` as a required status check (after first green run)**

Add the `e2e-ios` context to the existing `protect-main` ruleset (id `18800808`) alongside `checks`, keeping `integration_id: 15368` and `strict_required_status_checks_policy: false`. Inspect the current ruleset first, then update its `required_status_checks` rule:

```bash
gh api repos/ljukas/my-runner/rulesets/18800808 --jq '.rules[] | select(.type=="required_status_checks")'
# Then PUT the ruleset back with e2e-ios added to required_status_checks.required_status_checks[]
# (context: "e2e-ios", integration_id: 15368). Verify the exact JSON shape from the GET before PUT.
```
Expected: the ruleset lists both `checks` and `e2e-ios` as required; merges are blocked until `e2e-ios` passes.

- [ ] **Step 6: Merge**

Once `e2e-ios` and `checks` are green and the PR is approved, squash-merge (the `ci:` title becomes the commit in `main`; release-please treats `ci:` as non-releasing).

---

## Notes on execution order

Tasks 1–6 are committed on `worktree-github-actions-e2e` and can be implemented back-to-back (1→2 have a hard dependency; 3–6 are independent of each other but all precede Task 7). Task 7 is the integration/verification gate and the only task that leaves the local machine.
