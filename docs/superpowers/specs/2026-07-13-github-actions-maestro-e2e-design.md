# GitHub Actions Maestro E2E (iOS) — design

Date: 2026-07-13
Status: Approved design, pending implementation

## Goal

Run the Maestro E2E suite as a **free, required status check** on every
app-affecting PR, using a GitHub-hosted **macOS runner** (standard runners are
free with unlimited minutes on public repositories) driving a **Metro-free E2E
simulator build**.

This supersedes the deferred plan in
[ADR 0001](../../adr/0001-local-first-maestro-e2e-testing.md) to make the EAS
Workflows `maestro` job the CI gate: that job needs a paid EAS plan, so on this
public repo GitHub Actions gives the same enforcement at zero cost. iOS only at
this stage (iOS is the primary target); Android is a possible later follow-up on
free Linux runners.

## Context / key facts (verified)

- **macOS runners are free on public repos.** Standard GitHub-hosted runners
  (`macos-14`, `macos-15`, `macos-latest`) are free with unlimited minutes for
  public repositories. The `$0.062/min` macOS rate and "mobile CI is expensive"
  warnings apply only to **private** repos and to **larger** runners (which we
  do not use).
- **The compressed plan is `__DEV__`-gated in two places**, so the current
  suite cannot run against a normal release build:
  - `src/app/(tabs)/settings.tsx:20` — the Developer section (compressed-plan
    toggle) only renders when `__DEV__`.
  - `src/services/active-plan.ts:7` — `__DEV__ && compressed ? COMPRESSED_PLAN
    : NHS_PLAN`, commented *"unreachable in release builds."*
- **The current flows drive the dev-launcher + Metro** (`open-dev-server.yaml`
  waits for a `.*8087.*` URL and dismisses the dev-client intro sheet). The
  `open-dev-server.yaml` comment already anticipates *"when the EAS CI gate runs
  these flows against release builds with no dev-launcher."*
- **`eas build --local` fits the "flavor" model and stays free.** EAS merges
  `{ ...serverEnvVars, ...buildProfile.env }` and embeds `EXPO_PUBLIC_*` vars
  into the JS bundle at build time (`evaluateConfigWithEnvVarsAsync.ts`,
  `readAppConfig`), for local builds too. `--local` builds run entirely on the
  runner and consume **zero EAS cloud build minutes**. Simulator builds need
  **no code signing** (no Apple credentials).
- **`EXPO_TOKEN` is required but already set.** With `cli.appVersionSource:
  "remote"` (eas.json), EAS resolves the build number from its server
  (`resolveRemoteBuildNumberAsync` → GraphQL client) even for `--local` builds,
  so the job must be authenticated. `EXPO_TOKEN` is already configured as a
  repo secret. This is a free API read, not a cloud build.

