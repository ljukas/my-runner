# 18. Free-run route generation: an on-device pure-JS loop heuristic over a cached Overpass network behind a Route-generator port, hosted APIs and native engines excluded from the default

Date: 2026-07-14

## Status

Proposed — draft for review. Flip to `Accepted` on merge.

## Context

"Free run" is a candidate mode alongside the guided C25K plan: the runner enters a
target distance (e.g. 4 km) and the app suggests a road/footpath-following **loop**
from their current location, then tracks the run like any other. The feature was
researched through the feasibility and local-first lenses first; full evidence and
citations are in
[`docs/superpowers/research/2026-07-14-free-run-route-generation.md`](../superpowers/research/2026-07-14-free-run-route-generation.md).
The findings that constrain this decision:

- **Two sub-problems, only one of them open.** *Display* is already solved by
  [ADR 0010](0010-maps-expo-maps-ios18-floor.md): `expo-maps` renders per-segment
  `polylines` and the `RouteMap` port owns camera-fit math (`domain/geo.ts`).
  expo-maps exposes **no routing/directions API**, so route *generation* is the only
  unsolved half and must come from elsewhere.
- **No official, on-device, cross-platform loop generator exists.** GraphHopper has a
  real `round_trip` algorithm but only in its **hosted** API; its mobile embed is dead
  on both platforms (iOS port last released 2016 / last touched 2021 at GraphHopper
  1.0, labelled experimental; the maintainer dropped Android offline support in 2020).
  BRouter has a genuine native round-trip mode (`engineMode=4`, added July 2025) but
  it is **Android-only** and architected as a companion service, not an embeddable
  library. Valhalla has **no** round-trip algorithm; on-device Valhalla exists only via
  the community `valhalla-mobile` behind **Ferrostar**, which is a navigation SDK with
  no loop generation and **no React Native bindings**. Apple MapKit `MKDirections` is
  point-to-point, network-only (Apple's servers), iOS-only, and has no Expo module.
- **The buildable path is pure-JS.** `geojson-path-finder` (Dijkstra) and `ngraph.path`
  (A*/NBA*, ~44 ms on a 264k-node graph) are pure-JS shortest-path cores with a custom
  cost-function hook — both **point-to-point only**, with no OSM ingestion and no loop
  mode. A distance-targeted loop is a **heuristic we build on top** (sample waypoints
  on a circle sized to the target, snap to the network, chain shortest-paths, penalise
  edge reuse so out and back legs differ, emit a few candidates by varying seed /
  direction) — the same shape GraphHopper's `round_trip` and Garmin's on-watch course
  generator use internally.
- **The street network can be fetched keyless, but not shipped.** The Overpass API is
  keyless (IP-based, no account), generous (~10k requests/day, <1 GB/day) and easily
  covers a ~2–3 km-radius footway extract. Bundling a global network is infeasible
  (planet-scale), exactly the wall the elevation-DEM research hit
  ([ADR 0015](0015-run-elevation-on-device-barometer.md)) — so the network is fetched
  per area and cached, making the feature online-to-fetch, offline-to-generate.
- **OSM licensing (ODbL) is manageable.** On-device routing over OSM data needs
  app-level OSM attribution, not per-route licensing ("routing instructions … need not
  maintain attribution … as long as they do not form a Derivative Database"); a
  displayed route is a "Produced Work", and recipients may request the underlying data.
  A single in-app "© OpenStreetMap" credit satisfies this; we must not redistribute a
  preprocessed network extract as our own.
- **Hermes compatibility of the JS routing lib is unverified** — both libraries look
  browser/Node-clean but neither states RN/Hermes support. This is the top technical
  unknown, with a direct precedent for failure (`geotiff.js` under RN, per the
  elevation research).
- **Run engine & storage.** The run engine ([ADR 0007](0007-run-engine-event-log.md))
  builds a fixed timeline from `PlannedSegment[]`; a free run is open-ended — a modest
  new engine mode, not a new engine (the event-log core is mode-agnostic). `runs`
  ([ADR 0004](0004-local-storage-expo-sqlite-drizzle.md)) already has a
  `summary_polyline`; `sessionKey` is `NOT NULL` — storing a free run is additive.
- **Dependency ordering.** This rides on **Stage 3** (GPS start location + live run)
  and **Stage 4** (map display); it is a post-Stage-4 feature.
- **`AGENTS.md` hard constraints:** no backend, no accounts, no analytics; on-device
  data with iCloud as the only sync; iOS-primary, Android-secondary. Build-time keys
  are a priced exception; **runtime metered keys are friction**; community deps are
  allowed only as explicit priced exceptions (cf. react-native-maps, ADR 0010).

## Decision

**Generate the loop on-device with a pure-JS heuristic over an Overpass-fetched,
per-area-cached pedestrian network, behind a `services/route` Route-generator port
([ADR 0003](0003-platform-ports-and-adapters.md)); render it through the existing
`RouteMap`/expo-maps polyline path ([ADR 0010](0010-maps-expo-maps-ios18-floor.md)).
Hosted round-trip APIs, native routing engines, and MapKit are excluded from the
default; a hosted API is retained only as a deferred, opt-in fallback behind the same
port.** Accepted now to fix the approach; implemented when the free-run mode ships
in/after Stage 4 — the same "decide the shape before the stage" posture as ADR 0010,
ADR 0015, and ADR 0017. **This decision is gated on a Hermes spike (§8); if that spike
fails, the default flips to the hosted-API adapter behind the same port.**

1. **What we generate:** one or a few **approximate-distance loop** candidates
   (Garmin and GraphHopper both surface ~3) from the current location, returning to
   the start. "Approximate" is inherent and acceptable — the target distance is a
   goal, not a contract.
2. **The seam — a Route-generator port, but pure-JS (no platform fork).** `services/route/port.ts`
   exposes a small, platform-free interface holding only types — no routing-lib or
   Overpass import — roughly `isAvailable()`, `generateLoop({ start, targetMeters,
   seed? }): Promise<RouteCandidate[]>` (a `RouteCandidate` being an ordered
   coordinate list + its computed length). Because generation is pure JS, this port
   needs **no `adapter.ios.ts` / `adapter.android.ts` fork** — unlike the elevation
   (ADR 0015) and tip-jar (ADR 0017) native-SDK ports, it is closer to the
   `RunPersistence` seam (`src/services/run-engine/types.ts`): one platform-free
   implementation behind a stable interface. Nothing outside `services/route` imports
   the routing library.
3. **The algorithm lives in `domain/` and is pure, unit-tested TS.** Circle-sampling,
   waypoint snapping, chaining shortest-paths, the edge-reuse penalty, and
   target-distance selection are a pure helper (e.g. `domain/route.ts`) covered by
   `bun test` with a fixture network — mirroring ADR 0010's `domain/geo.ts` camera-fit
   precedent and ADR 0003's split (fakes for logic, device verification for the
   data/lib seam). The pure-JS routing core (`geojson-path-finder` or `ngraph.path`,
   chosen at build time) is a **community dependency and thus an explicit priced
   exception** to the official-tooling preference — a light one (small, pure-JS, no
   native code), narrower than ADR 0010's react-native-maps.
4. **Data: keyless Overpass fetch + per-area cache.** The adapter fetches the
   `highway`/`footway` network for a radius around the start from a public Overpass
   instance (keyless, IP-based), converts it to GeoJSON LineStrings, and caches it per
   area (key/TTL settled at build time). It sends a descriptive `User-Agent`, has a
   fallback instance policy, and **degrades gracefully**: online to fetch a new area,
   then fully offline to generate and re-generate from cache; a clear "needs
   connectivity once" state when no cache exists.
5. **Display reuses ADR 0010.** A `RouteCandidate` is rendered as an `AppleMaps.View`
   polyline via the existing `RouteMap` port and its camera-fit math — no new map work,
   no map-library decision reopened.
6. **Run engine & storage.** A new **open-ended run mode** in the engine
   ([ADR 0007](0007-run-engine-event-log.md)) drives a free run (no fixed segment
   timeline); the event-log core is unchanged. Storage is **additive**
   ([ADR 0004](0004-local-storage-expo-sqlite-drizzle.md)): a free run is a `runs` row
   with its `summary_polyline`, reconciling the `sessionKey NOT NULL` /
   segment-`kind`-enum assumptions for a non-plan run (exact shape at build time). No
   change to existing rows.
7. **OSM attribution (ODbL).** The app carries a persistent, discoverable
   "© OpenStreetMap" credit (a startup credit or an always-reachable About/"(i)"
   entry); route output is treated as a Produced Work; we do not ship or redistribute
   a preprocessed network extract as our own data.
8. **Hermes spike is a blocking gate.** Before this default is committed,
   implementation must verify on-device that the chosen pure-JS routing lib actually
   runs under Hermes/RN on a ~2–3 km extract and measure generation time for a 4 km
   loop with several candidates (the ADR 0015 background-spike pattern). If it cannot
   run or is too slow, the default flips to the hosted-API adapter (§9) behind the
   *same* port — screens, engine, and storage untouched.
9. **Hosted round-trip API excluded from the default, retained as a deferred
   fallback.** GraphHopper `round_trip` (or OpenRouteService) can be a future adapter
   behind the same port, but each needs an **account + runtime metered key** (500/day
   non-commercial for GraphHopper; 2,000/day for ORS) and connectivity per route — the
   friction `AGENTS.md` flags. It is only ever a fallback (spike failure) or an
   explicit opt-in quality booster, **never** the default or the offline path, and if
   adopted it is a standing priced exception like ADR 0010's react-native-maps.

## Consequences

- **Fully on-device generation, cross-platform, no runtime key.** The route math runs
  in Hermes on both iOS and Android from one codebase, with no account and no metered
  key — the strongest available fit to `AGENTS.md`, at pure-JS (cheapest) native cost.
- **`Local, optional network`, not fully local.** The app cannot ship the planet's
  streets, so a new area needs one keyless, cacheable network fetch before generation.
  This is an honest, graceful degradation (online-to-fetch, offline-to-generate), not a
  backend or an account — but it is a network dependency, unlike ADR 0015's fully
  on-device sensors.
- **We own an algorithm.** Unlike the sensor/IAP ports that wrap a vendor SDK, the loop
  heuristic is our code — testable pure TS immune to library churn, but real work to get
  right (target-distance accuracy, avoiding ugly out-and-backs, footway preference).
- **A community-dependency exception, lightly priced.** The pure-JS routing lib is not
  first-party; it is an explicit exception like react-native-maps (ADR 0010) and
  expo-iap (ADR 0017), but lighter — small, pure-JS, no native code, swappable behind
  the port.
- **The Hermes risk is contained** behind a build-time gate: shipping the on-device
  default requires the spike to pass, but the fallback (hosted adapter, same port)
  needs no new architectural debate.
- **Not the first native-SDK port.** Because it is pure-JS, this does *not* introduce
  the `moduleSuffixes` / `adapter.ios.ts` machinery — that cost still falls to whichever
  of elevation (ADR 0015) or tip-jar (ADR 0017) ships first.
- **Likely no native change.** Pure-JS libs + expo-maps (already in the tree by Stage 4)
  may leave the `@expo/fingerprint` unchanged, keeping the first release that carries
  this an OTA update rather than a native store build
  ([ADR 0012](0012-release-please-fingerprint-gated-releases.md)) — to be confirmed at
  build time.
- **Cost:** one port + one JS adapter, a `domain/` algorithm that must be tested and
  tuned, an Overpass cache policy, an OSM attribution credit, and an open-ended engine
  mode + additive schema row.
- **Deferring costs nothing:** this fixes *how* free-run routing is built if built, not
  *that* it must be; nothing is written until it ships, so dropping it strands no data.

## Alternatives considered

- **Embedded GraphHopper on mobile** — rejected: the iOS port is abandoned
  (2016/2021, experimental) and the maintainer dropped Android offline support (2020);
  the `round_trip`-era engine cannot be assumed to build on either platform.
- **BRouter native round-trip (`engineMode=4`)** — rejected as the cross-platform
  default: genuinely on-device and free, but **Android-only** and a companion-service
  architecture, not an Expo-embeddable library. Leaving iOS-primary uncovered and
  maintaining two different generators is disproportionate. (Could be a future
  Android-only optimisation behind the same port if ever justified.)
- **On-device Valhalla via Ferrostar / `valhalla-mobile`** — rejected: Valhalla has no
  round-trip algorithm, Ferrostar is a navigation SDK with no loop generation and no
  React Native bindings, and tiles must be pre-generated (server-side or bundled). Wrong
  tool, heavy integration.
- **Apple MapKit `MKDirections`** — rejected: point-to-point only, network-bound
  (Apple's servers), throttled, iOS-only, and no Expo module — cannot express a loop and
  would need custom native code to call at all.
- **A hosted round-trip API as the primary mechanism** (GraphHopper / ORS) — rejected
  as default: requires an account and a **runtime metered key** and breaks the
  local-first default (no route offline). Retained only as a deferred, opt-in fallback
  behind the same port (Decision §9), priced as a standing exception if adopted.
- **Bundling a global (or large regional) routable network** — rejected: planet-scale
  data is unshippable, exactly as the elevation-DEM analysis found (ADR 0015). Per-area
  Overpass fetch + cache is the storage-feasible substitute.
- **Defer free-run routing entirely** — viable and not precluded: this ADR fixes *how*
  it is built if built, not *that* it must be. The build commitment remains a separate
  call.
