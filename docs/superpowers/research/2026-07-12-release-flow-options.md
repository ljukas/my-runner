# Release flow options — research

Date: 2026-07-12
Status: **research / options under consideration** — no decision made. Each flow below is a
candidate for how my-runner versions itself, generates changelogs, and triggers deploys.

## Shared foundation (applies to every flow)

All candidate flows share the same deployment back-end and versioning semantics; they differ
only in *how a release is initiated and how the changelog is produced*.

### Fingerprint-gated deploy (the back-end)

An EAS workflow, `.eas/workflows/deploy-production.yml`, modeled on Expo's official
[deploy-to-production example](https://docs.expo.dev/eas/workflows/examples/deploy-to-production/):

- `fingerprint` job (CNG-only — fits this repo) computes per-platform fingerprint hashes.
- `get-build` jobs look for an existing production build with that `fingerprint_hash`.
- Build exists → `update` job publishes an OTA update to the `production` channel.
- No build → `build` job (native) → `submit` job (store submission).
- Per-platform independently: Android can ride OTA while iOS rebuilds.
- No `on:` push trigger — it runs only when explicitly dispatched by the release front-end
  (`eas workflow:run` / REST API), so deploys happen exactly when a release is cut.

### Versioning semantics

- `package.json` `version` — the source of truth (semver; feat → minor, fix → patch).
- `app.json` `expo.version` (marketing version) — kept in sync with package.json by the
  release tooling, in the same release commit/PR.
- `ios.buildNumber` / `android.versionCode` — never in the repo: `eas.json` sets
  `cli.appVersionSource: "remote"` + `autoIncrement: true` on the production build profile.
- `runtimeVersion: { policy: "fingerprint" }` in app.json — updates only ever reach
  compatible binaries, by construction.
- **Load-bearing config** (verified against `@expo/fingerprint` source; Expo-endorsed fix from
  [expo-github-action#286](https://github.com/expo/expo-github-action/issues/286)): without
  this, bumping `expo.version` changes the fingerprint and forces a native build every release.

  ```js
  // fingerprint.config.js
  const { SourceSkips } = require('expo/fingerprint');
  /** @type {import('@expo/fingerprint').Config} */
  module.exports = {
    sourceSkips: SourceSkips.ExpoConfigVersions | SourceSkips.ExpoConfigRuntimeVersionIfString,
  };
  ```

  The project's own `package.json` `version` field is *not* fingerprinted (only `scripts` and
  the resolved native dependency graph), so version bumps there are always free.

### Facts that constrain every flow

- **EAS free tier (as of 2026-07):** 15 iOS + 15 Android builds/month, 60 workflow CI
  minutes/month, EAS Update to 1,000 MAU. Build jobs inside workflows draw from the build
  quota, not CI minutes. The fingerprint gate is what protects the build quota.
- **Native release ⇒ old binaries stop receiving OTA updates** (different fingerprint — the
  safety property). Users on old binaries keep their last compatible update until they update
  via the store. Native path adds ~24h App Store review; OTA is instant.
- **OTA safety valve:** `eas update --rollout-percentage`, `eas update:rollback`,
  `eas update:republish`.
- **Bot-created PRs need a PAT/App token, not `GITHUB_TOKEN`** — PRs created with the default
  token get no CI runs, so the ruleset's required `checks` context makes them unmergeable.
- **Tags pushed from Actions with `GITHUB_TOKEN` don't fire `on: push: tags` workflows**
  (GitHub anti-recursion rule) — deploy triggers must not be architected as tag-triggered
  workflows; gate on the release step's outputs in the same workflow instead.
- Setup prerequisites (all flows): `eas init` + `eas update:configure`, one first build per
  platform, ASC API key on EAS (iOS submit), Play service account + one manual AAB upload
  (Android submit), `EXPO_TOKEN` repo secret.
- `continuous-deploy-fingerprint` (expo/expo-github-action sub-action) is explicitly
  "not yet ready for production" per its own README — avoided in all flows.

---

## Flow A — Changesets + EAS Workflows hybrid

GitHub Actions owns *versioning* (changesets Version PR), EAS Workflows owns *deployment*.
Changelog entries are **hand-written per PR** (changeset files), not derived from commit
messages.

### How it works

1. Every feature/fix PR includes a changeset file (`bunx changeset`: bump type + human-written
   summary). Enforcement via changeset-bot or a CI check is optional.
2. On every push to main, `changesets/action@v1` maintains a **"Version Packages" PR** on
   branch `changeset-release/main`. The branch is **force-rebuilt from the tip of main on
   every push** (reset + `changeset version` + force-push), so it is always in sync and
   accumulates all pending changesets. Contents: `package.json` bump, `app.json` sync (via
   the `version` script hook), regenerated `CHANGELOG.md`, deletion of consumed changesets.
3. Merging the Version PR flips the action into publish mode: `publish: bunx changeset tag`
   creates tag `vX.Y.Z` + a GitHub Release, and `steps.changesets.outputs.published == 'true'`
   fires **exactly once** (idempotent — `changeset tag` skips existing tags; docs-only pushes
   never re-fire it).
4. The same workflow run then dispatches the EAS deploy workflow.

### Key configuration

`.changeset/config.json` — single-package app repos are first-class
([versioning-apps.md](https://github.com/changesets/changesets/blob/main/docs/versioning-apps.md)):

```json
{
  "changelog": ["@changesets/changelog-github", { "repo": "<owner>/my-runner" }],
  "commit": false,
  "baseBranch": "main",
  "privatePackages": { "version": true, "tag": true }
}
```

`package.json` script (the action's `version` input runs it; all changes land in the PR):

```json
{ "version-packages": "changeset version && node ./scripts/sync-app-version.mjs" }
```

`.github/workflows/release.yml` (sketch):

```yaml
on: { push: { branches: [main] } }
concurrency: ${{ github.workflow }}-${{ github.ref }}
jobs:
  release:
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write }
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0, token: ${{ secrets.RELEASE_PAT }} }
      - uses: oven-sh/setup-bun@v2
      - run: bun ci
      - id: changesets
        uses: changesets/action@v1
        with:
          version: bun run version-packages
          publish: bunx changeset tag
          title: "chore: version packages"
        env: { GITHUB_TOKEN: ${{ secrets.RELEASE_PAT }} }
      - if: steps.changesets.outputs.published == 'true'
        run: bunx eas-cli workflow:run .eas/workflows/deploy-production.yml
        env: { EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }} }
```

### Properties

- **Control point:** merging the Version PR. Releases accumulate until a human merges.
- **Changelog quality:** highest — entries are written by a human at PR time
  (`@changesets/changelog-github` adds PR links + attribution).
- **Cost of control:** every PR needs a changeset file (friction; an "empty changeset"
  escape hatch exists for no-release PRs).
- Squash-merge fully compatible (changesets state lives in files, not commit history).
- Pin `changesets/action@v1` (v1.9.0): v2 is pre-release and changes the publish contract
  (`$CHANGESETS_OUTPUT` NDJSON instead of stdout scraping).
- No published prior art combining changesets + fingerprint gate (closest:
  [tktcorporation/good-morning](https://github.com/tktcorporation/good-morning),
  [Simon Boisset's EAS workflow post](https://simonboisset.com/en/blog/expo-ci-cd-workflows-fingerprint-ota)) —
  the wiring is novel but each half is first-party-documented.

### Open decisions (if chosen)

1. Native-path gate: `require-approval` job before `submit` (recommended) vs auto-submit.
2. iOS-first vs both platforms wired from the start.
3. Enforce changeset presence on PRs (changeset-bot / CI check)?
4. Default OTA rollout percentage (100% vs staged).

---

## Flow B — Release Please + EAS Workflows

Same control model as Flow A (a bot-maintained release PR; merging it is the "ship it" act),
but driven entirely by the **Conventional Commit squash titles this repo already enforces** —
no per-PR changeset files, no custom version-sync script.

Headline finding: release-please ships a dedicated **`expo` release type**
([strategy source](https://github.com/googleapis/release-please/blob/main/src/strategies/expo.ts),
contributed in [PR #1646](https://github.com/googleapis/release-please/pull/1646)) that updates
`package.json`, `app.json` `expo.version`, and `CHANGELOG.md` atomically in the release PR.
It only touches `expo.ios.buildNumber` / `expo.android.versionCode` if those keys already
exist in app.json — they don't here (EAS remote versioning), so it does exactly the right thing.

### How it works

1. PRs merge to main as usual — squash commit titles (`feat:`, `fix:`, `feat!:`) are the input.
   `fix` → patch, `feat` → minor, `!`/`BREAKING-CHANGE` → major. Only `feat`/`fix`/`deps` are
   releasable units; `chore`/`docs`/`refactor`-only streams open no release PR (they ride along
   in the next release).
2. On every push to main, `release-please-action` maintains a release PR on branch
   `release-please--branches--main`, recomputed as work merges (set `"always-update": true` to
   also keep it rebased on main when only the base moved). Title: **`chore(main): release X.Y.Z`**
   — itself a valid Conventional Commit, so it passes the repo's PR-title rule.
3. Merging the release PR makes the next run tag `vX.Y.Z` (plain, with
   `"include-component-in-tag": false`), create a GitHub Release from the changelog notes, and
   set the `release_created` output to `true` — the deploy gate.
4. A `deploy` job gated on `release_created == 'true'` dispatches the EAS deploy workflow.

### Key configuration

`release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "expo",
  "include-component-in-tag": false,
  "packages": { ".": {} }
}
```

`.release-please-manifest.json`: `{ ".": "1.0.0" }` (seed with the current version).

`.github/workflows/release.yml` (sketch):

```yaml
on: { push: { branches: [main] } }
permissions: { contents: write, issues: write, pull-requests: write }
jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      version: ${{ steps.release.outputs.version }}
    steps:
      - uses: googleapis/release-please-action@v5
        id: release
        with:
          token: ${{ secrets.RELEASE_PAT }}   # mandatory — default token ⇒ no CI on the PR
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
  deploy:
    needs: release-please
    if: ${{ needs.release-please.outputs.release_created == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - run: npx eas-cli workflow:run .eas/workflows/deploy-production.yml
        env: { EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }} }
```

### Properties

- **Control point:** merging the release PR — identical UX to Flow A. Hold a release by
  simply not merging; force a version with a `Release-As: x.y.z` footer in a squash body.
- **Changelog quality:** exactly the squash-commit subjects, grouped by type
  (`changelog-sections` configurable). Quality equals the repo's existing PR-title
  discipline — no extra authoring, no labels, no second bookkeeping system.
- **Zero per-PR friction** — the decisive advantage over Flow A. The bump type is inferred
  from the title the repo already requires.
- Same PAT/App-token requirement as Flow A (release PR must run the `checks` context).
- `bun.lock` contains no version field (verified) — the release PR can't desync the lockfile.
- **Trodden path for Expo**: the `expo` strategy exists for exactly this;
  [worked example repo](https://github.com/dmi3y/expo-release-please-example),
  [write-up pairing release-please with EAS remote build numbers](https://www.amarjanica.com/automate-expo-app-versioning-with-github-and-release-please/).
- Caveat: the `expo` strategy updates JSON only — migrating to `app.config.ts` later would
  mean switching to `release-type: node` + a `generic` extra-file with an
  `x-release-please-version` annotation (documented fallback), or back to a sync script.
- Action major is v5 (Node 24 runtime); README still documents v4 — both current.

---

## Flow C — Manual dispatch release + git-cliff

No bot, no release PR: a human runs a **`workflow_dispatch` "Release" workflow** when they
decide it's time. [git-cliff](https://git-cliff.org) (actively maintained, v2.13.x) is the
version-and-changelog engine, consuming the same enforced conventional squash commits.

### How it works

1. Trigger "Release" in the Actions tab with `bump: choice [auto|patch|minor|major]`
   (`auto` = `git cliff --bumped-version` computes the next semver from commits since the
   last tag).
2. The workflow: prepends the new section to `CHANGELOG.md`
   (`git cliff --bump --unreleased --prepend`), bumps `package.json`
   (`bun pm version <v> --no-git-tag-version`), syncs `app.json` via `jq`, commits
   `chore(release): vX.Y.Z` **directly to main**, tags, pushes, and creates the GitHub
   Release (`gh release create --notes-file …`).
3. A `needs:`-chained `deploy` job in the same run dispatches the EAS deploy workflow —
   no event chaining, so the token-triggering trap never applies.

### Key configuration

`cliff.toml` — `conventional_commits = true`, `commit_parsers` grouping feat → Features,
fix → Bug Fixes, hiding chore/ci; with `GITHUB_TOKEN` set, entries get PR links, authors,
and first-time-contributor callouts ([GitHub integration](https://git-cliff.org/docs/integration/github)).

Workflow core:

```yaml
on:
  workflow_dispatch:
    inputs:
      bump: { type: choice, options: [auto, patch, minor, major], default: auto }
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v2   # App is on the ruleset bypass list
        id: app-token
        with: { app-id: ${{ vars.RELEASE_APP_ID }}, private-key: ${{ secrets.RELEASE_APP_KEY }} }
      - uses: actions/checkout@v5
        with: { fetch-depth: 0, token: ${{ steps.app-token.outputs.token }} }
      - run: |
          ARGS=""; [ "${{ inputs.bump }}" != "auto" ] && ARGS="--bump ${{ inputs.bump }}"
          VERSION=$(git cliff --bumped-version $ARGS | sed 's/^v//')
          git cliff --bump --unreleased --prepend CHANGELOG.md $ARGS
          bun pm version "$VERSION" --no-git-tag-version
          jq --arg v "$VERSION" '.expo.version = $v' app.json > tmp && mv tmp app.json
          git commit -am "chore(release): v$VERSION" && git tag "v$VERSION" && git push --follow-tags
          gh release create "v$VERSION" --notes "$(git cliff --unreleased --strip all $ARGS)"
  deploy:
    needs: release
    # dispatch .eas/workflows/deploy-production.yml
```

### Properties

- **Control point:** the strongest of the three — literally nothing happens until a human
  clicks "Run workflow". Releases are fully decoupled from merge activity; no pending
  release PR to babysit.
- **Changelog quality:** same source as Flow B (conventional squash commits), rendered by
  git-cliff into a grouped, PR-linked, in-repo `CHANGELOG.md`.
- **The real cost:** pushing the release commit to protected main requires a **dedicated
  GitHub App on the ruleset bypass list** (`GITHUB_TOKEN` cannot be a bypass actor —
  GitHub refuses this; Expensify runs exactly this App pattern in production). The
  bypass-free fallback — the workflow opens a quick release PR instead — works but
  reintroduces a merge step, i.e. drifts back toward Flows A/B.
- Most hand-rolled logic to own (~30 lines of bash + cliff.toml), least third-party
  machinery (one binary, no bot).
- **Prior art at scale:** Bluesky's app releases are pure `workflow_dispatch`
  (build/submit + OTA workflows with fingerprint and package.json-version-diff gating);
  Mattermost mobile releases on human-pushed tags + dispatch. Neither uses a release bot.
- Considered and rejected within this family: **release-drafter** (label-driven draft
  releases — but version bump happens *after* publish, the wrong order for a native build
  that must embed the version, and labels duplicate the enforced titles) and
  **semantic-release** (v25, excellent for libraries, but releases on *every* push to main —
  no human gate, the opposite of controlled releases; running it dispatch-only just
  re-implements this flow with ~5 npm plugins instead of one binary).

---

## Comparison

| | A — Changesets | B — Release Please | C — Dispatch + git-cliff |
|---|---|---|---|
| Release trigger | Merge Version PR | Merge release PR | "Run workflow" button |
| Changelog source | Hand-written changeset files | Squash-commit titles (enforced) | Squash-commit titles (enforced) |
| Changelog prose quality | Highest (human-authored summaries) | = PR-title discipline | = PR-title discipline |
| Per-PR friction | Changeset file required per PR | None | None |
| Bump-type control | Explicit per change | Inferred from commit type (+ `Release-As` override) | Chosen at release time (`auto` computed) |
| app.json version sync | Custom script in `version` hook | **Native (`expo` release type)** | `jq` step |
| Credentials beyond `EXPO_TOKEN` | PAT (checks on bot PR) | PAT (checks on bot PR) | GitHub App on ruleset bypass |
| Moving parts | changesets CLI + action + script | action + 2 config files | cliff.toml + ~30 lines bash |
| Pending-release visibility | Version PR always shows what ships next | Release PR always shows what ships next | `git cliff --unreleased` on demand |
| Expo prior art | None found (novel wiring) | `expo` strategy + example repos | Bluesky, Mattermost (dispatch model) |
| Aligns with repo conventions | Adds a second convention | **Reuses enforced CC titles + squash** | Reuses enforced CC titles + squash |

## Assessment (not a decision)

All three share the identical deploy back-end and versioning semantics; the choice is purely
about the release front-end:

- **Flow B** is the lowest-friction fit for *this* repo: it consumes the Conventional-Commit
  + squash-merge discipline already enforced here, needs no per-PR authoring, and is the only
  flow with first-party Expo support for the app.json sync. Its changelog is only as good as
  PR titles — which this repo already requires to be good.
- **Flow A** wins if hand-written, user-facing changelog prose matters more than per-PR
  friction — changeset summaries are written for release notes, not for reviewers.
- **Flow C** wins if releases should be fully on-demand and bot-free — the strongest human
  gate and the fewest third-party dependencies, paid for with a GitHub App bypass credential
  and owning the release script.
