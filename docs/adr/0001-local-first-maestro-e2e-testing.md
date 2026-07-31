# 1. Local-first Maestro E2E testing

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0020](0020-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-11

## Status

Accepted

## Context

The app needs E2E coverage for its core walk/run session flows (training plan,
run session with timers/audio cues, progress history). Hard constraints shape
how that coverage can run:

- This is a free app with no backend, so there is no budget for paid test
  infrastructure.
- The EAS free tier includes 60 CI/CD minutes/month, and EAS Workflows'
  pre-packaged `maestro` job is only available on paid plans
  ($0.05/job + build minutes) and is still in alpha.
- The repo is not yet EAS-initialized: no `eas.json` and no `.eas/workflows/`.
  (Maestro flows need an appId to launch — `app.json` sets
  `se.lukaslindqvist.myrunner` as both `ios.bundleIdentifier` and `android.package`.)
- The Maestro CLI and the official Maestro MCP server are already installed
  and verified working locally.
- Project policy is official tooling only: first-party MCP servers and vendor
  tools, no unofficial or community wrappers.

## Decision

Maestro flows live in `.maestro/` at the repo root. They are authored and
executed **locally** against the iOS Simulator, either with the Maestro CLI
(`maestro test .maestro/`) or through the official Maestro MCP server
registered project-scope in `.mcp.json`. No unofficial skills or wrappers.

Scripted E2E regression lives only in `.maestro/`. The Argent MCP tooling that
shares `.mcp.json` covers the interactive dev loop (exploratory QA, debugging,
profiling, and reading element IDs while authoring flows); its flow
record/replay feature is a dev-loop convenience, not a second E2E layer.

**When to run:**

- The **full suite** runs locally before merging to `main` any change touching
  `src/`, `app.json`, or dependencies.
- **Targeted flows** run during development at the developer's/agent's
  discretion.

## Consequences

- Zero E2E infrastructure cost.
- Tests require a Mac with a booted simulator; there is no cross-device or
  server-side enforcement of the before-merge policy.
- Flows are written to be EAS-compatible: `.maestro/` matches the
  `flow_path` the EAS Workflows `maestro` job expects, so when budget allows,
  that job becomes the PR gate with zero flow rewrites. Moving to a paid EAS
  plan (or the `maestro` job leaving alpha) is the explicit trigger to revisit
  this decision.

## Alternatives considered

- **EAS-hosted `maestro` job now** — rejected: requires a paid plan and the
  job is still in alpha.
- **Maestro Cloud** — rejected: subscription cost.
- **Third-party Maestro MCP wrappers** — rejected: unofficial, against
  project tooling policy.

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

The `e2e-ios` job caches the built native simulator `.app` in `actions/cache`
keyed by the `@expo/fingerprint` hash (the same hash that drives
`runtimeVersion`). On a fingerprint hit — a PR that changes only JS — it skips
the native build and refreshes the JS with `@expo/repack-app` (which also
regenerates the expo-updates embedded manifest), cutting a run from ~25 min to
~5–7 min; a fingerprint miss (a native change) does the full `eas build --local`
and re-primes the cache. Design:
`docs/superpowers/specs/2026-07-13-e2e-fingerprint-app-reuse-design.md`.

## Amendment (2026-07-31): simulated GPS *motion* is out of scope for Maestro

Maestro cannot drive a moving location stream into this app, so a flow asserting
recorded distance, pace or a drawn route cannot pass. `run-distance.yaml` — which
covered exactly that — is **removed** rather than left permanently red; what it
covered moves to the device checklist (Stage 4 section).

The cause is structural, not a misconfiguration, and was measured rather than
inferred:

- `travel` is not a distinct primitive. `maestro.orchestra.geo.Traveller` calls
  `Maestro.setLocation` in a loop, interpolating between waypoints — so it is
  repeated discrete `setLocation`, and open upstream issue
  [#921](https://github.com/mobile-dev-inc/maestro/issues/921) ("setLocation
  causes issue if called multiple times") is the same defect.
- Maestro's iOS driver never invokes `xcrun simctl location`. No jar in the
  distribution passes a `location` subcommand to simctl, so `setLocation` does not
  drive the simulator's location engine and CoreLocation reports no movement.
- Waypoint count is not the variable: 2 waypoints and 3 waypoints both recorded
  ~1.2 m over a 40 s session (rendering `0.00 km`), and 11 waypoints hung the run.
- It is not about which expo-location API we consume. Adding a foreground
  `watchPositionAsync` alongside the `startLocationUpdatesAsync` task (ADR 0008)
  changed nothing: the same build recorded no distance under `travel` and passed
  under `simctl location start`. A dual-source tracker was therefore rejected —
  it gains no product benefit (the task already runs `BestForNavigation` at
  `distanceInterval: 0`), feeds two streams into a smoother tuned for one
  (ADR 0021), and puts a handoff seam exactly where ADR 0008 exists to prevent
  one.

**What works, for manual verification:** `xcrun simctl location <udid> start`
drives the simulator's route engine, which CoreLocation reports as genuine moving
fixes. With it, the full former flow passed end to end — distance, pace, route
card, full-screen viewer, splits and the Log round trip:

```bash
xcrun simctl location <udid> start --speed=2.8 --interval=1.0 59.3293,18.0686 59.3353,18.0686
```

That is a **manual** tool, not a suite step: a scenario cannot run for the whole
suite, because `complete-session.yaml` asserts the *absence* of distance. Revisit
if Maestro ever routes iOS `setLocation` through `simctl location`.
