# 19. App variants via a dynamic app.config.ts over app.json, selected by APP_VARIANT

Date: 2026-07-15

## Status

Proposed — draft for review. Flip to `Accepted` on merge.

Full design and verification plan:
[`docs/superpowers/specs/2026-07-15-app-variants-design.md`](../superpowers/specs/2026-07-15-app-variants-design.md).

## Context

The `development` (dev-client) build and the `e2e-simulator` build both ship the
same iOS `bundleIdentifier` (`se.lukaslindqvist.myrunner`) and display name, so
installing one **overwrites** the other — you cannot keep a working dev client and
the E2E build on one simulator or phone at once, and neither carries a home-screen
cue for which build it is. We want dev and e2e installable side-by-side, each with
its own name and deep-link scheme, without disturbing the release/OTA/fingerprint
machinery or the single EAS project.

Constraints that shape the decision:

- **release-please owns `app.json`.** The `release-type: "expo"` strategy updates
  the `version` field *inside `app.json`* as a JSON file
  ([ADR 0012](0012-release-please-fingerprint-gated-releases.md)); `app.json` must
  survive as a real JSON file.
- **`slug`/`owner`/`projectId`/`updates.url` identify one EAS project**
  (`@lukas-apps/runtastic`). EAS validates the slug against the project the
  `projectId` points to, so a per-variant slug would force separate EAS projects —
  fragmenting credentials, channels, and the release pipeline. What makes two apps
  coexist is the **bundle identifier**, not the slug.
- **The fingerprint feeds off identity fields.** `name`/`bundleIdentifier`/`scheme`
  are part of the `@expo/fingerprint` hash (`fingerprint.config.js` skips only
  `version`), so a per-variant identity yields a per-variant fingerprint — correct,
  but the CI cache-key computation and the build must use the same `APP_VARIANT`
  ([ADR 0012](0012-release-please-fingerprint-gated-releases.md),
  [ADR 0001](0001-local-first-maestro-e2e-testing.md)).
- **`EXPO_PUBLIC_E2E` already exists** as a bundle-inlined *runtime* flag (the
  compressed-plan toggle, `src/services/e2e.ts`) — a poor fit for *native build
  identity*.

## Decision

**Layer a dynamic `app.config.ts` over the static `app.json`, selecting the app
identity from an `APP_VARIANT` build-time environment variable.** Expo reads
`app.json` first and passes it to the default function exported from `app.config.ts`
as `config`; the function spreads it and overrides only the identity fields. Scope
is **dev + e2e only**; `preview`/`production` keep the clean identity.

| `APP_VARIANT` | `name` | `ios.bundleIdentifier` / `android.package` | `scheme` |
| --- | --- | --- | --- |
| *(unset)* | `my-runner` | `se.lukaslindqvist.myrunner` | `myrunner` |
| `development` | `my-runner.dev` | `se.lukaslindqvist.myrunner.dev` | `myrunnerdev` |
| `e2e` | `my-runner.e2e` | `se.lukaslindqvist.myrunner.e2e` | `myrunnere2e` |

1. **`app.config.ts` overrides only identity.** It spreads `config` (and
   `config.ios` / `config.android`) so `infoPlist`, icons, plugins, and every other
   field pass through untouched; it changes only `name`, `scheme`,
   `ios.bundleIdentifier`, and `android.package`. Unset `APP_VARIANT` → the clean
   production identity, so store/OTA builds are never suffixed. `slug` and all
   EAS-project-identifying fields are unchanged.
2. **`APP_VARIANT` is set per EAS profile** (`development` → `development`,
   `e2e-simulator` → `e2e`, alongside its existing `EXPO_PUBLIC_E2E`) and in the
   local dev-client scripts (`APP_VARIANT=development expo run:ios`).
   `preview`/`production` set nothing.
3. **The e2e `appId` moves to `se.lukaslindqvist.myrunner.e2e`,** so every
   `.maestro/tests/*.yaml` `appId:` updates to match; the CI E2E workflow sets
   `APP_VARIANT=e2e` job-wide so the fingerprint cache key matches the built app.
4. **`app.json` stays a JSON file** so release-please keeps owning `version`
   ([ADR 0012](0012-release-please-fingerprint-gated-releases.md)); the dynamic
   config spreads the version through.

Accepted now to fix the approach; the concrete `eas.json`/`package.json` edits are
pinned by the implementation plan against the then-current tree, because those files
are being edited by concurrent in-flight work (see the spec's *Dependencies &
sequencing*).

## Consequences

- **Dev and e2e install side-by-side**, each with a distinct name and scheme, from a
  single env var — the stated goal, at the cost of one new build-time file and a few
  `env` keys.
- **Production/OTA untouched.** The default (unset) identity is exactly today's, so
  releases, channels, and the fingerprint gate are unaffected
  ([ADR 0012](0012-release-please-fingerprint-gated-releases.md)).
- **release-please keeps working** because `app.json` remains its JSON update target;
  the dynamic layer only augments.
- **One EAS project preserved** — shared credentials, channels, and pipeline; no slug
  fragmentation.
- **New coupling: identity ↔ fingerprint ↔ CI.** The E2E workflow must set the same
  `APP_VARIANT` for its fingerprint step as the build uses, or the cache key diverges
  from the app's embedded `runtimeVersion`. Documented and handled, but a new
  invariant to respect ([ADR 0001](0001-local-first-maestro-e2e-testing.md)).
- **Cosmetic:** the trailing `.dev`/`.e2e` in the name is where iOS truncates
  home-screen labels (~11 chars), so the two can look alike on the springboard; the
  full name still shows in the App Switcher/Settings (accepted trade-off).
- **Switching variants locally** needs `expo prebuild --clean` (bundle id is native),
  a minor dev-loop cost; `/ios`/`/android` are gitignored CNG so nothing is committed.
- **Deep-link/verify ripple:** the dev client's scheme becomes `myrunnerdev://`;
  verify-skill docs and memory that hardcode `myrunner://` are updated.

## Alternatives considered

- **Convert `app.json` → `app.config.ts` entirely** (the vanilla Expo tutorial path)
  — rejected: removes release-please's `version` update target
  ([ADR 0012](0012-release-please-fingerprint-gated-releases.md)). Layering over a
  retained `app.json` keeps that intact.
- **Vary the `slug` per variant** (the user's first instinct) — rejected: `slug` +
  `owner` + `projectId` identify one EAS project and EAS validates their agreement;
  distinct slugs force distinct EAS projects, fragmenting credentials and the release
  pipeline. Bundle identifier, not slug, is what lets apps coexist.
- **Derive identity from `EXPO_PUBLIC_E2E` (+ a new dev flag)** — rejected:
  `EXPO_PUBLIC_*` is bundle-inlined runtime config, the wrong layer for native build
  identity, and there is no existing dev signal. `APP_VARIANT` is Expo's documented,
  purpose-built knob and leaves `EXPO_PUBLIC_E2E` doing only the compressed-plan job.
- **Give `preview`/`production` their own identities too** — rejected for now: out of
  the stated scope (dev + e2e), and production identity must stay fixed for releases.
  Can be added later behind the same `APP_VARIANT` switch.
- **Distinct per-variant icons** — deferred: distinct names are enough today; custom
  icons add asset work for no functional gain.
