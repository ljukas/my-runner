# CI checks GitHub Action — design

Date: 2026-07-11
Status: Approved design, pending implementation

## Goal

A GitHub Actions workflow that gates every PR to `main` on a TypeScript
typecheck plus a small set of health checks appropriate for the project's
current stage (starter scaffolding, no unit tests, no linter decision yet),
and is enforced as a **required status check** via the repo's existing
`protect-main` ruleset.

## Decisions

### Workflow: `.github/workflows/ci.yml`

- **Triggers:** `pull_request` and `push` to `main`.
  **No `paths:` filter** — a required status check with a paths filter leaves
  non-matching PRs stuck forever on "Expected — waiting for status".
- **One job, id `checks`** (user-approved layout), `runs-on: ubuntu-latest`,
  `permissions: contents: read`, `timeout-minutes: 10`, and a
  `concurrency` group per ref with `cancel-in-progress` to kill superseded runs.
- **Steps, in order:**
  1. `actions/checkout@v5`
  2. `oven-sh/setup-bun@v2` with `bun-version-file: .bun-version`
  3. `bun ci` — frozen, reproducible install; fails on `package.json`/`bun.lock` drift
  4. `bunx expo customize tsconfig.json` — generates the gitignored
     expo-router typed routes (`.expo/types/router.d.ts`, `expo-env.d.ts`).
     Without this, `tsc` passes but route types degrade to loose strings,
     making CI *more permissive* than a dev machine
     ([Expo typed-routes reference](https://docs.expo.dev/router/reference/typed-routes/)
     documents this exact command for CI)
  5. `bun run typecheck` — new package.json script, `tsc --noEmit`
     (always the locally installed TS ~6.0.3, never a global tsc)
  6. `bunx expo-doctor` — 20 checks (SDK/dependency alignment, config
     sanity); non-interactive and exit-code-correct in CI by default;
     verified passing on this repo (20/20). Superset of `expo install --check`.

### Supporting file changes

- **`.bun-version`** (new, repo root): `1.3.14` — single source of truth for
  the Bun version, read by `setup-bun` in CI and by version managers locally.
- **`package.json`:** add script `"typecheck": "tsc --noEmit"`.

### Required check enforcement

- Update the existing **`protect-main` ruleset (id 18800808)** — which already
  enforces PRs + squash-only merges + no force-push/deletion on the default
  branch — by adding a `required_status_checks` rule:
  - context: `checks` (the job id; no `name:` override on the job so the
    context stays stable)
  - `integration_id: 15368` (GitHub Actions app) so only Actions can report it
  - `strict_required_status_checks_policy: false` — branches need not be
    up-to-date with `main` before merge (low friction for solo work)
- No chicken-and-egg problem: `pull_request` workflows run for the PR that
  introduces the workflow file itself, so the introducing PR can go green
  and merge normally.

## Deliberately excluded (current stage)

- **`expo lint`** — no ESLint config committed; the first run scaffolds one,
  which would dirty/fail CI. Revisit when the linter decision lands.
- **Prettier** — no formatter decision yet.
- **`expo install --check`** — redundant; expo-doctor covers it.
- **Dependency cache** (`~/.bun/install/cache` via `actions/cache`) —
  `bun install` is typically as fast as a cache restore at this project size;
  add later if install time grows.
- **knip / actionlint / unit tests** — nothing to run them on yet.

## Known risks

- **expo-doctor needs network** (npm registry + React Native Directory) and
  can newly warn when directory data changes, not code. Mitigation if it ever
  bites: `expo.doctor.reactNativeDirectoryCheck.exclude` in package.json, or
  split doctor into its own non-required job.
- `expo customize tsconfig.json` rewrites `tsconfig.json` (strips comments) —
  harmless in a throwaway CI checkout
  ([expo#32326](https://github.com/expo/expo/issues/32326)).
- Bun skips dependency postinstall scripts unless listed in
  `trustedDependencies`. Nothing needs it today; if a future dep breaks
  mysteriously in CI/EAS, check this first.

## Verification

1. Open a PR with the workflow; confirm the `checks` job runs and passes.
2. Confirm the PR shows `checks` as **required** and merge is blocked until green.
3. `gh api repos/ljukas/my-runner/rulesets/18800808` shows the
   `required_status_checks` rule.
