# Roadmap-feature research workflow — design

Date: 2026-07-13
Status: **approved design** — ready for implementation

## Problem

The app has a growing list of "wouldn't it be nice" feature ideas for after the
current stages ship (mapping runs, elevation, splits, cadence, social-free
sharing, …). Today there is no repeatable way to turn a raw idea into something
*decidable*: each investigation is ad-hoc, its depth varies, and the two things
that actually gate this project — **can we build it on our stack?** and **does
it stay local-first?** — are not evaluated consistently.

This repo already has half the pipeline. Research docs live in
`docs/superpowers/research/` (e.g. `2026-07-12-release-flow-options.md`), and a
decisive one graduates into an ADR (that doc became [ADR 0012](../../adr/0012-release-please-fingerprint-gated-releases.md)),
then a staged plan, then implementation. What is missing is (a) a **named,
repeatable workflow** for producing the research doc to a consistent standard,
and (b) a **roadmap artifact** that shows all candidate features and where each
one sits in that pipeline.

## Goals

1. A reusable, command-invoked workflow that takes one feature idea and produces
   a standardized research doc, always evaluated through two mandatory lenses:
   **feasibility** and **local-first fit**.
2. A central roadmap index listing candidate features and their status.
3. Prove the workflow by applying it to the first idea: **elevation data for the
   run map**.

## Non-goals (YAGNI)

- Not a project-management tool. The roadmap index is a Markdown table, not a
  board, not issues, not milestones with dates.