Sources for the pricing facts:
[Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing),
[GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## Decisions

### 1. E2E build flavor — `eas.json`

Add a build profile that produces a **release-style simulator build** (bundle
embedded, `__DEV__ === false`, no Metro, no signing) and carries the flag:

```jsonc
"e2e-simulator": {
  "extends": "preview",
  "ios": { "simulator": true },
  "autoIncrement": false,
  "env": { "EXPO_PUBLIC_E2E": "1" }
}
```

- `extends: "preview"` → release configuration, `internal` distribution, no dev
  client. Do **not** touch the `cli.appVersionSource: "remote"` setting
  (release-please/EAS own it — see AGENTS.md "Releases").
- `autoIncrement: false` → the E2E build never mutates the remote build number.
- `env.EXPO_PUBLIC_E2E` lives here and **only** here, so `preview`/`production`
  store builds never receive it.
- The build keeps the same `appId` (`se.lukaslindqvist.myrunner`) so Maestro
  flows need no `appId` change.

### 2. Compressed-plan reachability — product code (helper, not inline)

New `src/services/e2e.ts`:

```ts
/** Build-time flag: set only by the eas.json `e2e-simulator` profile. */
export const E2E = process.env.EXPO_PUBLIC_E2E === '1';

/**
 * The compressed dev/E2E plan is reachable only in dev or E2E builds — never in
 * production. (`__DEV__` is referenced only inside this function body, so
 * pure-TS `bun test` importers that never call it stay runtime-clean.)
 */
export function compressedPlanReachable(): boolean {
  return __DEV__ || E2E;
}
```

- `src/services/active-plan.ts` → `return compressedPlanReachable() && compressed
  ? COMPRESSED_PLAN : NHS_PLAN;`, and its comment updated to *"reachable only in
  dev or E2E builds."*
- `src/services/settings.ts` → default `useCompressedPlan` to `E2E` (import the
  env-only `E2E` constant, **not** `compressedPlanReachable`, to keep
  `settings.ts` free of a top-level `__DEV__` reference for `bun test`). Result:
  the E2E build ships with the compressed plan already active; dev defaults to
  `false` (toggle to enable — unchanged local behavior); production is
  unreachable regardless.
- `src/app/(tabs)/settings.tsx` is **unchanged** — the Developer section stays
  `__DEV__`-only. The E2E flow never opens it (see §3), so it need not render in
  the E2E build.

**Why this shape:** it removes the single most device-fragile flow step (the
`85%,27%` toggle point-tap) entirely, keeps the product change to one behavior
(plan selection), and preserves the "compressed plan is unreachable in
production" safety property via a purpose-built flag rather than loosening
`__DEV__`.

### 3. Maestro flow adaptations — Metro-free

The regression suite standardizes on the E2E build **everywhere** (local and
CI). The dev-launcher helpers are removed:

- **Delete** `.maestro/helpers/open-dev-server.yaml` and
  `.maestro/helpers/enable-compressed-plan.yaml`.
- `.maestro/helpers/launch-and-onboard.yaml` → `launchApp: { clearState: true }`
  then `runFlow: complete-onboarding.yaml` (no dev-server step).
- `.maestro/helpers/start-first-session.yaml` → drop the
  `enable-compressed-plan.yaml` step; keep the Week-1 Day-1 `scrollUntilVisible`
  → tap → `Start session`.
- `.maestro/helpers/complete-onboarding.yaml` and `.maestro/tests/*.yaml`
  unchanged.

**Consequence:** running the Maestro suite locally now means building the E2E
app (a few minutes) instead of pointing at a live dev client. Interactive
dev-loop work stays on the dev-client + argent exactly as today, consistent with
ADR 0001's tool-split. (A `when:`-conditional dev-launcher dismissal that would
let one flow set target both build types was considered and rejected: two-mode
flows are harder to read than one canonical target, and the dev client also
needs a Metro-connect step that a release build cannot share.)

### 4. Workflow — `.github/workflows/e2e.yml`

- **Triggers:** `pull_request` and `push` to `main`. **No top-level `paths:`
  filter** — a required check with a paths filter leaves non-matching PRs stuck
  on "Expected — waiting for status" (learned in the ci-checks spec).
- **One job, id `e2e-ios`** (the required-check context — no `name:` override so
  the context stays stable), `runs-on: macos-15`, `permissions: contents: read`,
  `timeout-minutes: 45`, `concurrency` group per ref with `cancel-in-progress`.
- **Docs-only short-circuit (default to running):** an early step computes the
  changed-file list (`git diff` against the PR base / push before-SHA). The
  heavy steps run **unless every changed file matches the non-app ignore set**;
  a provably docs-only PR reports green without building. The job always reports
  a conclusion, so it is safe as a required check.
  - Non-app ignore set (exempt): `docs/**`, `**/*.md`, `.claude/**`, `LICENSE`,
    `.github/ISSUE_TEMPLATE/**`. Everything else (incl. `src/**`, `app.json`,
    `eas.json`, `.maestro/**`, `package.json`, `bun.lock`, `metro.config.js`,
    `babel.config.js`, and `.github/workflows/e2e.yml` itself) → run.
