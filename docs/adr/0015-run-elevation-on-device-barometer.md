# 15. Run elevation: on-device barometer-first behind an Elevation port, network DEM excluded from the default

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0018](0018-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-13

## Status

Proposed — draft for review. Flip to `Accepted` on approval. Numbered 0015 because
0014 is taken by the in-flight text-first-Maestro-selectors ADR on another branch.

## Context

Elevation is a candidate companion to the Stage 4 route map (ADR 0010): once a run
is recorded from GPS, showing how much the runner climbed is natural paid-app
parity. Before committing, the feature was researched through the feasibility and
local-first lenses — full evidence and citations in
[`docs/superpowers/research/2026-07-13-run-elevation-data.md`](../superpowers/research/2026-07-13-run-elevation-data.md).
The findings that constrain this decision:

- **The runner-meaningful metric is elevation *gain/loss* (a relative delta), not
  absolute altitude.** That distinction decides everything: a relative delta is
  available cheaply on-device; absolute elevation is not.
- **The device can produce gain/loss on its own.** `expo-sensors` `Barometer`
  gives `relativeAltitude` (metres) on iOS via CoreMotion `CMAltimeter`;
  `expo-location` gives GPS `altitude`. Both are first-party Expo modules already
  compatible with the stack — no custom native code, no new alpha dependency.
- **GPS altitude is too noisy to sum.** Smartphone vertical error is ~2× horizontal
  (~15–50 m); summing per-sample deltas systematically *inflates* cumulative gain.
  The barometer is imprecise in absolute terms (weather drift) but precise for
  *changes* (~1 m) — the right tool for gain/loss.
- **Barometer hardware is asymmetric.** Every iPhone since the iPhone 6 (2014) has
  one; on Android they are relatively rare, so the feature must feature-detect
  (`Barometer.isAvailableAsync()`) and fall back to GPS.
- **You cannot get elevation "from the map."** MapKit, expo-maps (alpha), and the
  Google Maps SDK expose terrain only as a *visual render* — there is no queryable
  per-coordinate elevation API on either platform.
- **Off-device sources conflict with the ethos or are infeasible.** Free keyless
  elevation APIs (Open-Meteo, OpenTopoData) are network-dependent, carry "no uptime
  guarantee", and impose attribution; the reliable ones (Google, Mapbox) require
  accounts, keys, and billing — against the no-backend/no-accounts line in
  `AGENTS.md`. Bundling a global DEM is infeasible (smallest usable is ~12 GB at
  90 m, tens–hundreds of GB at 30 m) and no React Native library reads one
  on-device.
- **Storage is additive.** `runs` today has only a `summary_polyline` placeholder
  (`src/db/schema.ts`); there is no elevation column and no `run_points` table yet,
  so adding elevation touches no existing data (ADR 0004).
- **Elevation is a platform-touching capability**, so ADR 0003 already dictates its
  shape: a port with per-platform adapters, pure math in `domain/`.

## Decision

**Capture elevation gain/loss on-device behind an `Elevation` port (ADR 0003),
barometer-first with a GPS-altitude fallback. Absolute elevation and every
network/DEM source are excluded from the default; a network DEM enrichment is
deferred as an explicit, opt-in future adapter only.** Accepted now to fix the
approach; implemented when elevation ships in/after Stage 4 (like ADR 0010's maps
decision, taken before Stage 4).

1. **What we capture:** per-run **elevation gain and loss** (relative deltas), not
   absolute altitude. This is the only metric reliably available on-device and the
   one runners care about.
2. **Source hierarchy, feature-detected at runtime:** iOS barometer
   (`relativeAltitude`) is primary; where `Barometer.isAvailableAsync()` is false
   (most Android), fall back to **smoothed** GPS altitude — never raw per-sample
   summing.
3. **Port & adapters (ADR 0003):** `services/elevation/port.ts` exposes a small,
   platform-free interface (shape TBD at build time, e.g.
   `isAvailable()` / `start()` / `stop()` / `onSample(cb)` yielding a running
   gain/loss, or a summary read at run end). `adapter.ios.ts` wraps
   `expo-sensors` + `expo-location`; `adapter.android.ts` lands with the Android
   pass. Nothing outside `services/` imports `expo-sensors`.
4. **Math lives in `domain/`:** converting samples to gain/loss and smoothing GPS
   altitude is a pure helper (e.g. `domain/elevation.ts`), unit-tested under
   `bun test` with fake samples — mirroring ADR 0010's `domain/geo.ts` camera-fit
   precedent and ADR 0003's testing split (fakes for logic, device verification for
   adapters).
