# 1. Local-first Maestro E2E testing

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
  `se.bovra.myrunner` as both `ios.bundleIdentifier` and `android.package`.)
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
