# Roadmap

Candidate features for after the current delivery stages, and where each one sits
in this repo's pipeline: **research doc → ADR (decision) → staged plan →
implementation**.

Every candidate is researched through two mandatory lenses before it can be
decided:

- **Feasibility** — can we build it on our stack (Expo SDK 57 + Continuous Native
  Generation, official-tooling preference)?
- **Local-first fit** — does it hold the line in [`AGENTS.md`](../../AGENTS.md):
  no backend, no accounts, no analytics; on-device data with iCloud as the only
  sync?

Research is produced by the `research-roadmap-feature` skill
([`.agents/skills/research-roadmap-feature/`](../../.agents/skills/research-roadmap-feature/SKILL.md),
run as `/research-roadmap-feature <idea>`); each feature's deep dive lives in
[`docs/superpowers/research/`](../superpowers/research/).

## Status vocabulary

`Idea → Researching → Researched → Decided (ADR) → Planned → Shipped`

A feature's status is literally how far down the pipeline it has travelled.

## Candidates

| Feature | Status | Feasibility | Local-first | Research | ADR |
|---|---|---|---|---|---|
| Run elevation on the map | Researched | Feasible (iOS); caveats (Android) | Fully local | [2026-07-13](../superpowers/research/2026-07-13-run-elevation-data.md) | [0015 (proposed)](../adr/0015-run-elevation-on-device-barometer.md) |
| In-app donations (tip jar) | Researched | Feasible (iOS + Android) | Fully local (client-only IAP) | [2026-07-14](../superpowers/research/2026-07-14-in-app-donations.md) | — |

<!--
  Add new ideas as `Idea` rows. The project owner decides when one gets
  researched; the workflow does not pre-populate speculative features.
  When a research doc lands, fill in Feasibility, Local-first, and the link,
  and move Status to `Researched`. When an ADR decides it, link the ADR and
  move Status to `Decided (ADR)`.
-->
