# App Variants (dev + e2e side-by-side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `development` and `e2e` builds install side-by-side on one device, each with a distinct home-screen name and deep-link scheme, selected by an `APP_VARIANT` build-time environment variable.

**Architecture:** A dynamic `app.config.ts` is layered over the static `app.json`. Expo reads `app.json` first and passes it to the default-exported function as `config`; the function spreads it and overrides only `name` / `scheme` / `ios.bundleIdentifier` / `android.package` based on `process.env.APP_VARIANT`. `APP_VARIANT` is set per EAS build profile and in local dev scripts; unset resolves to the clean production identity.

**Tech Stack:** Expo SDK 57, EAS Build (`eas.json`), Maestro E2E (`.maestro/`), GitHub Actions (`.github/workflows/e2e.yml`), Bun.

## Global Constraints

- **Design source:** `docs/superpowers/specs/2026-07-15-app-variants-design.md` and `docs/adr/0019-app-variants-dynamic-config.md`. Read both first.
- **Identity table (verbatim):**
  - unset → name `my-runner`, bundle id `se.lukaslindqvist.myrunner`, scheme `myrunner`
  - `development` → name `my-runner.dev`, bundle id `se.lukaslindqvist.myrunner.dev`, scheme `myrunnerdev`
  - `e2e` → name `my-runner.e2e`, bundle id `se.lukaslindqvist.myrunner.e2e`, scheme `myrunnere2e`
- **Do NOT change** `slug` (`runtastic`), `owner`, `extra.eas.projectId`, or `updates.url` — one EAS project across all variants.
- **`app.json` stays a JSON file** — release-please owns its `version` field (ADR 0012). `app.config.ts` only augments; never delete or rename `app.json`.
- **Production/preview must resolve to the clean identity** — never set `APP_VARIANT` in the `preview` or `production` profiles.
- **Reconciliation before you start (IMPORTANT):** `eas.json`, `package.json`, and `app.json` are edited by concurrent in-flight work (a Stage-2 branch and an iOS-only/build-profile cleanup that removes the `development-simulator`/`internal` profiles and adds `platforms: ["ios"]`). This plan's exact edits target `main` **as it is at branch-off** (below). Before editing, `git fetch` and re-read `eas.json` + `package.json`; if the build-profile cleanup has merged, apply the same intent to whatever dev profiles/scripts exist (set `APP_VARIANT=development` on every development profile and every local dev-client script). The `app.config.ts` file and the identity logic do not change regardless.
- **Baseline of `main` at branch-off** (verify still current):
  - `eas.json` build profiles: `development` (developmentClient, internal, device), `development-simulator` (extends `development`, `ios.simulator`), `preview`, `internal`, `e2e-simulator` (extends `preview`, `ios.simulator`, `env.EXPO_PUBLIC_E2E=1`), `production`.
  - `package.json` scripts: `"start": "expo start"`, `"android": "expo run:android"`, `"ios": "expo run:ios"`.
  - `app.json`: `name` `my-runner`, `scheme` `myrunner`, `ios.bundleIdentifier` / `android.package` `se.lukaslindqvist.myrunner`.
- **Worktree setup:** run `bun ci` (or `bun install`) once before any `expo`/`eas`/`typecheck` command — the worktree starts without `node_modules`. `bun run typecheck` additionally needs the gitignored `expo-env.d.ts` and `.expo/types/router.d.ts`; if missing, run `bun expo start --port 8099` and kill it as soon as `.expo/types/router.d.ts` appears (per AGENTS.md). `npx expo config` does NOT need those generated files.
- **Commits:** Conventional Commits. Every commit message ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  Commits are 1Password-signed; if a commit fails with `1Password: failed to fill whole buffer`, retry it (it is transient — retry a few times).
- This is build-configuration only — there is no `bun test` unit surface; verification is `npx expo config` assertions, a local fingerprint check, and the Maestro suite against a real build.

---

### Task 1: `app.config.ts` variant resolver

**Files:**
- Create: `app.config.ts` (repo root, alongside `app.json`)

**Interfaces:**
- Consumes: the normalized `app.json` as `config` (Expo passes it in).
- Produces: nothing importable — this is Expo's config entry point. Downstream tasks rely only on the *resolved config values* per the identity table.

- [ ] **Step 1: Write `app.config.ts`**

