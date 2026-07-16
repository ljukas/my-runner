# Environment-driven app variants: dev + e2e installable side-by-side

Date: 2026-07-15

Status: Proposed — draft for review.

## Problem

The `development` (dev-client) build and the `e2e-simulator` build both ship the
same iOS `bundleIdentifier` (`se.lukaslindqvist.myrunner`) and the same display
name (`my-runner`). Because iOS keys installed apps by bundle identifier,
installing one **overwrites** the other — you cannot keep a working dev client and
the E2E build on the same simulator or phone at once, and even when only one is
present there is no visible cue on the home screen telling you which build it is.

## Goal

Make the **development** and **e2e** builds install and run side-by-side on one
device, each with its own distinct home-screen name and deep-link scheme, driven
entirely by a build-time environment variable — without touching the
`production`/`preview` identity and without disturbing the release, OTA, or
fingerprint machinery.

## Non-goals

- No new identity for `preview` or `production` — they keep the clean
  `se.lukaslindqvist.myrunner` / `my-runner` identity (chosen scope: dev + e2e
  only). Production identity staying fixed is a hard requirement for releases.
- No custom per-variant icons — all variants use the current default Expo icon.
  (Distinct icons are a deferred nice-to-have; distinct names are enough.)
- No change to the `slug`, `owner`, `extra.eas.projectId`, or `updates.url` — all
  variants remain the **one** EAS project `@lukas-apps/runtastic`.

## Approach

Layer a dynamic `app.config.ts` over the existing static `app.json`, selected by an
`APP_VARIANT` environment variable.

Expo CLI reads `app.json` first and passes the normalized result to the default
function exported from `app.config.ts` as `config`; the function spreads `config`
and overrides only the identity fields. This is the officially documented "app
variants" pattern (Expo SDK 57, *Install app variants on the same device* /
*build-reference/variants*), verified against current docs.

Two alternatives were rejected:

- **Convert `app.json` → `app.config.ts` entirely.** Breaks release-please: the
  `release-type: "expo"` strategy updates the `version` field *inside `app.json`*
  as a JSON file ([ADR 0012](../../adr/0012-release-please-fingerprint-gated-releases.md)).
  Removing `app.json` removes release-please's update target. Layering keeps
  `app.json` a real JSON file that release-please owns untouched.
- **Derive identity from the existing `EXPO_PUBLIC_E2E` flag (+ a new dev flag).**
  `EXPO_PUBLIC_*` variables are bundle-inlined *runtime* config; overloading them
  for *native build identity* conflates two concerns, and there is no existing dev
  signal anyway. `APP_VARIANT` is the purpose-built, documented knob and leaves
  `EXPO_PUBLIC_E2E` doing only what it does today (the compressed-plan toggle,
  `src/services/e2e.ts`).

## Variant identity model

`APP_VARIANT` is read in `app.config.ts`. **Unset → production/preview** (the clean
identity), which is the critical default so store/OTA builds are never suffixed.

| `APP_VARIANT` | `name` (home-screen label) | `ios.bundleIdentifier` / `android.package` | `scheme` |
| --- | --- | --- | --- |
| *(unset)* | `my-runner` | `se.lukaslindqvist.myrunner` | `myrunner` |
| `development` | `my-runner.dev` | `se.lukaslindqvist.myrunner.dev` | `myrunnerdev` |
| `e2e` | `my-runner.e2e` | `se.lukaslindqvist.myrunner.e2e` | `myrunnere2e` |

`slug` (`runtastic`) and every EAS-project-identifying field are unchanged across
all rows.

**Cosmetic caveat (accepted):** iOS truncates home-screen labels at ~11 characters,
so `my-runner.dev` / `my-runner.e2e` will likely render on the springboard as
`my-runner.d…` and be hard to tell apart *there*; the full name is still shown in
the App Switcher, Settings, and long-press. The user accepted the trailing-suffix
form over a front-loaded marker (e.g. `dev·my-runner`).

## Components / changes

### 1. `app.config.ts` (new)

A default-export function that receives the loaded `app.json` and overrides only the
identity fields. Sketch (final TypeScript types — `ExpoConfig` / `ConfigContext`
from `expo/config` — confirmed against SDK 57 at implementation):

```ts
export default ({ config }) => {
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
      bundleIdentifier: `${config.ios.bundleIdentifier}${idSuffix}`,
    },
    android: {
      ...config.android,
      package: `${config.android.package}${idSuffix}`,
    },
  };
};
```

Notes:

- The `ios`/`android` sub-objects are **spread** so existing keys (`infoPlist`,
  `icon`, `adaptiveIcon`, `predictiveBackGestureEnabled`, …) survive — we override
  only `bundleIdentifier` / `package`.
- `android` is kept symmetric for future-proofing even though the app is currently
  iOS-only; it is inert while the build targets iOS only.
- The file is a build-time Node module (not part of the RN/Hermes bundle), so it is
  outside the `moduleSuffixes` platform-fork machinery.

### 2. `eas.json` — profile `env`

Add `APP_VARIANT` to the `env` of the dev and e2e profiles; leave `preview` and
`production` without it (so they resolve to the clean identity):

- Every **development** profile (whatever the merged set is called — see
  *Dependencies & sequencing*): `"env": { "APP_VARIANT": "development" }`.
- **`e2e-simulator`**: add `"APP_VARIANT": "e2e"` alongside the existing
  `"EXPO_PUBLIC_E2E": "1"`.

### 3. Local dev scripts — `package.json`

The locally-built dev client must carry the `.dev` identity, so the scripts that
build/serve it set `APP_VARIANT=development`, e.g. `APP_VARIANT=development expo
run:ios` (and the matching `start`/`android` scripts). Exact script names are
reconciled at implementation against the merged script set.

