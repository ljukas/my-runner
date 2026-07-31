---
name: e2e-refresh
description: Use when a change needs Maestro E2E evidence in this repo — the e2e-simulator app is stale or missing, or a .maestro/ flow was written or edited and needs a targeted run before handoff.
---

# Refreshing and running targeted E2E flows

Two costs hide behind "run the E2E tests" here, and they differ by ~20x. Running
a flow takes seconds. Getting current JS onto the simulator takes 15–20 minutes
if you rebuild the native app — and about a minute if you repack instead. Almost
every JS-only change qualifies for the repack.

Scope: **targeted flows only.** The full suite belongs to CI (`e2e-ios`) and to
the user's own pre-merge run.

## When to use

- A `.maestro/` flow was added or edited and needs to actually pass.
- A change altered a text anchor a flow selects on (ADR 0016).
- A behaviour change needs E2E evidence before handoff.

**Not for:** interactive UI verification while implementing — that is the
`verify` skill (argent on the dev client, no e2e build involved).

## 1. Refresh the app

```bash
.claude/skills/e2e-refresh/refresh.sh
```

It picks the fast path automatically: fingerprint match → repack + install +
verify. It exits **3** when the native fingerprint moved (new native dep, config
plugin, app.json native field), which means a full build is required:

```bash
bun run e2e:build      # ~15-20 min — run in the background, then re-run refresh.sh
```

The script proves the install landed by comparing `main.jsbundle` hashes between
the app it built and the app on the device. Do not skip it and do not
substitute "the build succeeded" — a fresh `.app` on disk that was never
installed leaves the previous binary running, and the suite fails somewhere that
looks like a flow bug.

## 2. Pick the flows

Run the flows your change can actually break, not a guess. Start from the
surface you touched, then confirm by grepping the flow for the text anchors
involved:

| Changed surface | Flows |
|---|---|
| Onboarding steps, permission priming | `onboarding`, `location-primer-allow`, `location-primer-deny`, `location-jit-ask` |
| Run screen, controls, cues | `run-controls`, `complete-session`, `run-abandon` |
| Resume / crash recovery | `run-resume`, `resume-decline` |
| GPS, distance, pace | `run-denied-path` (the no-permission path only — recorded distance/pace/route have **no** flow coverage; ADR 0001's 2026-07-31 amendment, device checklist G1–G5) |
| History, plan, session detail | `log-revisit`, `complete-session` |

## 3. Run them

Free the simulator first — only one automation server may own it:

```
argent stop-all-simulator-servers   (MCP tool)
```

```bash
maestro test .maestro/tests/run-controls.yaml
```

**Never** `maestro test .maestro/` — that is the full suite.
**Never** the Maestro MCP `run` tool: its XCUITest driver stays alive after the
run and the next CLI run dies at `launchApp` with
`Unable to set permissions … Failed to connect to 127.0.0.1:<port>` — a
misleading error that reads like a flow bug. The CLI tears its driver down on
exit.

## 4. Hand back

Report which flows ran and their result, and name any text anchor your change
renamed so the user knows what shifted before their own suite run. Leave no
automation server attached.

## Gotchas

- **Reduce Motion** — CI enables it so Maestro can settle on the continuously
  animating run screen; a local simulator usually has it off. It changes
  Maestro's pre-tap settle time, so flows asserting elapsed-time bands can pass
  locally and fail in CI. A green local run is not proof for those flows.
- **A flaky splash crash** on a `clearState` relaunch is a known Maestro/
  migrations-gate interaction — re-run once before treating it as a real bug.
- `build/` is gitignored, including `.e2e-fingerprint` — nothing here is
  committed.