```ts
import { ExpoConfig, ConfigContext } from 'expo/config';

// Selects the app identity from APP_VARIANT so the development and e2e builds
// install side-by-side (distinct bundle id + name + scheme). Unset (production /
// preview) keeps the clean identity. See ADR 0019.
export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT; // 'development' | 'e2e' | undefined

  const idSuffix =
    variant === 'development' ? '.dev' : variant === 'e2e' ? '.e2e' : '';
  const schemeSuffix =
    variant === 'development' ? 'dev' : variant === 'e2e' ? 'e2e' : '';

  return {
    ...config,
    name: `${config.name}${idSuffix}`,
    scheme: `${config.scheme}${schemeSuffix}`,
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios?.bundleIdentifier ?? ''}${idSuffix}`,
    },
    android: {
      ...config.android,
      package: `${config.android?.package ?? ''}${idSuffix}`,
    },
  };
};
```

- [ ] **Step 2: Verify the default (unset) resolves to the clean identity**

Run:
```bash
npx expo config --json | jq '{name, scheme, iosId: .ios.bundleIdentifier, androidId: .android.package}'
```
Expected:
```json
{ "name": "my-runner", "scheme": "myrunner", "iosId": "se.lukaslindqvist.myrunner", "androidId": "se.lukaslindqvist.myrunner" }
```

- [ ] **Step 3: Verify the `development` variant**

Run:
```bash
APP_VARIANT=development npx expo config --json | jq '{name, scheme, iosId: .ios.bundleIdentifier, androidId: .android.package}'
```
Expected:
```json
{ "name": "my-runner.dev", "scheme": "myrunnerdev", "iosId": "se.lukaslindqvist.myrunner.dev", "androidId": "se.lukaslindqvist.myrunner.dev" }
```

- [ ] **Step 4: Verify the `e2e` variant**

Run:
```bash
APP_VARIANT=e2e npx expo config --json | jq '{name, scheme, iosId: .ios.bundleIdentifier, androidId: .android.package}'
```
Expected:
```json
{ "name": "my-runner.e2e", "scheme": "myrunnere2e", "iosId": "se.lukaslindqvist.myrunner.e2e", "androidId": "se.lukaslindqvist.myrunner.e2e" }
```

- [ ] **Step 5: Confirm `infoPlist` / icons / plugins survived the merge**

Run:
```bash
npx expo config --json | jq '.ios.infoPlist.ITSAppUsesNonExemptEncryption, .ios.icon, (.plugins | length)'
```
Expected: `false`, `"./assets/expo.icon"`, and a plugin count matching `app.json` (non-zero) — proves the `ios` spread did not drop keys.

- [ ] **Step 6: Commit**

```bash
git add app.config.ts
git commit -m "feat: add app.config.ts variant resolver (APP_VARIANT identity)" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire `APP_VARIANT` into EAS profiles and local dev scripts

**Files:**
- Modify: `eas.json` (add `env.APP_VARIANT` to `development` and `development-simulator`; add to `e2e-simulator.env`)
- Modify: `package.json` (prefix `start` / `ios` / `android` scripts with `APP_VARIANT=development`)

**Interfaces:**
- Consumes: the resolver from Task 1 (reads `APP_VARIANT`).
- Produces: build profiles and local scripts that set the variant; the e2e profile now builds bundle id `se.lukaslindqvist.myrunner.e2e` (Task 3 depends on this value).

- [ ] **Step 1: Add `APP_VARIANT=development` to the dev EAS profiles**

Edit `eas.json` so both dev profiles carry it (reconcile per Global Constraints if the cleanup merged):
```jsonc
"development": {
  "developmentClient": true,
  "distribution": "internal",
  "env": { "APP_VARIANT": "development" }
},
"development-simulator": {
  "extends": "development",
  "ios": { "simulator": true }
}
```
(`development-simulator` inherits `env` via `extends`, so it needs no own `env`.)

- [ ] **Step 2: Add `APP_VARIANT=e2e` to the e2e profile**

Edit the `e2e-simulator` profile's `env` to include both keys:
```jsonc
"e2e-simulator": {
  "extends": "preview",
  "ios": { "simulator": true },
  "autoIncrement": false,
  "env": { "EXPO_PUBLIC_E2E": "1", "APP_VARIANT": "e2e" }
}
```

- [ ] **Step 3: Prefix the local dev scripts**

