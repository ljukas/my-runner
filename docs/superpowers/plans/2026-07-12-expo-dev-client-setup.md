# Expo Dev Client Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch local development from Expo Go to expo-dev-client development builds, so `eas build --profile production` stops warning about Expo Go and the project is ready for custom native modules (HealthKit, background location — ADRs 0008/0011).

**Architecture:** Install `expo-dev-client` as a dependency (its native code is debug-only; release builds are unaffected). Local iOS development compiles the dev client onto the simulator via `expo run:ios` (CNG prebuild under the hood), after which day-to-day work uses `expo start` + the installed dev client. EAS keeps the existing `development` (device) profile and gains a `development-simulator` variant.

**Tech Stack:** Expo SDK 57, expo-dev-client, EAS Build, Bun, Argent (simulator verification).

## Global Constraints

- Expo SDK 57 / RN 0.86 / React 19.2 — read versioned docs, do not trust memorized APIs (AGENTS.md).
- Bun is the package manager: `bun expo install <pkg>` for anything Expo touches; `bun.lock` is the only lockfile.
- `/ios` and `/android` are gitignored (CNG) — never commit generated native folders.
- Never weaken `fingerprint.config.js` or `runtimeVersion: { policy: "fingerprint" }` (ADR 0012).
- No backend, no web target.
- PR titles follow Conventional Commits (squash-merge; title becomes the `main` commit and drives release-please).
- Any change affecting the running app must be verified on the iOS simulator via Argent tools before it's considered done.

**Fingerprint note:** capture the native fingerprint on `main` BEFORE any change (Task 1), and again after (Task 4). Adding a native dependency and putting `run` into the `ios`/`android` package.json scripts (the `PackageJsonAndroidAndIosScriptsIfNotContainRun` source-skip stops applying once they contain "run") are both expected to change the hash. That is correct behavior — the next release must be a native build, not OTA — and is harmless now because no store build has shipped yet (v0.0.1, store secrets still pending). Record both hashes in the PR description.

---

### Task 1: Baseline fingerprint + feature branch

**Files:**
- Create: `<scratchpad>/fingerprint-before.json` (temporary, not committed)

**Interfaces:**
- Produces: `fingerprint-before.json` — consumed by Task 4's comparison step.

- [ ] **Step 1: Capture the pre-change iOS fingerprint on `main`**

```bash
cd /Users/lukas/my-runner
bunx expo-updates fingerprint:generate --platform ios > "$SCRATCHPAD/fingerprint-before.json"
```

Expected: JSON output containing a `"hash"` field. If the CLI syntax differs on this expo-updates version, check `bunx expo-updates --help` — do not guess.

- [ ] **Step 2: Create the feature branch (NOT a worktree — per user instruction)**

```bash
git checkout -b feat/expo-dev-client
```

Expected: `Switched to a new branch 'feat/expo-dev-client'`

### Task 2: Install expo-dev-client

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `bun.lock`

**Interfaces:**
- Produces: `expo-dev-client` dependency at the SDK 57-compatible version pinned by `bun expo install`.

- [ ] **Step 1: Install at the SDK-compatible version**

```bash
bun expo install expo-dev-client
```

Expected: `expo-dev-client` added to `package.json` dependencies at the version Expo pins for SDK 57 (accept whatever `expo install` chooses; do not hand-edit the version).

- [ ] **Step 2: Verify the diff is only package.json + bun.lock**

```bash
git status --porcelain && git diff package.json
```

Expected: only `package.json` and `bun.lock` modified; diff shows one added dependency line.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "build: add expo-dev-client for development builds"
```

(1Password signing may transiently fail with "failed to fill whole buffer" — retry once, never disable signing.)

### Task 3: EAS simulator profile + run scripts

**Files:**
- Modify: `eas.json` (build profiles)
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: existing `development` profile (`developmentClient: true`, `distribution: internal`).
- Produces: `development-simulator` build profile; `bun run ios` / `bun run android` that compile-and-run.

- [ ] **Step 1: Add the `development-simulator` profile to `eas.json`**

The `build` section becomes:

```json
"build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "development-simulator": {
      "extends": "development",
      "ios": {
        "simulator": true
      }
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview"
    },
    "production": {
      "autoIncrement": true,
      "channel": "production"
    }
  },