5. **Storage (ADR 0004):** additive — an `elevation_gain_m` (and `elevation_loss_m`)
   summary on `runs`, and/or `altitude`/`pressure` columns on the future
   `run_points` table when it is designed. No change to existing rows.
6. **Network DEM excluded from the default, retained as a deferred option:** a
   future opt-in "absolute elevation profile" could add a network adapter behind the
   *same* port (Open-Meteo keyless, or OpenTopoData fallback), cached per area, and
   must degrade gracefully to on-device gain/loss when offline. It is not part of
   this decision and not on any default/offline path.
7. **Background behavior is a build-time gate:** whether the barometer keeps
   delivering updates during a locked-phone run under the ADR 0008 location
   heartbeat is unverified (the expo-sensors iOS module stops updates on
   background per its source). Implementation must verify this on-device
   (Milestone-style spike); if it cannot run backgrounded, gain is reconstructed
   from foreground samples plus the GPS fallback. The port hides which path won.

## Consequences

- **Fully local-first:** no account, no token, no backend, no third party — only
  first-party Expo modules. Unlike ADR 0010's react-native-maps fallback, this
  needs **no official-tooling exception**.
- **Relative-only in v1:** no absolute elevation-vs-sea-level profile. Accepted —
  gain/loss is the metric; the deferred DEM adapter reopens absolute elevation
  later without reshaping anything (a pure adapter swap behind the port, exactly the
  ADR 0003 flexibility).
- **Android quality varies** with hardware; the GPS fallback is the floor, and a
  future DEM enrichment would even it out if users ask for it.
- **The barometer background risk is contained** behind the port and a device
  verification gate — the decision to ship the on-device path requires that spike to
  pass, but needs no new architectural debate.
- **Cost:** one more port + adapter pair and a small `domain/` helper; the port must
  resist method bloat like the other five (ADR 0003).
- **Deferring costs nothing:** the ADR fixes the approach without forcing elevation
  to be built; if it is dropped, no data is stranded (nothing is written yet).

## Alternatives considered

- **GPS altitude as the primary source** — rejected: vertical noise (~15–50 m)
  inflates summed gain; usable only as a smoothed fallback where no barometer
  exists.
- **Elevation "from the map" (MapKit / expo-maps / Google Maps SDK)** — rejected:
  no per-coordinate terrain-elevation API exists on either platform; the SDKs render
  terrain, they don't return its height.
- **A network elevation API as the source** (Open-Meteo, OpenTopoData, USGS,
  Google, Mapbox) — rejected as default: network dependency and, for the reliable
  providers, accounts/keys/billing/attribution — against the local-first, no-accounts
  ethos. Kept only as a deferred, opt-in enrichment adapter behind the same port.
- **Bundled / offline global DEM** — rejected: ~12 GB (90 m) to hundreds of GB
  (30 m), orders of magnitude beyond a shippable app, and no React Native library
  reads a DEM on-device. Per-area tile caching is storage-small but needs a network
  fetch for each new area, so it is not truly offline and reintroduces an external
  dependency.
- **Defer elevation entirely** — viable and not precluded: this ADR fixes *how*
  elevation is captured if built, not *that* it must be. The build commitment
  remains a separate call.