Edit `package.json` scripts:
```jsonc
"start": "APP_VARIANT=development expo start",
"android": "APP_VARIANT=development expo run:android",
"ios": "APP_VARIANT=development expo run:ios",
```

- [ ] **Step 4: Verify the EAS profile env is set**

Run:
```bash
jq '.build.development.env, .build["e2e-simulator"].env' eas.json
```
Expected: `{ "APP_VARIANT": "development" }` and `{ "EXPO_PUBLIC_E2E": "1", "APP_VARIANT": "e2e" }`.

- [ ] **Step 5: Verify the local scripts carry the variant**

Run:
```bash
jq -r '.scripts.start, .scripts.ios, .scripts.android' package.json
```
Expected: each line begins with `APP_VARIANT=development `.

- [ ] **Step 6: Commit**

```bash
git add eas.json package.json
git commit -m "build: select dev/e2e app variant via APP_VARIANT in eas.json + scripts" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Move the e2e `appId` and align the CI fingerprint env

**Files:**
- Modify: `.maestro/tests/*.yaml` (every `appId:` header)
- Modify: `.github/workflows/e2e.yml` (add job-level `env: APP_VARIANT: e2e`)

**Interfaces:**
- Consumes: the e2e bundle id `se.lukaslindqvist.myrunner.e2e` produced by Task 2.
- Produces: a Maestro suite and CI pipeline that target/build the e2e variant consistently.

- [ ] **Step 1: Update every Maestro flow's `appId`**

For each file in `.maestro/tests/` (currently `complete-session.yaml`, `onboarding.yaml`, `run-controls.yaml`) change the header line:
```yaml
appId: se.lukaslindqvist.myrunner
```
to:
```yaml
appId: se.lukaslindqvist.myrunner.e2e
```
Also check `.maestro/helpers/` for any `appId:` (flows referenced via `runFlow:` inherit the caller's `appId`, but replace any explicit ones you find).

- [ ] **Step 2: Verify no stale appId remains**

Run:
```bash
grep -rn "appId:" .maestro/ | grep -v "\.e2e$"
```
Expected: no output (every `appId:` now ends in `.e2e`).

- [ ] **Step 3: Set `APP_VARIANT=e2e` job-wide in the E2E workflow**

In `.github/workflows/e2e.yml`, add a job-level `env` to the `e2e-ios` job so the fingerprint step, build, and repack all see the same variant. Insert directly under `runs-on: macos-26` (before `timeout-minutes`):
```yaml
  e2e-ios:
    needs: precheck
    if: needs.precheck.outputs.run == 'true'
    runs-on: macos-26
    env:
      APP_VARIANT: e2e
    timeout-minutes: 45
```
(The build itself already gets `APP_VARIANT` from the `e2e-simulator` profile env; this makes the `Compute native fingerprint` step's cache key match the built app's embedded `runtimeVersion`.)

- [ ] **Step 4: Local sanity — the fingerprint depends on the variant**

Show that the fingerprint hash differs by variant (proving why the CI env must match the build):
```bash
echo "default:"; npx expo-updates fingerprint:generate --platform ios 2>/dev/null | jq -r .hash
echo "e2e:";     APP_VARIANT=e2e npx expo-updates fingerprint:generate --platform ios 2>/dev/null | jq -r .hash
```
Expected: two **different** non-empty hashes.

- [ ] **Step 5: Commit**

```bash
git add .maestro .github/workflows/e2e.yml
git commit -m "test: point Maestro appId + CI fingerprint at the e2e app variant" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Documentation ripples

**Files:**
- Modify: `AGENTS.md` (E2E section `appId`; add ADR 0019 to the ADR index; short app-variants note)

**Interfaces:** none — docs only.

- [ ] **Step 1: Update the E2E `appId` reference in `AGENTS.md`**

Find the line stating the app launches via `appId` `se.lukaslindqvist.myrunner` (set as `ios.bundleIdentifier` and `android.package`). Amend it to record that the **e2e build** uses `se.lukaslindqvist.myrunner.e2e`, and add one sentence: "App identity is variant-driven via `APP_VARIANT` (ADR 0019): `development` → `…myrunner.dev` / scheme `myrunnerdev`, `e2e` → `…myrunner.e2e` / scheme `myrunnere2e`, unset → the clean production identity."

- [ ] **Step 2: Add ADR 0019 to the ADR index in `AGENTS.md`**

Under "Design docs & ADRs", after the ADR 0017 line, add:
```markdown
- [ADR 0019 — App variants via dynamic app.config.ts selected by APP_VARIANT](docs/adr/0019-app-variants-dynamic-config.md)
```
(Note: ADR 0018 is owned by separate in-flight work; do not add or renumber it here.)

- [ ] **Step 3: Verify the edits**

Run:
```bash
grep -n "myrunner.e2e\|APP_VARIANT\|0019-app-variants" AGENTS.md
```
Expected: matches for the e2e appId, the `APP_VARIANT` note, and the ADR 0019 index line.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: record app variants (APP_VARIANT) and ADR 0019 in AGENTS.md" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Acceptance — build both variants and prove coexistence

**Files:** none (verification only). This task is the acceptance gate; it runs real native builds and is long-running.

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: evidence that dev + e2e install side-by-side and the E2E suite passes against the `.e2e` build.

- [ ] **Step 1: Boot a simulator (per `.claude/rules/argent.md`)**

Use the argent iOS setup skill / `list-devices` → `boot-device` to get a booted simulator UDID. Record it as `$UDID`.

- [ ] **Step 2: Build + install the development (simulator) variant**

Run (long-running native build; needs `EXPO_TOKEN` in env):
```bash
bunx eas-cli build --platform ios --profile development-simulator --local --non-interactive --output /tmp/dev.tar.gz
mkdir -p /tmp/dev && tar -xzf /tmp/dev.tar.gz -C /tmp/dev
xcrun simctl install "$UDID" "$(find /tmp/dev -maxdepth 3 -name '*.app' -type d | head -1)"
```

- [ ] **Step 3: Build + install the e2e variant**

Run:
```bash
bash .github/scripts/build-e2e-sim-app.sh /tmp/e2e
xcrun simctl install "$UDID" /tmp/e2e/app.app
```

- [ ] **Step 4: Confirm BOTH apps are installed with distinct bundle ids**

Run:
```bash
xcrun simctl listapps "$UDID" | grep -o 'se\.lukaslindqvist\.myrunner[^"]*' | sort -u
```
Expected: both `se.lukaslindqvist.myrunner.dev` and `se.lukaslindqvist.myrunner.e2e` present.

- [ ] **Step 5: Confirm distinct home-screen names**

Screenshot the home screen via argent (`screenshot`) and visually confirm two apps with names `my-runner.dev` and `my-runner.e2e` (labels may be truncated to `my-runner.d…` / `my-runner.e…` on the springboard — full names appear in the App Switcher/Settings, per the spec's cosmetic caveat).

- [ ] **Step 6: Run the full Maestro suite against the e2e build**

Run:
```bash
maestro --device "$UDID" test .maestro/
```
Expected: all flows pass — proving the e2e build is correctly identified by its new `.e2e` appId and the compressed plan still runs.

- [ ] **Step 7: No commit** — verification only. Record results (pass/fail, screenshot) in the PR description.

---

## Self-Review

**Spec coverage:**
- Approach / `app.config.ts` layering → Task 1. ✓
- Variant identity table → Task 1 (verified) + Global Constraints. ✓
- `eas.json` profile env → Task 2. ✓
- Local dev scripts + `prebuild --clean` note → Task 2 (+ spec). ✓
- Maestro `appId` → Task 3. ✓
- CI fingerprint env agreement → Task 3. ✓
- Docs/AGENTS.md + ADR index → Task 4. ✓
- Invariants (release-please app.json, single EAS project, per-variant fingerprint) → Global Constraints + Task 1 Step 5 / Task 3 Step 4. ✓
- Verification (side-by-side install + Maestro) → Task 5. ✓
- Memory / verify-skill `myrunner://` → dev scheme note: handled outside the repo by the author (memory files live in `~/.claude`); AGENTS.md carries the in-repo record (Task 4). Flagged here so it is not lost.

**Placeholder scan:** No TBD/TODO; every code and command step is concrete. The only deferred item is the Global-Constraints reconciliation, which is a deliberate, instructed adjustment (not a placeholder).

**Type consistency:** Identity values (`.dev`/`.e2e`, `myrunnerdev`/`myrunnere2e`, `se.lukaslindqvist.myrunner.*`) are identical across Tasks 1–5 and the Global Constraints table. `APP_VARIANT` values (`development`, `e2e`) are consistent between `app.config.ts`, `eas.json`, scripts, and the workflow.
