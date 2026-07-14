# Free run with map-generated loop routes — research

Date: 2026-07-14
Status: **research / Researched** — not a decision to build.

**Question:** For a free run outside the C25K plans, the user enters a target
distance (e.g. 4 km) and the app draws a road/footpath-following **loop** route on
the map of approximately that length. Can the route be **generated on-device**
without a backend, and what are the realistic implementation options?

## TL;DR

- **Feasibility:** `Feasible-with-caveats`. No official/first-party tool generates
  distance-targeted loop routes on-device across iOS **and** Android: GraphHopper's
  embedded engine is effectively dead on both mobile platforms, BRouter's native
  round-trip mode is Android-only, and Valhalla/Ferrostar is a navigation SDK with
  no loop generation. The only cross-platform on-device path is a **custom pure-JS
  heuristic** (sample waypoints on a circle → shortest-path between them over a
  locally-held footpath graph), which is cheap to ship (pure-JS, no native code)
  but is algorithm work we'd own, with an unverified Hermes-compat spike and real
  route-quality tuning.
- **Local-first fit:** `Local, optional network`. The *route computation* runs
  on-device, but the app can't ship the world's street network, so it must fetch a
  small area's road/footpath data once per new area (keyless Overpass API, then
  cache) — the same wall the elevation DEM research hit. There is no "fully local,
  zero network, anywhere on Earth" version. It degrades gracefully: fetch when
  online, generate and re-generate offline from cache.
- **Recommended approach:** **Option A** — an on-device pure-JS loop heuristic over
  an Overpass-fetched, locally-cached pedestrian network, rendered as an expo-maps
  polyline (ADR 0010). Hosted round-trip APIs (GraphHopper / OpenRouteService) are
  the simpler fallback but every free one needs a **runtime metered key** and an
  account, which is friction under `AGENTS.md`. This is an assessment, not a
  commitment to build.

## Context

This is a roadmap candidate: a "free run" mode alongside the guided C25K plan, where
the runner picks a distance and gets a suggested loop from their current location.
Two sub-problems: (1) generate a loop of ≈ target distance that follows real
streets/paths and returns to the start; (2) display it on the map and track the run.

ADRs / subsystems it touches:

