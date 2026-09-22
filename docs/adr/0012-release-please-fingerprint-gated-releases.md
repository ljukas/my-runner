# 12. Release flow: release-please with fingerprint-gated EAS deploys

> **Android: stage 7 (release pipeline)** — Android ships in stages ([ADR 0025](0025-android-staged-migration.md)); the Android provisions below belong to stage 7 (release pipeline): Play submission and the existing Android workflow jobs. Check ADR 0025's stage table for whether they have shipped.

Date: 2026-07-12

## Status

Accepted

## Context

The app needs a release process that produces controlled releases, semver
versioning, and changelogs — without a per-release native build. Native store
releases are expensive (App Store review adds ~24h; the EAS free tier includes
15 iOS + 15 Android builds/month), while EAS Update (OTA) ships JS-only changes
instantly and costs no builds. Most releases of this app are expected to be
JS-only.

Constraints and existing conventions that shape the design:

- The repo already enforces Conventional Commit PR titles and squash-merges
  every PR, so main's history is one well-formed conventional commit per PR.
- `main` is protected by a ruleset requiring the `checks` status context.
- CNG project: `ios/`/`android/` are generated, never committed — which is
  exactly what `@expo/fingerprint` and the EAS `fingerprint` workflow job need.
- Free tier: 60 EAS workflow CI minutes/month; builds inside workflows draw
  from the build quota, not CI minutes.

Three candidate flows were researched in depth — changesets, release-please,
and a manual `workflow_dispatch` + git-cliff flow — see
[docs/superpowers/research/2026-07-12-release-flow-options.md](../superpowers/research/2026-07-12-release-flow-options.md).

## Decision

**release-please** (Google's release automation, `release-type: expo`) owns
versioning and changelogs; a **fingerprint-gated EAS workflow** owns deploys.

- On every push to `main`, `googleapis/release-please-action@v5`
  (`.github/workflows/release.yml`) maintains a release PR computed from the
  Conventional Commit squash titles (`fix:` → patch, `feat:` → minor;
  `bump-minor-pre-major` while < 1.0.0). The `expo` release type bumps
  `package.json` and `app.json` `expo.version` atomically and regenerates
  `CHANGELOG.md`. The action authenticates with a PAT (`RELEASE_PAT` secret) —
  the default `GITHUB_TOKEN` would produce a release PR that never runs the
  required `checks` context.
- **Merging the release PR is the "ship it" act.** The next workflow run tags
  `vX.Y.Z`, creates a GitHub Release, and dispatches
  `.eas/workflows/deploy-production.yml` via `eas workflow:run`
  (`EXPO_TOKEN` secret). The EAS workflow has no push trigger — deploys happen
  only when a release is cut.
- The EAS workflow computes per-platform fingerprints, then per platform:
  a store build with the same fingerprint exists → publish an **OTA update**
  to the `production` channel; no matching build → **native build**, then a
  `require-approval` gate, then store submission.
- Versioning semantics:
  - `package.json` `version` is the source of truth; `app.json` `expo.version`
    mirrors it (both updated by release-please). Starting version: **0.0.1**.
  - `ios.buildNumber`/`android.versionCode` never live in the repo:
    `eas.json` sets `cli.appVersionSource: "remote"` and the production build
    profile sets `autoIncrement: true`.
  - `runtimeVersion: { policy: "fingerprint" }` — an update can only reach
    binaries whose fingerprint matches, making incompatible OTA updates
    structurally impossible.
  - `fingerprint.config.js` skips `ExpoConfigVersions` and
    `ExpoConfigRuntimeVersionIfString` so the release PR's version bump does
    not change the fingerprint (verified: hash identical before/after a bump).
    Without this, every release would force a native build.

## Consequences

- Zero per-PR release friction: the changelog is exactly the squash-commit
  titles, so changelog quality equals PR-title discipline (already enforced).
  `CHANGELOG.md`, both `version` fields, and `.release-please-manifest.json`
  are owned by release-please — never edit them by hand.
- Only `feat`/`fix`/`deps` commits open or grow a release PR; `chore`/`docs`/
  `refactor`-only streams don't trigger releases (they ride along in the next
  one). Force a specific version with a `Release-As: x.y.z` footer.