- **Steps (when running):**
  1. `actions/checkout@v5` (fetch enough history to diff the base).
  2. `oven-sh/setup-bun@v2` with `bun-version-file: .bun-version`.
  3. `bun ci` — frozen install.
  4. `eas build --local -p ios -e e2e-simulator --output ./build/app.tar.gz`
     (env `EXPO_TOKEN` from secrets). Extract the `.app` from the tarball.
  5. Install the Maestro CLI.
  6. Boot an iOS simulator (device chosen dynamically from
     `xcrun simctl list` on the runner image — do not hardcode a model that may
     be absent), install the `.app` via `xcrun simctl install`.
  7. `maestro test .maestro/`.
  8. On failure, upload Maestro output (`~/.maestro/tests/**` screenshots /
     recordings) via `actions/upload-artifact`.
- **Caching:** CocoaPods (`~/Library/Caches/CocoaPods`, `ios/Pods` keyed on
  `Podfile.lock`) and the bun cache, to trim rebuild wall-clock.
- **Build tooling:** primary path is `eas build --local` (honors the eas.json
  flavor directly). Fallback if the experimental local builder proves flaky in
  CI: `bunx expo prebuild -p ios` + `xcodebuild` for the simulator SDK with
  `EXPO_PUBLIC_E2E=1` in the step env.

### 5. Required-check enforcement

Add `e2e-ios` as a `required_status_checks` context on the existing
**`protect-main` ruleset (id 18800808)** (alongside the existing `checks`
context), `integration_id: 15368` (GitHub Actions),
`strict_required_status_checks_policy: false`.

Ordering to avoid a chicken-and-egg block: land the workflow + code changes in a
PR first, confirm `e2e-ios` runs green on that PR, then add the required context
to the ruleset.

### 6. Docs

- Update **ADR 0001** (amend, or add a superseding ADR) to record: GitHub
  Actions is now the E2E CI gate on this public repo; the EAS `maestro` job is
  shelved on cost; the suite targets the Metro-free `e2e-simulator` build; the
  compressed plan is reachable via the profile's `EXPO_PUBLIC_E2E` flag.
- Update the **E2E tests (Maestro)** section of `AGENTS.md`: the CI gate, the
  E2E build flavor, that local suite runs build the E2E app, and the removal of
  the dev-launcher / compressed-plan-toggle flow steps.

## Deliberately excluded (this stage)

- **Android E2E** — a strong later follow-up (free/fast Linux runners) but needs
  its own build path and flow validation.
- **EAS cloud `maestro` job** — rejected on cost (the reason for this whole
  change).
- **`testID` refactor of the compressed-plan Toggle** — unnecessary now that the
  E2E build is compressed-by-default and the flow never taps the toggle.
- **Deploying the E2E build anywhere** — it exists only on CI/dev simulators.

## Known risks

- **`eas build --local` is marked experimental** and can be finicky in CI; the
  prebuild + `xcodebuild` fallback (§4) is the mitigation.
- **Build wall-clock** — a cold Expo iOS build is ~15–20 min even with caching;
  acceptable for a gate that skips docs-only PRs, but it is the slow part of PR
  feedback.
- **Runner simulator/device availability** — the available iPhone models depend
  on the runner image's Xcode/iOS runtime; pick the device dynamically rather
  than hardcoding (the flows are now text-first and device-agnostic once the
  toggle point-tap is gone).
- **`EXPO_TOKEN` dependency** — if the server env pull fails, the profile `env`
  still applies, but remote build-number resolution needs auth; a missing/expired
  token fails the build.
- **`bun test` runtime cleanliness** — nothing imported by `settings.ts` /
  `domain/` may reference `__DEV__` at module top level; keep it inside
  `compressedPlanReachable()`.

## Verification

1. Open the implementing PR; confirm `e2e-ios` builds the `e2e-simulator` app,
   runs `maestro test .maestro/`, and the full suite passes.
2. Confirm a docs-only PR (touching only `docs/**` / `*.md`) reports `e2e-ios`
   green **without** running the build.
3. `bun test` and `bun run typecheck` still pass with the `e2e.ts` helper and
   the `settings.ts` default change (compressed default stays `false` under
   `bun test`, where `EXPO_PUBLIC_E2E` is unset).
4. After the PR is green, add `e2e-ios` to ruleset 18800808 and confirm merges
   are blocked until it passes.
5. Confirm a `production`/`preview` build has no Developer section and the NHS
   plan is active (compressed plan unreachable) — the safety property holds.