- Not a decision. The workflow *assesses*; it never commits the project to
  building a feature. Commitment happens later, in an ADR (same posture as the
  release-flow research's explicit "not a decision").
- Not automation. No CI, no generated docs, no scripts. It is a skill a human
  runs when they want a feature researched.
- Not a rewrite of the existing pipeline. Research doc → ADR → staged plan →
  implementation already works; this formalizes only the *research doc* step and
  adds an index above it.

## Deliverable 1 — the `research-roadmap-feature` skill

A command-invoked skill at `.agents/skills/research-roadmap-feature/`, modeled on
the existing `.agents/skills/improve-codebase-architecture/` (command-only,
`disable-model-invocation: true`, invoked as `/research-roadmap-feature <idea>`).

### Files

```
.agents/skills/research-roadmap-feature/
  SKILL.md      # the workflow process (this section, operationalized)
  TEMPLATE.md   # the research-doc skeleton the skill fills in
```

### Process (what SKILL.md instructs)

**0. Frame.** Restate the idea as one crisp question. Read the hard constraints
in `AGENTS.md` (no backend/accounts/analytics; on-device + iCloud only; mobile
only, iOS-primary) and every ADR the feature plausibly touches, so the research
never re-litigates a settled decision — it cites it. Record which subsystems and
ADRs are in scope.

**1. Gather — fan-out, local/official sources first.** Establish facts before
opinions, and prefer sources in this order:

- **Capability facts** (does our stack support this?): Context7 MCP
  (`resolve-library-id` → `query-docs`) for Expo SDK 57 / React Native / library
  APIs; the versioned Expo docs (`https://docs.expo.dev/versions/v57.0.0/`);
  existing code under `src/`; the ADRs.
- **External data / service facts** (only where on-device isn't enough):
  `WebSearch` / `WebFetch` for free data sources, offline datasets, licensing,
  rate limits, uptime.
- **Architecture fit** (when the feature reshapes existing modules): optionally
  run `/improve-codebase-architecture` for the "where does this seam live" angle.
- **Rigor bar:** every load-bearing claim — a version number, "it's free," "it
  works offline," "the API exists" — carries a dated, linked source and gets a
  second adversarial check. This matches the citation discipline of
  `2026-07-12-release-flow-options.md`. Prefer the `deep-research` skill for the
  web-facing portion when the external-source surface is wide.

**2. Evaluate through the mandatory lenses.** Every research doc rates the
feature on both, using fixed scales so docs are comparable:

- **Feasibility** — `Feasible` / `Feasible-with-caveats` / `Blocked`. Buildable
  on our stack (Expo SDK 57, Continuous Native Generation, official-tooling
  policy)? Effort, platform floor, alpha/maintenance risk, native-code needs.
- **Local-first fit** — `Fully local` / `Local, optional network` /
  `Requires network/backend`. Does it hold the no-backend/no-accounts/on-device
  (+ iCloud) line? Any network dependency must be justified and must degrade
  gracefully (the app still works offline).

Plus **secondary notes**, always considered, called out when material:

- **Battery / power** — load-bearing for a running app that already leans on
  GPS, and would lean on the barometer, maps, and TTS.
- **Platform reach** — iOS (primary) vs Android (secondary); any platform-only
  gaps.
- **Cost** — money, quota, credentials/ceremony.
- **Maintenance & official-tooling alignment** — first-party vs community
  dependency (per the standing official-tooling preference; community deps are
  an explicit, priced exception, cf. ADR 0010's react-native-maps stance).

**3. Produce options.** 2–3 concrete implementation approaches with trade-offs,
a comparison table, and a recommended approach.

**4. Write & index.** Fill `TEMPLATE.md` into
`docs/superpowers/research/YYYY-MM-DD-<feature>.md`; update the matching row in
`docs/roadmap/README.md` (status, verdicts, link).

**5. Next-step hooks (offered, not automatic).** If the research is decisive,
offer to draft an ADR (research → ADR, as release-flow → ADR 0012). If a feature
is greenlit to build, offer the `writing-plans` skill for a staged plan. The
workflow's own terminal state is a written, indexed research doc — nothing is
built by the research step itself.

### TEMPLATE.md structure

Ordered so a reader gets the verdict first and the evidence second:

1. Title, Date, Status, and the one-line question.
2. **TL;DR** — feasibility verdict + local-first verdict + recommended approach,
   in 3–5 lines.
3. **Context** — what the feature is; which ADRs / subsystems it touches
   (linked); constraints inherited from `AGENTS.md`.
4. **Findings** — the gathered facts, each with a dated, linked source.
5. **Options** — 2–3 approaches, trade-offs each.
6. **Comparison table** — approaches × {feasibility, local-first, battery,
   platform, cost, maintenance}.
7. **Feasibility assessment** — rating + reasoning.
8. **Local-first assessment** — rating + reasoning.
9. **Recommendation** — the approach, and an explicit "this is not a decision to
   build; that belongs in an ADR" line.
10. **Open questions / next steps** — what a follow-up ADR or plan would resolve.

## Deliverable 2 — the roadmap index

`docs/roadmap/README.md`:

- Short intro: what the roadmap is, the two lenses, and links to the
  `research-roadmap-feature` skill and the doc template.
- A **status table**, newest/most-active first:

  | Feature | Status | Feasibility | Local-first | Research | ADR |
  |---|---|---|---|---|---|

- **Status vocabulary:** `Idea → Researching → Researched → Decided (ADR) →
  Planned → Shipped`. This mirrors the existing pipeline stages, so a feature's
  status is literally "how far down research → ADR → plan → implementation it
  has travelled."
- Seeded with the **elevation** row only. New ideas are added as `Idea` rows;
  the project owner decides when one gets researched. The workflow does not
  invent scope by pre-populating speculative features.

## Deliverable 3 — first application: run elevation

Dogfood the skill to produce `docs/superpowers/research/2026-07-13-run-elevation-data.md`
answering: *"When we map a run from GPS (Stage 4, ADR 0010), can we also capture
elevation — from the device or from the map — and if not, is there a free source,
ideally without leaving the device?"*

Approaches to research and rate (directions known; all facts verified against
SDK 57 docs during execution):

- **On-device GPS altitude** — `expo-location` altitude field; fully local, zero
  new dependency, but GPS vertical accuracy is poor → noisy elevation gain.
- **On-device barometric altimeter** — `expo-sensors` barometer / iOS relative
  altitude; fully local, no network, strong for *relative* gain/loss (what
  runners care about); needs a device with a barometer.
- **Network DEM lookup** — free elevation APIs (Open-Elevation, Open-Meteo,
  OpenTopoData, USGS) mapping lat/lon → elevation; accurate absolute elevation
  but a network dependency that breaks the local-first default; viable only as
  an optional, non-default enrichment.
- **"From the map"** (Apple Maps / expo-maps) and **bundled offline DEM** —
  expected negative (no elevation API; global DEM too large to bundle);
  documented with the reason either way.

The doc reaches feasibility and local-first verdicts and a recommended approach;
it does **not** commit the project to building elevation. If the verdict is
clear, an ADR is offered as the follow-up.

## Implementation sequence

1. `.agents/skills/research-roadmap-feature/SKILL.md` + `TEMPLATE.md`.
2. `docs/roadmap/README.md` (index, elevation row pending).
3. Run the skill → `docs/superpowers/research/2026-07-13-run-elevation-data.md`.
4. Fill in the elevation row in the index.
5. Commit.

## Relationship to existing decisions

- **Reuses** the research → ADR → plan → implementation pipeline; formalizes only
  the research step and adds an index.
- **Does not modify** any ADR. The elevation research operates *within* ADR 0010
  (maps), ADR 0004 (schema — `run_points` / `summary_polyline` already exist),
  and ADR 0003 (ports & adapters — an elevation source would sit behind a port).
- **Honors** the official-tooling preference: community/network dependencies are
  allowed in a recommendation only as explicit, priced exceptions, exactly as
  ADR 0010 treats react-native-maps.
