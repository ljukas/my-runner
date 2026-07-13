# Run elevation on the map — research

Date: 2026-07-13
Status: **research / options under consideration** — not a decision to build.

**Question:** When we map a run from GPS (Stage 4, [ADR 0010](../../adr/0010-maps-expo-maps-ios18-floor.md)),
can we also capture elevation — from the device or from the map — and if not, is
there a free source, ideally without leaving the device?

## TL;DR

- **Feasibility:** `Feasible` on iOS, `Feasible-with-caveats` on Android — elevation
  can be captured with first-party Expo modules and no custom native code. The
  runner-meaningful metric (**elevation gain/loss**) comes from the on-device
  barometric altimeter; GPS altitude is a noisy fallback.
- **Local-first fit:** `Fully local` for the recommended path — the barometer and
  GPS run entirely on-device, no network, no accounts. A network elevation API is
  possible only as an optional, non-default enrichment (`Local, optional network`).
- **Recommended approach:** **Option A** — barometer-first elevation gain/loss
  on-device (iOS `relativeAltitude`), with a smoothed GPS-altitude fallback for
  the many Android phones without a barometer. Getting elevation "from the map"
  and bundling a global offline DEM are both **dead ends** (see below). This is an
  assessment, not a commitment to build.

## Context

The route map arrives in Stage 4 (ADR 0010): the run summary/detail render the
GPS route as segment-colored polylines. "Elevation" is the natural companion —
but the number a Couch-to-5K runner cares about is **elevation gain/loss over the
run**, not the absolute height of any point. That distinction decides the whole
question: a *relative* delta is available cheaply on-device; *absolute* elevation
is not.

Subsystems / decisions touched:

- **[ADR 0010](../../adr/0010-maps-expo-maps-ios18-floor.md) (maps)** — elevation is
  Stage-4-adjacent and depends on GPS capture landing first.
- **[ADR 0004](../../adr/0004-local-storage-expo-sqlite-drizzle.md) (schema)** —
  today `runs` has only a `summary_polyline` text placeholder; there is **no
  `run_points` table and no altitude/elevation column** (`src/db/schema.ts`). So
  storing elevation is purely *additive* — no migration risk to existing data.
- **[ADR 0003](../../adr/0003-platform-ports-and-adapters.md) (ports)** — an
  elevation source belongs behind a port, like `RouteMap`.
- **[ADR 0008](../../adr/0008-background-execution-location-heartbeat.md)
  (background heartbeat)** — a run tracks in the background via a location
  heartbeat; whether the barometer keeps updating there is an open question (below).
- **`AGENTS.md` constraints** — no backend, no accounts, no analytics; on-device
  data with iCloud as the only sync; iOS-primary, Android-secondary.

## Findings

### On-device sensors are available and first-party