- Native-affecting changes (native deps, config plugins, icons, permissions,
  SDK upgrades) change the fingerprint and route that release through
  build → approval → store submission. When that happens, older binaries stop
  receiving OTA updates (by design — they're incompatible); users get the new
  binary from the store.
- The store-visible marketing version only advances on native releases;
  OTA-only releases advance the git tag/changelog but not the store listing.
- Prerequisites before the first release works end-to-end: `RELEASE_PAT` and
  `EXPO_TOKEN` repo secrets, one first build per platform, ASC API key on EAS
  (iOS submit), Play service account + one manual AAB upload (Android submit).
- If `app.json` ever migrates to `app.config.ts`, the `expo` release type can
  no longer update it — switch to `release-type: node` plus a `generic`
  extra-file with an `x-release-please-version` annotation.

## Alternatives considered

- **Changesets** — best-in-class hand-written changelog prose, but taxes every
  PR with a changeset file, needs a custom script to sync `app.json`, and has
  no Expo-specific support. Rejected: duplicate convention on top of the
  already-enforced Conventional Commit titles.
- **Manual `workflow_dispatch` + git-cliff** — strongest human gate and no
  bot, but requires a dedicated GitHub App on the ruleset bypass list to push
  release commits to protected `main`, and ~30 lines of release bash to own.
  Rejected for now; remains the fallback if the release-PR model chafes.
- **semantic-release** — releases on every push to `main`; no human gate.
  Rejected: the opposite of controlled releases.
- **`continuous-deploy-fingerprint` GitHub sub-action** — implements the
  fingerprint gate on GitHub Actions, but its README declares it not
  production-ready. The EAS Workflows pre-packaged jobs are the maintained
  first-party equivalent.

## Amendment (2026-09-21): the Android Maps key is stripped from the fingerprint

Written for Android stage 4 (maps, ADR 0025). `GoogleMaps.View` needs a Maps
SDK key baked into the Android manifest as
`android.config.googleMaps.apiKey` (ADR 0010 item 5). Three facts about how
that field meets the fingerprint, all measured on the stage-3 tip:

1. **The whole normalised Expo config is one `contents` source on both
   platforms** (`expoConfig`, serialised with `@expo/fingerprint`'s own
   `stringifyJsonSorted`). Adding the Android-only field moved the **iOS** hash
   (`99862a79… → b99fb28a…` under `APP_VARIANT=development`) — a config field iOS
   never reads would have cost the next iOS release its OTA path.
2. **`fingerprint.config.js` now strips `android.config.googleMaps` from that
   source** (and an emptied `android.config`) in its `fileHookTransform`, which
   `@expo/fingerprint` calls for `contents` sources as well as files
   (`build/hash/Hash.js`). It re-serialises with the sourcer's own
   `stringifyJsonSorted`, because `JSON.stringify` formats differently and hashes
   to a third value matching neither tree. Verified: with the field absent,
   present with a real-shaped key, and present with the placeholder below, iOS
   hashes `99862a79…` and Android `a222c043…` every time (the variant-less iOS
   baseline `9061ec14…` too).
3. **The key always exists in a built manifest.** `app.config.ts` reads
   `GOOGLE_MAPS_ANDROID_API_KEY` from the environment (gitignored `.env.local`
   locally, an EAS environment variable from stage 7) and falls back to
   `MISSING_GOOGLE_MAPS_ANDROID_API_KEY`. Measured on the emulator: with *no*
   `com.google.android.geo.API_KEY` meta-data the Maps SDK throws
   `IllegalStateException: API key not found` from `MapView.onCreate` and takes
   the app down the first time a route renders; an *invalid* key only logs
   `Authorization failure` and draws grey tiles. The placeholder converts a
   forgotten secret from a crash into a visibly broken map.

**Trade-off, deliberate:** a key rotation alone no longer changes the
fingerprint, so it no longer forces a native build. That is safe because the key
is a build-time manifest value that JS never reads — an already-shipped binary
keeps working on its own baked key, and an OTA update cannot depend on which key
it was built with. Rotating the key still requires the *next* native build to
carry it, which is the same as before; only the automatic build trigger is gone.

**Related, discovered the same day (stage 3):** the root `.gitignore` is also a
fingerprint source on both platforms (`bareGitIgnore`). New ignore rules go in a
nested `.gitignore` beside what they ignore (`modules/audio-focus/android/.gitignore`
is the precedent), never in the root file, or a housekeeping rule costs a release
its OTA eligibility. The staged-migration ADR's item 8 has the manifest
`package` attribute hook this amendment's strip sits beside.
