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
| Run pace & elevation profile (chart on the run summary — **not** on the map) | **In progress** — pace slice building; elevation deferred to the barometer slice | Feasible (victory-native adds no native module; fingerprint unchanged) | Fully local | [2026-07-13](../superpowers/research/2026-07-13-run-elevation-data.md) · [spec](../superpowers/specs/2026-08-02-run-elevation-and-pace-chart-design.md) | [0015 (proposed)](../adr/0015-run-elevation-on-device-barometer.md) · 0024 (pending) |
| In-app donations (tip jar) | Researched | Feasible (iOS + Android) | Fully local (client-only IAP) | [2026-07-14](../superpowers/research/2026-07-14-in-app-donations.md) | [0017 (proposed)](../adr/0017-in-app-donations-tip-jar.md) |
| Free run: map-generated loop route of a target distance | Researched | Feasible-with-caveats (custom pure-JS heuristic; Hermes spike) | Local, optional network (on-device generation; keyless Overpass fetch per area) | [2026-07-14](../superpowers/research/2026-07-14-free-run-route-generation.md) | [0018 (proposed)](../adr/0018-free-run-route-generation.md) |
| Active run as an iOS Live Activity (Lock Screen + Dynamic Island) | Decided (ADR) | Feasible-with-caveats (first-party expo-widgets; new native target, device spike) | Fully local (in-app `update()`, push off) | [2026-07-22](../superpowers/research/2026-07-22-ios-live-activities.md) | [0022 (proposed)](../adr/0022-active-run-live-activity-expo-widgets.md) |
| Plan screen: week focus + manual completion (gray/reorder completed weeks; mark days/weeks done) | Researched | Feasible-with-caveats (native @expo/ui collapse/swipe; first-use spike) | Fully local (kv-store plan-view state + `session_completions` table; one migration) | [2026-07-22](../superpowers/research/2026-07-22-plan-week-focus-visibility.md) | [0023 (proposed)](../adr/0023-session-completion-projection-manual-marks.md) |
| Apple Watch companion (heart rate, wrist haptics) | **Idea** — researched, parked | Feasible-with-caveats (separate native watchOS target; no RN/Hermes on watchOS, so zero JS) | Fully local (on-device WatchConnectivity; no backend) | [2026-08-03](../superpowers/research/2026-08-03-apple-watch-companion.md) | — (none warranted yet) |
| Share your run (route + stats image, with a mandatory privacy trim) | Researched | Feasible-with-caveats (recommended Skia-only render is Feasible; live-map-capture alternatives need a device spike or invoke ADR 0010's fallback trigger) | Fully local (on-device render; outward step is the user-invoked system share sheet, not a backend) | [2026-07-29](../superpowers/research/2026-07-29-share-your-run.md) | — |
| `CMPedometer` floors as an elevation source (custom Expo module for `floorsAscended`/`floorsDescended`) | **Researched** — not recommended; floors is Apple's *stair* count, not elevation gain | Feasible (local Expo module in `modules/`, autolinked, CNG-safe) — but fitness-for-purpose fails, not feasibility | Fully local (CoreMotion on-device; no network, no new prompt) | [2026-08-03](../superpowers/research/2026-08-03-cmpedometer-floors-elevation.md) | — (none warranted; ADR 0015 stands) |

<!--
  Add new ideas as `Idea` rows. The project owner decides when one gets
  researched; the workflow does not pre-populate speculative features.
  When a research doc lands, fill in Feasibility, Local-first, and the link,
  and move Status to `Researched`. When an ADR decides it, link the ADR and
  move Status to `Decided (ADR)`.
-->