Switching variants locally regenerates the native project (bundle id is a native
value); per Expo's variant guidance, use `expo prebuild --clean` when alternating
between variants on the same checkout. `/ios` and `/android` are gitignored (CNG),
so this only affects the local build, never committed native projects.

### 4. Maestro `appId` — `.maestro/tests/*.yaml`

The E2E build's bundle id becomes `se.lukaslindqvist.myrunner.e2e`, so every flow's
`appId:` field must change to match
([ADR 0016](../../adr/0016-text-first-maestro-selectors.md) selectors are
unaffected — only the `appId` header changes). This is required for the suite to
launch the app at all.

### 5. CI fingerprint env — `.github/workflows/e2e.yml`

The workflow computes the cache key with `npx expo-updates fingerprint:generate`
in a step that currently has **no `APP_VARIANT`**, while the actual build (via the
`e2e-simulator` profile) will have `APP_VARIANT=e2e`. Because `name` /
`bundleIdentifier` / `scheme` feed the `@expo/fingerprint` hash, the two must agree
or the cache key will not represent the app that is built (and would diverge from
the `runtimeVersion` EAS embeds at build time). Fix: set `APP_VARIANT: e2e` at the
job level (or at least on the "Compute native fingerprint" step) so every step —
fingerprint, build, repack — sees the same variant.

`build-e2e-sim-app.sh` needs **no** change: it runs `eas-cli build --profile
e2e-simulator --local`, which reads the profile `env` from `eas.json`, and the
`.app` is glob-found and renamed, so the bundle-id-derived filename is irrelevant.
The `EXPO_PUBLIC_E2E` handling in the repack step is unaffected (`EXPO_PUBLIC_*`
is inlined in JS and does not feed the native fingerprint).

### 6. Documentation & memory ripples

- **AGENTS.md** — the E2E section states the `appId` is `se.lukaslindqvist.myrunner`
  set as both `ios.bundleIdentifier` and `android.package`. Update it to record that
  the *e2e build* uses `se.lukaslindqvist.myrunner.e2e`, and add a short "app
  variants" note (dev/e2e/default identity, driven by `APP_VARIANT`).
- **Verify skill / memory** — the dev-client deep link becomes `myrunnerdev://`
  (was `myrunner://`) and the dev bundle id `…myrunner.dev`; update the
  `myrunner-devclient-verify-quirks` memory and any verify-skill doc that hardcodes
  the scheme/bundle id.
- **ADR 0019** (this decision) is added to the ADR index in AGENTS.md.

## Invariants preserved

- **release-please owns `app.json` version.** `app.json` remains a JSON file; the
  dynamic config spreads `...config`, so the version flows through unchanged
  ([ADR 0012](../../adr/0012-release-please-fingerprint-gated-releases.md)).
- **Fingerprint stays deterministic per variant.** `APP_VARIANT` is constant within
  each profile, so each variant has its own stable fingerprint. `fingerprint.config.js`
  already skips `version`; identity fields legitimately belong in the hash. The e2e
  cache key is naturally distinct from any dev/production fingerprint, which is
  correct.
- **One EAS project.** `slug`/`owner`/`projectId`/`updates.url` are untouched, so all
  variants share credentials, channels, and the release pipeline.

## Dependencies & sequencing

`app.json`, `eas.json`, and `package.json` are being edited concurrently by other
in-flight work (a Stage-2 "spoken coach" branch and an iOS-only / build-profile
cleanup that removes `development-simulator`/`internal` and adds `platforms:
["ios"]`). This design is written at intent level for that reason; the
implementation plan pins exact edits against whatever has merged to `main` at
implementation time (in particular, the final set/names of development profiles and
local scripts). Nothing here conflicts with that work — it only adds `env` keys and
a new `app.config.ts`.

There is also a pre-existing **ADR-number collision on `0018`** unrelated to this
work (`0018-free-run-route-generation.md` on `main` vs. an untracked
`0018-ios-only-android-deferred.md` on the Stage-2 checkout); this design takes
`0019` and leaves that for the other author to reconcile.

## Verification

Manual, on the iOS simulator (per `.claude/rules/argent.md`), since this is
build-configuration only — no unit-testable logic:

1. Build the dev variant (`APP_VARIANT=development` dev-client build) and install it.
2. Build the e2e variant (`eas build --local -p ios -e e2e-simulator`) and install it
   onto the *same* simulator.
3. Confirm **both** apps are present simultaneously with distinct names
   (`my-runner.dev` and `my-runner.e2e`) and distinct bundle ids.
4. Run the full Maestro suite (`maestro test .maestro/`) against the `.e2e` `appId`
   and confirm it passes unchanged — proving the e2e build is correctly identified
   and the compressed plan still works.
5. Confirm a plain `production`/`preview` config resolution still yields the clean
   `se.lukaslindqvist.myrunner` / `my-runner` identity (e.g. `npx expo config` with
   `APP_VARIANT` unset).

## Risks / open questions

- **CI fingerprint/build env agreement** is the one real correctness risk; §5
  addresses it by setting `APP_VARIANT=e2e` job-wide. Verify the cache key produced
  in CI matches the `runtimeVersion` embedded in the built `.app`.
- **TypeScript typing of `app.config.ts`** (`expo/config` exports) is confirmed
  against SDK 57 at implementation, not assumed here (Expo APIs are newer than
  training data — see AGENTS.md).
- **Exact development-profile/script names** depend on the merge order of the
  in-flight build-config cleanup (see *Dependencies & sequencing*).

## Out of scope

- Preview/production variant identities (only dev + e2e in this scope).
- Custom per-variant app icons.
- Android build wiring beyond keeping `android.package` symmetric (app is iOS-only).
