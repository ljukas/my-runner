# 24. Charting: victory-native as an official-tooling exception, contained to one file

Date: 2026-08-03

## Status

Proposed — draft for review. Flip to Accepted on merge.

## Context

The run-elevation-and-pace-chart slice ([design spec](../superpowers/specs/2026-08-02-run-elevation-and-pace-chart-design.md)
§3.1, §10) needed the app's first line chart — pace against distance on the run
summary. `AGENTS.md` states a standing preference for Expo-official packages;
no Expo-official charting package exists, so shipping any chart at all means
taking a dependency outside that preference. This ADR is the explicit
exception ADR 0010 modelled for `react-native-maps`: recorded here, not
slipped in as an ordinary `package.json` line.

**Peer requirements, checked against what the app already ships**
(`victory-native@41.26.0`, verified 2026-08-02):

| Peer | Required | Installed | |
|---|---|---|---|
| `react-native-reanimated` | `>=3.0.0` | 4.5.1 | ✅ |
| `@shopify/react-native-skia` | `>=1.2.3 <3.0.0` | 2.6.2 | ✅ |
| `react-native-gesture-handler` | `>=2.0.0` | 2.32.0 | ✅ |

All three are already dependencies — Skia arrived with `skia-countdown.tsx`,
the other two with the run screen. **Nothing new reaches the native layer.**
victory-native's own runtime dependencies are pure JS (`d3-scale`, `d3-shape`,
`d3-zoom`, `its-fine`, `react-fast-compare`), and it ships no native module and
no config plugin.

**Measured, not assumed:** `@expo/fingerprint`'s hash was
`91f6356cdc39c55bbb0eebd5e2f9f5d77bea570f` before the install and
`91f6356cdc39c55bbb0eebd5e2f9f5d77bea570f` after — identical. A JS-only
dependency with no native surface leaves the fingerprint gate untouched, so
`e2e-refresh` stays a ~1 min repack rather than the 15–20 min rebuild that
`expo-maps` and HealthKit each forced when they landed.

**The one real risk was Reanimated version drift.** victory-native's own docs
describe it as "built upon React Native Reanimated (v3)". This repo runs
Reanimated 4.5.1 with worklets extracted into `react-native-worklets`. The
declared peer range (`>=3.0.0`) permits 4.5.1, but *permitted by semver* is not
*verified* — a v3-authored library can still call an API v4 removed or
changed. A spike settled this before any production file was written: a
minimal two-line `CartesianChart` rendered in the dev client, both lines
painted, dual left/right axes rendered with distinct scales and visible tick
labels, no Reanimated/worklets error appeared in the Metro log registry across
the session, and rotating the device repainted without crashing. Confirmed
working on-device, not inferred from the peer range.

## Decision

**Adopt `victory-native` (XL, v41) as the app's charting library, imported in
exactly one file per chart.**

1. **This is a deliberate exception to AGENTS.md's official-tooling
   preference**, exactly as ADR 0010 made one for `react-native-maps` — no
   Expo-official charting package exists, and the alternative (hand-rolled
   Skia paths and axis math for every chart the app ever needs) costs more
   than one well-scoped community dependency.
2. **Single-import containment.** `victory-native` may be imported only in
   `src/components/run-profile-chart.tsx` — never in a screen, a hook, or
   `domain/`. The pace-vs-distance chart's own card
   (`run-profile-card.tsx`) owns gating and accessibility and imports only the
   chart component, mirroring the split that keeps `expo-maps` inside
   `route-map/adapter.ios.tsx` (ADR 0010) and the HealthKit library inside
   `adapter.ios.ts` (ADR 0011). If a future chart needs it, it gets its own
   single-import file under the same rule — this ADR governs the dependency,
   not one component.
3. **Not a component port (ADR 0003).** `RouteMap` is a port because
   `expo-maps` is iOS-only native code with a pre-agreed fallback library.
   `victory-native` is pure JS and cross-platform; a port would be ceremony
   with nothing behind it, since there is no second adapter to swap in — the
   fallback (below) is a rewrite of the one file, not a second implementation
   behind an interface.
4. **The verified fallback, if a future victory-native version breaks under a
   Reanimated bump:** a hand-drawn Skia `Path`, the same primitive
   `skia-countdown.tsx` already draws with. Because of item 2, that rewrite
   touches one file.

## Consequences

- The app gets real charting (dual axes, ticks, line marks) without writing
  scale, tick, and path math by hand — the same buy-vs-build trade ADR 0010
  made for maps.
- **The community-dependency tension is acknowledged and priced**, as ADR
  0010's item 4 priced `react-native-maps`: accepted because no official
  option exists and the dependency is pure JS, so it carries none of the
  native-module risk (fingerprint churn, CNG interaction, App Store binary
  size) that a native community package would.
- **Blast radius is structurally small.** No native module means no
  `e2e-refresh` rebuild penalty and no CNG interaction; single-import
  containment means a breaking upgrade or a swap to the fallback is a one-file
  change, never a search-and-replace across screens.
- **The Reanimated-v3-vs-4.5.1 gap is closed by evidence, not by the semver
  range alone** — the spike is the record that this specific library, on this
  specific Reanimated version, actually renders and survives a re-render.
  A future major bump on either side should re-run that spike rather than
  trust the peer range a second time.
- Waiting for a second chart to prove the pattern would cost nothing forced;
  adopting the exception now, scoped to one file, costs nothing extra either
  — the next chart reuses the same contained import rather than reopening this
  decision.

## Alternatives considered

- **Hand-drawn Skia `Path` for every chart** — rejected as the default,
  correct as the fallback. `skia-countdown.tsx` proves the primitive works in
  this app, but reimplementing scales, axis ticks, and dual-axis domains by
  hand for every future chart is exactly the kind of library victory-native
  already is, at higher ongoing cost.
- **`react-native-svg` plus hand-rolled `d3` scale math** — rejected: strictly
  more code than victory-native for the same result, and still a non-official
  dependency (`react-native-svg`), so it buys nothing on the official-tooling
  axis while costing more to build and maintain.
- **Legacy `victory-native` (pre-XL, Skia-less)** — rejected: superseded by
  the XL rewrite this repo installed; the pre-XL line targets an older
  rendering approach the maintainers have moved off.
- **A web-oriented charting library (Recharts, Chart.js, etc.)** — rejected:
  no React Native rendering target; this is an iOS-only app (ADR 0020) with no
  DOM to render into.
- **Defer charting until an official package exists** — rejected: no Expo
  charting package is on any public roadmap this research found, and the
  pace-vs-distance chart is this slice's entire user-visible value (design
  spec §1); deferring indefinitely on a hypothetical library is not a plan.