- **[ADR 0010](../../adr/0010-maps-expo-maps-ios18-floor.md) (maps)** — display is
  solved: `expo-maps` renders per-segment `polylines` on `AppleMaps.View`, and the
  `RouteMap` port already owns camera-fit math. expo-maps is **display-only — it
  exposes no routing/directions API** ([Expo v57 Maps docs](https://docs.expo.dev/versions/v57.0.0/sdk/maps), verified 2026-07-14), so route
  *generation* must come from elsewhere.
- **Stage ordering (spec §12):** this rides on **Stage 3 (GPS tracking)** for the
  start location and live run, and **Stage 4 (maps)** for display — it is a post-Stage-4
  feature.
- **[ADR 0007](../../adr/0007-run-engine-event-log.md) (run engine)** — the engine
  builds a fixed timeline from `PlannedSegment[]`; a free run is open-ended, so it
  needs an open-ended mode (the event-log core itself is mode-agnostic — a modest
  extension), not a new engine.
- **[ADR 0004](../../adr/0004-local-storage-expo-sqlite-drizzle.md) (schema)** —
  `runs.sessionKey` is `NOT NULL` and the segment `kind` enum has no free-run notion;
  storing a free run (and a `summary_polyline`, which already exists) is an additive
  change. No `run_points` table yet.
- **[ADR 0003](../../adr/0003-platform-ports-and-adapters.md) (ports)** — a route
  generator belongs behind a port, like `RouteMap` / the elevation source.
- **`AGENTS.md` constraints** — no backend, no accounts, no analytics; on-device data
  with iCloud sync; iOS-primary, Android-secondary. Build-time keys are a priced
  exception (cf. Android Google Maps key, ADR 0010 §5); **runtime metered keys are
  friction**; community deps allowed only as explicit priced exceptions (cf.
  react-native-maps, ADR 0010 §4).

## Findings

Sources verified 2026-07-14. Findings tagged **[3-0]** passed the research
harness's 3-vote adversarial verification; **[reverified]** were independently
re-checked against the primary source during synthesis (the harness's verify pass
ran out of credits mid-run); **[sourced]** carry a dated primary quote but did not
get a second adversarial pass — flagged where that matters.

### Round-trip generation exists in engines — but almost never on-device, and never cross-platform off-the-shelf

- **GraphHopper has a real `round_trip` algorithm.** `algorithm=round_trip` "will
  get you back to where you started … we will add some randomness"; `round_trip.distance`
  sets the "approximative length of the resulting round trip" and `round_trip.seed`
  yields "a different tour for each value." **[3-0]** ([GraphHopper Directions API](https://docs.graphhopper.com/openapi/routing/getroute))
  — but this is the **hosted** API (key required, see below), and the flexible mode
  it needs requires `ch.disable=true`. **[sourced]**
- **GraphHopper's on-device story is dead on both platforms.** The official iOS port
  (`graphhopper-ios`, j2objc → `libgraphhopper.a`) is labelled "experimental … treat
  it accordingly", its latest release is **0.8.2 (June 13, 2016)** and last commit
  **2021-10-01** (only updating the example to GraphHopper 1.0 — many majors behind
  the `round_trip`-era engine). **[3-0]** ([graphhopper-ios](https://github.com/graphhopper/graphhopper-ios))
  On Android, the maintainer dropped explicit offline-routing support (Android demo
  app removed **2020-07-05**) and stated in Oct 2020 he "won't further maintain
  Android compatibility … Maybe a fork is required." **[3-0]** ([graphhopper#1940](https://github.com/graphhopper/graphhopper/issues/1940))
  → Embedding modern GraphHopper on mobile is not a viable path.
- **BRouter has native round-trip — Android-only.** BRouter engine **v1.7.8 (July
  2025)** added `engineMode=4` to "generate routes returning to the start point",
  taking `roundTripDistance` (meters, default 1500), `direction` (degrees, default
  -1 = random), and `roundTripPoints` (default 5). **[reverified]** ([abrensch/brouter android_service.md](https://github.com/abrensch/brouter/blob/master/docs/developers/android_service.md))
  This is exactly the feature we want — but it is exposed through BRouter's **Android
  Service** interface (Java, Android-only; the docs and homepage claim no iOS), and
  BRouter is architected as a companion routing service for other Android map apps,
  not an embeddable library. **[sourced]** ([brouter.de offline](https://brouter.de/brouter/offline.html))
  So it covers only the secondary platform and doesn't fit an Expo/RN embed cleanly.
- **Valhalla has no round-trip algorithm, and on-device Valhalla is community-only.**
  Stadia Maps' service-limits page lists Valhalla's routing endpoints (Standard,
  Optimized, Matrix, Isochrones, Map Matching, …) with **no round-trip/loop
  endpoint**. **[sourced]** ([Stadia Maps limits](https://docs.stadiamaps.com/limits/))
  On-device Valhalla exists via the community `valhalla-mobile` (Rallista) integrated
  through **Ferrostar** — but Ferrostar is a *navigation* SDK (Swift/iOS + Kotlin/Android,
  **no React Native bindings** named), its built-in Valhalla support is a **hosted
  HTTP adapter** not an embedded engine, and it documents **no round-trip/loop
  generation** — on-device routing is an *extension point* (`CustomRouteProvider`,
  "most commonly used for local route generation") you must implement yourself.
  **[3-0]** ([Ferrostar route providers](https://stadiamaps.github.io/ferrostar/route-providers.html))
  Valhalla tiles also must be pre-generated (server-side or bundled) — "The raw OSM
  PBF file is quite a few steps away from usable for routing." **[sourced]** ([valhalla#4746](https://github.com/valhalla/valhalla/discussions/4746))

### Apple MapKit cannot do it

- **MKDirections is point-to-point, network-bound, iOS-only, no Expo module.** The
  full `MKDirections.Request` surface is `source`, `destination`, `transportType`,
  `requestsAlternateRoutes`, toll/highway prefs, departure/arrival dates — "no
  distance-targeted, round-trip, loop, or waypoint parameter." **[sourced]** ([MKDirections.Request](https://developer.apple.com/documentation/mapkit/mkdirections/request))
  Directions are "requested from Apple" (hosted service, network) and throttled
  (`loadingThrottled`). **[sourced]** ([MKDirections](https://developer.apple.com/documentation/mapkit/mkdirections))
  There is no first-party Expo module, so this would need custom native code and
  still couldn't express a loop.

### Pure-JavaScript routing can run in Hermes — but is point-to-point only, so the loop is our heuristic

- **`geojson-path-finder`** finds the shortest path through a network of GeoJSON
  LineStrings via Dijkstra (`tinyqueue`), builds its own topology with configurable
  coordinate snapping, and takes a custom forward/backward **cost function** (the
  hook to prefer footways, penalise roads, or penalise edge reuse). Its deps are
  pure-JS (`@turf/*`, `tinyqueue`). API is **`findPath(start, finish)` — point-to-point
  only**; there is no round-trip mode and no OSM ingestion. **[sourced]** ([geojson-path-finder](https://github.com/perliedman/geojson-path-finder))
- **`ngraph.path`** is a pure-JS A* / greedy-A* / bidirectional-NBA* pathfinder,
  benchmarked on the NYC road graph (264k nodes / 734k edges) at **~44 ms/query**
  (NBA*) — orders of magnitude more than a 2-3 km footpath extract needs — but again
  **point-to-point only**, with no OSM loader. **[sourced]** ([ngraph.path](https://github.com/anvaka/ngraph.path))
- ⚠️ **Hermes compatibility specifically is unverified.** Both libraries are
  browser/Node-clean in principle (no obvious DOM/Node-stdlib deps), but neither
  source states React-Native/Hermes support — this is the single biggest technical
  unknown and needs an on-device spike, exactly like the `geotiff.js`/RN failure
  called out in the elevation research.
- **The loop is a heuristic we build on top:** sample N waypoints on a circle of
  circumference ≈ target distance around the start, snap each to the network, chain
  `findPath` between consecutive waypoints, and penalise re-using edges so the
  outbound and return legs differ. This is standard prior-art shape (it's roughly
  what GraphHopper's `round_trip` and Garmin's watch do internally), but the tuning
  (avoiding ugly out-and-backs, hitting the target length, staying on footways) is
  real work.

### The street network can be fetched keyless — but not shipped

- **Overpass API is keyless and generous for on-demand small-area fetches.** Public
  instances tolerate "a maximum of about 10000 requests per day … below about 1 GB
  per day", identity is **IP-based with an optional (non-mandatory) user key** — no
  account, no API key — and each server handles ~1M req/day with a 180 s / 512 MiB
  default query budget. **[reverified]** ([Overpass commons](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html), [OSM wiki: Overpass_API](https://wiki.openstreetmap.org/wiki/Overpass_API))
  A `highway`/`footway` extract over a ~2-3 km radius is well within this. Additional
  keyless instances (VK Maps, private.coffee) exist as fallbacks. **[sourced]**
- **Bundling a global network is a dead end** (same conclusion as the elevation DEM
  research): planet-scale OSM data is far beyond a shippable app. So the network must
  be fetched per area and cached — making the feature **online-to-fetch, offline-to-generate**.

### OSM licensing (ODbL) is manageable with app-level attribution

- **On-device routing over OSM data needs app-level OSM attribution, not per-route
  licensing.** OSMF attribution guidelines: credit must be to "OpenStreetMap" and make
  clear the data is under the ODbL; for a mobile app it must be shown to anyone
  "exposed to the … produced work" (a startup/splash credit or an always-reachable
  "(i)"/About entry is acceptable). Crucially, "Routing instructions generated by such
  a routing engine need not maintain attribution attached to the instructions, as long
  as they do not form a Derivative Database." **[sourced]** ([OSMF Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines))
- **A displayed route is a "Produced Work".** Most uses of OSM are Produced Works;
  "any recipient to which you make the Produced Work available can ask for a copy of
  … our data and any Derivative Database you use … You are required to provide these,
  if requested." **[reverified]** ([OSMF Licence & Legal FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ))
  → Practical upshot: show an OSM credit in the app; don't redistribute a preprocessed
  network extract as our own; be able to point at the underlying OSM data. No blocker.

### Free hosted round-trip APIs all need an account + runtime key (or are non-commercial-only)

- **GraphHopper Routing API:** `round_trip` supported; **key required** ("Sign up …
  Create an API key … pass your key as a query parameter in every request"); free tier
  **500 credits/day, non-commercial only**, round trips cost **×2** (~250/day),
  attribution required. **[3-0]** ([GraphHopper API](https://docs.graphhopper.com/openapi/routing/getroute))
- **OpenRouteService:** hosted `round_trip` (≤ 100 km); free "Standard" plan but
  **account + runtime key via HeiGIT**, **2,000 requests/day, 40/min**. **[sourced]** ([ORS restrictions](https://openrouteservice.org/restrictions/), [HeiGIT plans](https://account.heigit.org/info/plans))
- **Stadia Maps / hosted Valhalla:** free tier is **development/evaluation/non-commercial
  only**, credit-metered with a hard **HTTP 429** when exhausted, and **no round-trip
  endpoint** anyway. **[sourced]** ([Stadia Maps limits](https://docs.stadiamaps.com/limits/))
- **BRouter public server (brouter.de):** effectively keyless but self-described as
  "just for a trial and for convenience" (not production), and its `brouter-web`
  frontend still **doesn't expose round-trip** (open feature request since 2019).
  **[sourced]** ([brouter.de](https://brouter.de/brouter/), [brouter-web#236](https://github.com/nrenner/brouter-web/issues/236))
- **Net:** no free hosted round-trip API is simultaneously keyless, production-grade,
  and commercial-use-OK. Any hosted path means shipping/managing a **runtime metered
  key** — the exact friction `AGENTS.md` flags.

### Prior art: incumbents generate loops server-side, except Garmin on-watch

- **Strava** "Routemaster" runs **server-side** (Scala/finagle-thrift), and its route
  quality leans on "tens of billions of GPS points from millions of Strava activities"
  — a data asset unreproducible in a no-backend app; they rejected GraphHopper/neo4j
  for a custom store. **[sourced]** ([Strava Engineering](https://medium.com/strava-engineering/introducing-routemaster-ccecbb47be86))
- **Komoot** offers suggested round trips, but the documented flow is **waypoint-based,
  not distance-targeted** (place start + farthest point, set "Round trip"), and it
  never states client vs server or offline. **[sourced]** ([Komoot support](https://support.komoot.com/hc/en-us/articles/360024590552-Planning-round-trips))
- **Garmin Forerunner 965** generates a **round-trip course from a target distance +
  direction, entirely on the watch UI, returning up to three candidates** — direct
  prior art that on-device distance-targeted loop generation is real on an embedded
  device (it ships preloaded routable TopoActive maps; the manual doesn't *explicitly*
  say the flow is offline — that's inferential). **[sourced]** ([Garmin FR965 manual](https://www8.garmin.com/manuals/webhelp/GUID-0221611A-992D-495E-8DED-1DD448F7A066/EN-US/GUID-D39D8539-1FE6-492E-B9F2-7B71DA432E8E.html))

## Options

### Option A — On-device pure-JS loop heuristic over a cached Overpass network  ✅ recommended
Fetch the pedestrian/road network for a radius around the start once (keyless
Overpass), convert to GeoJSON LineStrings, cache per area. Generate the loop
on-device with a pure-JS shortest-path core (`geojson-path-finder` or `ngraph.path`)
plus our own circle-sampling + edge-reuse-penalty heuristic; produce a few candidates
by varying the seed/direction. Render as an expo-maps polyline (ADR 0010), behind a
route-generator port (ADR 0003).
*Trade-off:* pure-JS = cheapest native cost (no CNG native module) and no runtime key,
but the loop algorithm and OSM→graph/snapping layer are ours to build and tune, and
**Hermes compatibility of the JS routing lib is unverified** (needs a spike). One
network fetch per uncached area (cacheable, keyless, degrades offline).

### Option B — Hosted round-trip API behind an optional-network port
Call GraphHopper `round_trip` (or ORS) for the loop; render the returned polyline.
Minimal on-device code, best route quality with zero algorithm work.
*Trade-off:* requires an **account + runtime metered key** (500/day GraphHopper
non-commercial, or 2,000/day ORS) — the friction `AGENTS.md` warns about — plus
attribution, and it breaks the local-first default (no route without connectivity).
Would need a standing exception like ADR 0010's react-native-maps carve-out, *and*
it's metered at runtime, which the map fallback is not.

### Option C — Android-native BRouter round-trip (secondary-platform only)
Use BRouter's `engineMode=4` on Android via its Android Service, with a pure-JS or
hosted path on iOS.
*Trade-off:* genuinely on-device and free on Android, but **iOS-primary is left
uncovered**, BRouter is a companion-app/service architecture (not an Expo-embeddable
library — medium-to-heavy CNG/config-plugin work), and maintaining two different
generators (BRouter on Android, something else on iOS) is disproportionate. Documented
for completeness; not aligned with an iOS-primary app.

*(Embedded GraphHopper on mobile, on-device Valhalla via Ferrostar, MapKit MKDirections,
and a bundled global network are omitted as live options — all feasibility-blocked per
the findings: dead iOS/Android ports, no loop generation + no RN bindings,
point-to-point network-only, and unshippable data size respectively.)*

## Comparison

| | A — Pure-JS on-device + Overpass | B — Hosted round-trip API | C — Android BRouter |
|---|---|---|---|
| Feasibility | `Feasible-with-caveats` (custom algo + Hermes spike) | `Feasible` (least code) | `Feasible` on Android only |
| Local-first | `Local, optional network` (fetch-then-offline) | `Requires network` per route | `Local` on Android; other engine on iOS |
| Battery / power | Low (short JS compute; one small fetch) | Network per generation | Low on Android |
| Platform reach | iOS + Android (one codebase) | iOS + Android | Android only (iOS needs a 2nd path) |
| Cost | None (keyless Overpass; OSM attribution) | Free tier only + **runtime key**; non-commercial caps | None on Android |
| Maintenance / tooling | Our algorithm; community JS libs (priced exception) | External metered API dependency | Community engine + dual-path upkeep |

## Feasibility assessment

**`Feasible-with-caveats`.** Route *display* is already solved (expo-maps polylines,
ADR 0010). Route *generation* has no first-party, on-device, cross-platform answer:
GraphHopper's mobile ports are abandoned, BRouter's round-trip is Android-only,
Valhalla/Ferrostar has no loop generation and no RN bindings, and MapKit is
point-to-point network-only. The buildable-on-our-stack path (Option A) is **pure-JS**
— cheapest under Continuous Native Generation (no native module) — but it requires (1)
a loop heuristic + OSM→graph + snapping layer we write and unit-test in `domain/`; (2)
a **de-risking spike** to confirm a pure-JS routing lib actually runs under Hermes
(the top unknown, with a real precedent for failure); (3) route-quality tuning
(target-distance accuracy, avoiding out-and-backs, footway preference). The heuristic
itself is testable pure TS, immune to library churn — the same shape ADR 0010 uses for
camera-fit math. Storage is additive (ADR 0004). It depends on Stage 3 + Stage 4
landing first.

## Local-first assessment

**`Local, optional network`.** The route computation runs on-device with no backend of
ours and no accounts — but the app cannot ship the planet's street network (bundling is
a dead end, exactly as with the elevation DEM), so it must fetch a small area's network
over the network the first time it's used. That fetch is **keyless** (Overpass, IP-based,
no account/key) and **cacheable**, so the feature degrades gracefully: online to fetch a
new area, then fully offline to generate and re-generate. It holds the `AGENTS.md` line
(no backend, no accounts, no analytics) and needs only an OSM attribution credit in-app.
Option B (**hosted API**) is strictly weaker on this axis — `Requires network` per route
*and* a runtime metered key — so it should only ever be a fallback, never the default.

## Recommendation

If/when this is built, adopt **Option A**: an on-device pure-JS loop heuristic over an
Overpass-fetched, per-area-cached pedestrian network, behind an ADR 0003 route-generator
port, rendered via the existing `RouteMap`/expo-maps polyline path. It's the only option
that keeps generation on-device, works on both platforms from one codebase, needs no
account and no runtime key, and sits at pure-JS (cheapest) native cost — at the price of
a custom algorithm and a mandatory Hermes-compatibility spike before committing. Keep a
hosted round-trip API (Option B) explicitly in reserve as an optional-network quality
booster only, priced as a standing exception if ever adopted.

Direct answer to "can it be done locally?": **the generation math, yes — fully on-device;
the street-network data, no — you fetch it once per area (keyless, cacheable) rather than
shipping it.** There is no zero-network-anywhere version, but there is a no-backend,
no-account, on-device-computation version.

> This is an assessment, not a decision to build. A build commitment belongs in an ADR
> (it would sit alongside ADR 0010 and behind an ADR 0003 port — next free number 0018).

## Open questions / next steps

- **Hermes spike (blocking):** confirm `geojson-path-finder` or `ngraph.path` actually
  runs under Hermes/RN on a ~2-3 km network extract, and measure generation time for a
  4 km loop with several candidates. This gates the whole recommendation.
- **Loop-quality algorithm:** choose the circle-sampling + edge-reuse-penalty scheme
  and the cost function (footway preference, road penalty) that best avoids ugly
  out-and-backs and hits the target distance within tolerance; decide how many
  candidates to offer (Garmin/GraphHopper both surface ~3).
- **Overpass usage & caching:** define the query (highway/footway filter, radius),
  the per-area cache key/TTL, the mandatory `User-Agent`, and offline behaviour when
  no cache exists; pick a fallback instance policy.
- **Engine & schema shape:** an open-ended free-run mode in the run engine (ADR 0007)
  and an additive schema change for a non-plan run + its `summary_polyline` (ADR 0004).
- **ADR:** if greenlit, record the route-generation decision as ADR 0018, with the
  generator behind an ADR 0003 port and OSM attribution obligations noted.