```

- [ ] **Step 2: Point the `ios`/`android` scripts at compile-and-run**

In `package.json` scripts, replace:

```json
"android": "expo start --android",
"ios": "expo start --ios",
```

with:

```json
"android": "expo run:android",
"ios": "expo run:ios",
```

Rationale: with a dev client, `expo start --ios` can no longer install the app (nothing is on the simulator until a native build exists), and these exact values are what prebuild rewrites the scripts to on the EAS worker, so committing them keeps local and EAS fingerprints identical (see `fingerprint.config.js`).

- [ ] **Step 3: Commit**

```bash
git add eas.json package.json
git commit -m "build: add development-simulator EAS profile and run:ios scripts"
```

### Task 4: Verify on the iOS simulator

**Files:** none (verification only)

**Interfaces:**
- Consumes: `<scratchpad>/fingerprint-before.json` from Task 1.

- [ ] **Step 1: Static checks**

```bash
bun run lint && bun run typecheck
```

Expected: both pass with no errors.

- [ ] **Step 2: Build and launch the dev client on the iOS simulator**

Load the Argent skills (`argent-ios-simulator-setup`, `argent-react-native-app-workflow`) / the repo `verify` skill first, then build with:

```bash
bun expo run:ios
```

Expected: local Xcode build succeeds, app `se.lukaslindqvist.myrunner` installs on the booted simulator, Metro starts, and the app renders the existing Home tab (starter screens).

- [ ] **Step 3: Prove the dev client is present**

Using Argent tools, open the dev menu (`bun expo start` terminal `m`, or Argent `button` shake) and capture a screenshot showing the expo-dev-client developer menu / launcher UI. This distinguishes a dev-client build from Expo Go.

- [ ] **Step 4: Compare fingerprints**

```bash
bunx expo-updates fingerprint:generate --platform ios > "$SCRATCHPAD/fingerprint-after.json"
diff <(jq -r .hash "$SCRATCHPAD/fingerprint-before.json") <(jq -r .hash "$SCRATCHPAD/fingerprint-after.json")
```

Expected: hashes DIFFER (native dep added + scripts now contain "run"). Record both hashes for the PR description. If they do NOT differ, investigate before proceeding — the release gate depends on fingerprint honesty.

### Task 5: Docs + PR

**Files:**
- Modify: `AGENTS.md` (Commands section)
- Create: `docs/superpowers/plans/2026-07-12-expo-dev-client-setup.md` (this plan, committed for the record)

- [ ] **Step 1: Update the Commands section of AGENTS.md**

Replace:

```markdown
- `bun run start` (or `bun expo start`) — start the dev server; press `i`/`a` for iOS simulator or Android emulator
- `bun run ios` / `bun run android` — start directly on a platform
```

with:

```markdown
- `bun run start` (or `bun expo start`) — start the dev server; press `i`/`a` to open the app in the installed dev client on the iOS simulator or Android emulator
- `bun run ios` / `bun run android` — compile and install a dev-client build (`expo run:ios` / `expo run:android`) and start the dev server; required on first run and after any native change (new native dependency, config plugin, native app.json fields). The app uses expo-dev-client, not Expo Go.
```

- [ ] **Step 2: Commit docs + plan**

```bash
git add AGENTS.md docs/superpowers/plans/2026-07-12-expo-dev-client-setup.md
git commit -m "docs: document dev-client workflow in AGENTS.md"
```

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/expo-dev-client
gh pr create --title "build: set up expo-dev-client development builds" --body "<summary; include before/after fingerprint hashes and simulator verification evidence>"
```

Expected: PR against `main`, title in Conventional Commits form (becomes the squash commit). Do not merge — leave for review.

---

## Execution Outcome (2026-07-12)

- Baseline fingerprint (`main`): `9518906ffebe0153f888c7a52595ae91ee2f6c0c`
- After (`feat/expo-dev-client`): `560a84b1a07609bbbcf42d7a2c75e2db9c0cdc44` — cross-confirmed: the dev menu on the simulator displays this exact hash as its "Runtime version".
- Measured fingerprint delta: `eas.json`, `expoAutolinkingConfig:ios`, and the new native sources `expo-dev-client/ios`, `expo-dev-launcher`, `expo-dev-menu`, `expo-dev-menu-interface/ios`. **Correction to the note above:** the `run:` scripts change did NOT enter the fingerprint — package.json scripts are not among the fingerprint sources here; the hash change is entirely the dev-client native modules.
- Dev client verified on the iPhone 17 simulator: local build succeeded, app launched via the `exp+runtastic://expo-development-client/?url=…` deep link with Metro on port 8090, expo-dev-menu opened via shake (Reload / Go home / element inspector / performance monitor / DevTools all present).
- Discovered during execution (not in the original tasks): `.claude/skills/verify/SKILL.md` step 3 still described the Expo Go flow as current — rewritten for the dev-client flow in this PR.

## Self-Review

- Spec coverage: warning-fix (install dev client) ✓ Task 2; simulator workflow ✓ Tasks 3–4; EAS profile ✓ Task 3; docs ✓ Task 5; fingerprint honesty (ADR 0012) ✓ Tasks 1 & 4.
- No placeholders: exact commands and full config blocks included; the only deferred value is the `expo-dev-client` version, which is intentionally delegated to `bun expo install`.
- Type consistency: n/a (no code interfaces).