- **`expo-location` exposes GPS altitude.** `LocationObjectCoords.altitude` =
  "The altitude in meters above the WGS 84 reference ellipsoid"; `altitudeAccuracy`
  = "The accuracy of the altitude value, in meters"; `Accuracy.BestForNavigation`
  requests the highest accuracy using extra sensor data. ([Expo v57 Location docs](https://docs.expo.dev/versions/v57.0.0/sdk/location/), verified 2026-07-13.)
  - *Datum nuance:* the doc says "ellipsoid", but on iOS the underlying
    `CLLocation.altitude` is an **orthometric height above mean sea level**, while
    `ellipsoidalAltitude` is the WGS84 ellipsoid value ([Apple: CLLocation.altitude](https://developer.apple.com/documentation/corelocation/cllocation/altitude) / [ellipsoidalAltitude](https://developer.apple.com/documentation/corelocation/cllocation/ellipsoidalaltitude), 2026-07-13). This gap (tens of metres) only matters for *absolute cross-device* comparisons — it cancels out of a per-run gain delta. iOS also marks altitude invalid when `verticalAccuracy` ≤ 0 ([Apple: verticalAccuracy](https://developer.apple.com/documentation/corelocation/cllocation/verticalaccuracy), 2026-07-13).
- **`expo-sensors` Barometer exposes relative altitude.** `BarometerMeasurement` =
  `{ pressure /* hPa, both platforms */, relativeAltitude?: /* metres, iOS-only */, timestamp }`;
  `isAvailableAsync()` gates use (iOS 8+/Android 2.3+). On iOS it wraps Apple's
  `CMAltimeter.startRelativeAltitudeUpdates`; on Android it returns raw pressure
  only (you convert to altitude yourself). ([Expo v57 Barometer docs](https://docs.expo.dev/versions/v57.0.0/sdk/barometer/) + `packages/expo-sensors/src/Barometer.ts`, verified 2026-07-13.)

### The barometer beats GPS for elevation gain — but only iPhones reliably have one

- **GPS vertical error is ~2× horizontal** (satellite geometry): smartphone
  horizontal accuracy is commonly 7–13 m, implying vertical ~15–26 m or worse
  ([smartphone GPS urban study, 2019](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6638960/); [gpsinformation.net/altitude](http://gpsinformation.net/main/altitude.htm)). Summing the positive
  deltas of that noisy signal **systematically inflates** cumulative gain, whereas
  a barometer is "very precise for measuring elevation changes" though it "drifts
  in absolute terms with weather" ([Garmin engineering FAQ](https://support.garmin.com/en-US/?faq=WlvNrOungC28xGtwB7hLY5), 2026-07-13). ~1 hPa ≈ 8.4 m, giving ~1 m
  resolution for *changes*.
- **Barometer hardware:** the **iPhone 6 (2014) was the first iPhone with a
  barometer; every iPhone since has one** ([Apple M8](https://en.wikipedia.org/wiki/Apple_M8); [9to5Mac, 2014](https://9to5mac.com/2014/06/18/iphone-6-likely-to-sport-barometer-air-pressure-sensors-to-measure-altitude-weather/)). On **Android**, barometers are relatively rare and
  skew to flagships — Android's own docs note "fewer devices have barometers"
  ([Android sensors overview](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview), 2026-07-13); a commonly-cited "~5%" figure is *unverified* (secondary
  sources only). So Android **must** feature-detect and fall back to GPS.

### You cannot get elevation "from the map"

- **No map SDK exposes per-coordinate terrain elevation.** MapKit's
  `MapStyle.Elevation` is a *rendering* enum (flat vs. 3D), and `MKMapCamera.altitude`
  is the camera height, not ground elevation ([Apple: MapStyle.Elevation](https://developer.apple.com/documentation/mapkit/mapstyle/elevation); [Apple forums](https://developer.apple.com/forums/thread/8446), 2026-07-13). **expo-maps** (SDK 57, alpha)
  only exposes elevation as a visual style (`FLAT`/`REALISTIC`/`AUTOMATIC`, Google
  `TERRAIN`) ([Expo v57 Maps docs](https://docs.expo.dev/versions/v57.0.0/sdk/maps/), 2026-07-13). Google's client Maps SDK has **no**
  elevation API; elevation is a separate paid web service ([Google Elevation API](https://developers.google.com/maps/documentation/elevation/overview), 2026-07-13).

### Free elevation *web* APIs exist, but none is both keyless and production-reliable

- **Open-Meteo Elevation** — keyless for non-commercial use, global Copernicus
  GLO-90 (90 m), generous limits (10k/day) but **mandatory CC-BY attribution** and
  an explicit **"no uptime guarantee"** ([docs](https://open-meteo.com/en/docs/elevation-api) / [terms](https://open-meteo.com/en/terms), 2026-07-13). Best keyless option.
- **OpenTopoData** — keyless, global, multi-dataset, but the public host caps at
  **1,000 calls/day, 1/sec**, single-maintainer, no SLA ([opentopodata.org](https://www.opentopodata.org/), 2026-07-13). Fallback only.
- **USGS EPQS/3DEP** — keyless and most accurate, but **US-only** ([USGS FAQ](https://www.usgs.gov/faqs/how-accurate-are-elevations-generated-elevation-point-query-service-national-map), 2026-07-13). Disqualified for a global app.
- **Open-Elevation** — now metered (≤1,000/mo) and chronically unreliable (5xx/timeout outage history) ([issues](https://github.com/Jorl17/open-elevation/issues), 2026-07-13). Avoid.
- **Google / Mapbox** — capable and reliable but require account + API key +
  billing/metering ([Google billing](https://developers.google.com/maps/documentation/elevation/usage-and-billing); [Mapbox pricing](https://www.mapbox.com/pricing), 2026-07-13). **Flatly conflict with the no-account/no-key ethos.**

### Bundling or offline-caching a DEM is not realistic

- **Smallest usable global 30 m DEM ≈ 73 GB** (SRTM), ASTER ≈ 151 GB, Copernicus
  GLO-30 est. ~0.3–0.5 TB; even **90 m SRTM ≈ 12 GB**; the full terrarium tileset
  is **51.5 TB** ([Open Topo Data dataset sizes](https://www.opentopodata.org/notes/dataset-sizes/); [Mapzen Terrain Tiles v1.1](https://www.mapzen.com/blog/terrain-tiles-v1.1/), 2026-07-13). Two-to-four orders of magnitude beyond a
  shippable app. **Bundling: dead end.**
- **Per-area caching** (terrain-RGB PNG tiles, a few MB per city) is
  storage-feasible **but requires a network fetch for each new area** (from AWS
  `elevation-tiles-prod` / Mapbox) and there is **no RN/Expo DEM-reader library** —
  `geotiff.js` breaks on RN's missing Node stdlib ([issue #411](https://github.com/geotiffjs/geotiff.js/issues/411)), and `@watergis/terrain-rgb` needs a DOM `<canvas>` RN lacks. So it is
  "online-with-cache", not offline, and you'd hand-roll the reader.

## Options

### Option A — On-device barometer + GPS-altitude fallback (elevation gain/loss)  ✅ recommended
Capture elevation **gain/loss** during the run entirely on-device. iOS: subscribe
to `Barometer.relativeAltitude` (turnkey cumulative delta via `CMAltimeter`).
Android / any phone where `Barometer.isAvailableAsync()` is false: derive gain from
smoothed GPS `altitude` (never raw per-sample summing). Store a gain/loss summary
(additive schema). No absolute elevation, no network, no accounts.
*Trade-off:* relative-only (no elevation-vs-distance profile against sea level);
Android quality varies with hardware.

### Option B — Option A + optional online DEM enrichment
Everything in A, plus an **explicitly opt-in, non-default** call to Open-Meteo
(keyless, non-commercial) — or OpenTopoData as fallback — to fetch an absolute
elevation profile and/or de-drift the barometer, cached per area. Degrades
gracefully to A when offline.
*Trade-off:* introduces a network dependency (optional) and a third-party
attribution obligation; must never be on the offline path.

### Option C — Online DEM API as the elevation source
Skip sensors; derive elevation purely from a web elevation API keyed off the GPS
track. This is what many cloud-backed run apps do.
*Trade-off:* **breaks the local-first default** — every run needs connectivity;
the reliable providers need accounts/keys/billing; the keyless ones carry "no
uptime guarantee". Documented for contrast; not aligned with this app.

*(Bundled/offline global DEM and "elevation from the map" are omitted as live
options — both are feasibility-blocked per the findings.)*

## Comparison

| | A — Barometer + GPS fallback | B — A + optional online DEM | C — Online DEM only |
|---|---|---|---|
| Feasibility | `Feasible` (iOS) / caveats (Android) | `Feasible` + integration work | `Feasible` |
| Local-first | **`Fully local`** | `Local, optional network` | `Requires network` |
| Battery / power | Low — barometer is a low-power sensor; GPS already active during a run | Low + occasional network | Network per run |
| Platform reach | iOS strong; Android needs GPS fallback | Same, + evens out Android via DEM | Uniform, but online |
| Cost | None | None (Open-Meteo non-commercial) | Free tier only / paid + keys |
| Maintenance / tooling | First-party Expo modules only | + attribution + cache logic | + external-API dependency |

## Feasibility assessment

**`Feasible` (iOS), `Feasible-with-caveats` (Android).** The recommended path uses
only first-party Expo modules already compatible with the stack (`expo-location`,
`expo-sensors`) — no custom native code, no new alpha dependency, no official-tooling
exception. Storage is additive (an `elevation_gain_m`/`elevation_loss_m` summary on
`runs`, and/or an `altitude`/`pressure` column on the future `run_points` table).
Caveats: (1) it depends on **Stage 4 GPS capture** landing first; (2) Android needs
a feature-detect + GPS-altitude fallback with smoothing to avoid noise-inflated
gain; (3) the barometer's **background behavior** under the ADR 0008 heartbeat is
unverified (the expo-sensors iOS module stops updates on background per its source —
needs an on-device test).

## Local-first assessment

**`Fully local` for Option A** — the barometer and GPS are on-device sensors; no
network, no accounts, no third party is involved, so it fits `AGENTS.md` exactly.
Option B is **`Local, optional network`**: the enrichment is opt-in and degrades to
A offline, but it does introduce an external service and a CC-BY attribution
obligation, so it must never sit on the default/offline path. Option C **requires
network** and (for the reliable providers) accounts — it violates the default.
Notably, the only *fully-local absolute-elevation* route (a bundled DEM) is
feasibility-blocked, so the feasible-and-local intersection is precisely Option A.

## Recommendation

Adopt **Option A** if/when elevation is built: barometer-first elevation gain/loss
on-device, feature-detected, with a smoothed GPS-altitude fallback — it delivers the
metric runners actually want, stays fully local-first, and needs only first-party
modules. Consider layering **Option B** later, behind an explicit opt-in, only if
users ask for absolute elevation profiles. Do **not** pursue "from the map",
bundled DEM, or an online-only DEM source.

> This is an assessment, not a decision to build. A build commitment belongs in an
> ADR (it would sit alongside ADR 0010 and behind an ADR 0003 port).

## Open questions / next steps

- **Barometer in the background:** verify on-device whether `Barometer` keeps
  delivering `relativeAltitude` during a locked-phone run under the ADR 0008
  location heartbeat, or whether gain must be reconstructed differently.
- **Android fallback quality:** choose a GPS-altitude smoothing/threshold algorithm
  that resists noise-inflated cumulative gain.
- **Schema shape:** decide between a per-run gain/loss summary vs. per-point altitude
  storage (or both) when the `run_points` table is designed in Stage 4.
- **ADR:** if greenlit, record the elevation-source decision as an ADR (next number
  after the current highest), with the source behind an ADR 0003 port.
