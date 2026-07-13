---
name: research-roadmap-feature
description: Use when turning a candidate roadmap feature idea into a standardized, decidable research doc — assessing whether it can be built on this stack and whether it stays local-first — before any ADR or build commitment. Command-only; invoke as /research-roadmap-feature <idea>.
disable-model-invocation: true
---

# Research a Roadmap Feature

Turn one raw feature idea into a **decidable** research doc: cited facts, 2–3
concrete build approaches, and a verdict on the two things that gate this
project — **can we build it on our stack?** and **does it stay local-first?**
The doc *assesses*; it never commits the project to building. Commitment happens
later, in an ADR.

This reuses the repo's existing pipeline — **research doc → ADR → staged plan →
implementation** — and formalizes only the research step. (The release-flow
research doc became [ADR 0012](../../../docs/adr/0012-release-please-fingerprint-gated-releases.md)
exactly this way.)

## When to use

- A candidate feature in `docs/roadmap/README.md` needs to move from `Idea` to
  `Researched`.
- Someone asks "could we build X?" and the honest answer needs facts, not a guess.

**When NOT to use:** a decision that's already made (that's an ADR), or work
already specced (that's the `writing-plans` skill).

## The two mandatory lenses

Every doc rates the feature on both, using these fixed scales so docs stay
comparable across the roadmap:

- **Feasibility** — `Feasible` / `Feasible-with-caveats` / `Blocked`. Buildable on
  Expo SDK 57 + Continuous Native Generation under the official-tooling
  preference? Weigh effort, platform floor, alpha/maintenance risk, and whether
  it needs custom native code.
- **Local-first fit** — `Fully local` / `Local, optional network` /
  `Requires network/backend`. Does it hold the line in `AGENTS.md` — no backend,
  no accounts, no analytics; on-device data with iCloud as the only sync? Any
  network dependency must be justified and must degrade gracefully (the app still
  works offline).

Also always weigh, and call out when material: **battery / power** (load-bearing —
this is a running app leaning on GPS, sensors, maps, and TTS), **platform reach**
(iOS-primary vs Android), **cost** (money / quota / credential ceremony), and
**maintenance & official-tooling alignment** (a community or network dependency
is allowed in a recommendation only as an explicit, priced exception — exactly
how ADR 0010 treats react-native-maps).

## Process

### 1. Frame
Restate the idea as one crisp question. Read the hard constraints in `AGENTS.md`
and every ADR the feature plausibly touches (`docs/adr/`), so the research
*cites* settled decisions instead of re-litigating them. Note the subsystems and
ADRs in scope.

### 2. Gather — local / official sources first
Establish facts before opinions, in this source order:

- **Capability facts** (does our stack support this?): Context7 MCP
  (`resolve-library-id` → `query-docs`), the versioned Expo docs
  (`https://docs.expo.dev/versions/v57.0.0/`), existing code under `src/`, the ADRs.
- **External data / service facts** (only where on-device isn't enough):
  `WebSearch` / `WebFetch` for free data sources, offline datasets, licensing,
  rate limits, uptime. When this surface is wide, drive it with the
  `deep-research` skill.
- **Architecture fit** (when the feature reshapes existing modules): optionally
  run `/improve-codebase-architecture` for the seam it would live behind.

**Rigor bar:** every load-bearing claim — a version, "it's free", "it works
offline", "the API exists" — carries a dated, linked source and a second,
adversarial check. Unverified belief is not a finding.

### 3. Evaluate
Rate both lenses (above). Fill in the secondary notes.

### 4. Options
2–3 concrete implementation approaches, trade-offs for each, plus a comparison
table and a recommended approach.

### 5. Write & index
Fill `TEMPLATE.md` (in this skill's directory) into
`docs/superpowers/research/YYYY-MM-DD-<feature>.md`. Then update the feature's row
in `docs/roadmap/README.md` — status → `Researched`, both verdicts, link the doc.

### 6. Next-step hooks (offer, don't do)
If the research is decisive, offer to draft an ADR (research → ADR). If the
feature is greenlit to build, offer the `writing-plans` skill. The terminal state
of *this* skill is a written, indexed research doc — it builds nothing.

## Output contract

The doc follows `TEMPLATE.md` exactly, verdict-first:

1. Title / Date / Status / the one-line question
2. **TL;DR** — feasibility verdict + local-first verdict + recommended approach (3–5 lines)
3. **Context** — the feature; ADRs / subsystems touched (linked); inherited constraints
4. **Findings** — each with a dated, linked source
5. **Options** — 2–3, trade-offs each
6. **Comparison table** — approaches × {feasibility, local-first, battery, platform, cost, maintenance}
7. **Feasibility assessment** — rating + reasoning
8. **Local-first assessment** — rating + reasoning
9. **Recommendation** — the approach + an explicit "not a decision to build; that belongs in an ADR" line
10. **Open questions / next steps** — what a follow-up ADR or plan would resolve

## Common mistakes

- **Verdict without citation.** "GPS altitude is inaccurate" is a finding only
  with a dated source; a guessed version or price fails the rigor bar.
- **Skipping a lens because it "obviously" passes.** Both lenses are rated in
  every doc, even when the answer is easy — that comparability is the point.
- **Sliding into a decision.** A recommended approach is not a commitment to
  build. Keep the "not a decision" line.
- **Reaching for a network API first.** Exhaust on-device options before anything
  that leaves the device; a network dependency must be justified and optional.
- **Re-litigating an ADR.** Cite it. Surface a conflict only when the friction is
  real enough to reopen the ADR, and mark it clearly.
- **Listing an infeasible direction as a live option.** If a direction turns out
  feasibility-blocked, document it as a rejected alternative (in Findings, or a
  short note after Options) — not as Option A/B/C. Options are things we could
  actually choose.
