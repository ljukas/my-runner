<!--
  Roadmap-feature research doc template.
  Copy to docs/superpowers/research/YYYY-MM-DD-<feature>.md and fill in.
  Delete these comments as you go. Keep it verdict-first: a reader should get
  the answer from the TL;DR and only descend for evidence.
  Every load-bearing claim needs a dated, linked source (see SKILL.md rigor bar).
-->

# <Feature> — research

Date: YYYY-MM-DD
Status: **research / <Researched | options under consideration>** — not a decision to build.

**Question:** <the one crisp question this doc answers>

## TL;DR

- **Feasibility:** `Feasible` | `Feasible-with-caveats` | `Blocked` — <one line>
- **Local-first fit:** `Fully local` | `Local, optional network` | `Requires network/backend` — <one line>
- **Recommended approach:** <the approach, one line — and note this is an assessment, not a commitment>

## Context

<What the feature is and why it's on the roadmap. Which ADRs and subsystems it
touches (link them) — e.g. ADR 0010 maps, ADR 0004 schema, ADR 0003 ports.
Which `AGENTS.md` hard constraints it inherits (no backend/accounts/analytics;
on-device + iCloud; iOS-primary).>

## Findings

<The gathered facts, grouped sensibly. Each load-bearing claim carries a dated,
linked source. Cover what the device can do, what our libraries expose, and what
external sources exist — in that order.>

- **<finding>** — <detail> ([source](URL), verified YYYY-MM-DD)

## Options

### Option A — <name>
<How it works. Trade-offs.>

### Option B — <name>
<How it works. Trade-offs.>

### Option C — <name>  <!-- optional -->
<How it works. Trade-offs.>

## Comparison

| | A — <name> | B — <name> | C — <name> |
|---|---|---|---|
| Feasibility | | | |
| Local-first | | | |
| Battery / power | | | |
| Platform reach | | | |
| Cost | | | |
| Maintenance / tooling | | | |

## Feasibility assessment

<Rating + reasoning: buildable on Expo SDK 57 + CNG? effort, platform floor,
alpha/maintenance risk, custom-native-code needs.>

## Local-first assessment

<Rating + reasoning: does it hold the no-backend/no-accounts/on-device line? if a
network dependency exists, is it justified and does it degrade gracefully?>

## Recommendation

<The recommended approach and why. Then, explicitly:>

> This is an assessment, not a decision to build. A build commitment belongs in
> an ADR.

## Open questions / next steps

- <What a follow-up ADR would need to decide.>
- <What a staged implementation plan would need to resolve.>
