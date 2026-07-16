# 10. Maps: expo-maps (alpha) with an iOS 18.0 floor, react-native-maps as pre-approved fallback

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0018](0018-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-11

## Status

Accepted

## Context

Maps arrive in Stage 4 (spec §13): the run summary and run detail render the
recorded route as segment-colored polylines with start/finish markers and a
camera fitted to the route, behind the `RouteMap` component port (ADR 0003,
ADR 0005). Choosing the map library carries the most user-visible
irreversibility in the app: expo-maps requires raising the iOS deployment
target to 18.0, which is a public, ratcheting change.

Research findings (verified 2026-07-11):

- **expo-maps in SDK 57 is alpha, and says so plainly:** the sdk-57 README
  opens with "Expo Maps is currently in alpha and subject to breaking
  changes" and "Requires a minimum deployment target of iOS 18.0."
- **Feature surface (v57 docs):** polylines with per-item `color`/`width`
  (plus `contourStyle`), markers and annotations, camera via a
  `cameraPosition` prop and `setCameraPosition()`. **No bounds/route-fitting
  camera API is documented** — fitting the camera to a route means computing
  center and zoom from the route's bounding box ourselves. No snapshot API.
- **What the iOS 18.0 floor excludes (mid-2026):** per Apple's official
  App-Store-transaction measurements, 79% of all iPhones ran iOS 26 by June
  2026 ([MacRumors](https://www.macrumors.com/2026/06/09/ios-26-adoption-stats-wwdc/),
  [9to5Mac](https://9to5mac.com/2026/06/10/ios-26-adoption-grows-but-still-lags-slightly-behind-ios-18/)),
  with most of the remainder on iOS 18 (82% of all iPhones ran iOS 18 a year
  earlier). iOS 18 runs on iPhone XS (2018) and later — the same hardware
  floor as iOS 17 — so the 18.0 floor excludes only the small non-updater
  tail (roughly ≤10% of active iPhones and shrinking), not any hardware an
  otherwise-supported user is stuck on.
- **The fallback is healthy:** react-native-maps 1.29.0 (updated June 2026)
  is actively maintained, has an iOS **15.1** floor, takes coordinate arrays
  with per-polyline stroke color/width like expo-maps, and additionally
  offers map snapshots. It is community-maintained — the de facto RN
  standard, but not first-party.
- Mapbox was already rejected in the spec (account/token/telemetry/metering
  against the no-backend ethos).

## Decision

**expo-maps (`AppleMaps.View`) renders routes behind the `RouteMap` port,
and the iOS deployment target moves to 18.0 — with react-native-maps
pre-approved as the fallback and explicit triggers for flipping.**

1. **Adoption mechanics (Stage 4):** `expo-build-properties` sets
   `ios.deploymentTarget: "18.0"`; expo-maps is version-pinned; the feature
   checklist (per-polyline color/width, markers, camera control) is
   re-verified against the installed package at install time, alpha being
   what it is.
2. **`RouteMap` owns the camera-fit math.** Since no bounds-fitting API
   exists, center/zoom derive from the route's bounding box (a pure helper
   in `domain/geo.ts`, unit-tested). Callers pass segments + points; the
   port surface stays library-agnostic — coordinate arrays and
   per-segment colors, nothing expo-maps-specific.
3. **Fallback triggers (pre-agreed, any one suffices):** an expo-maps
   breaking change blocks a stage; a needed capability is missing or broken
   on-device (camera fit proving inadequate, polyline rendering defects); or
   a v2 feature demands what only the fallback has (snapshots, sub-iOS-18
   support). Flipping = new adapter behind `RouteMap` + removing the 18.0
   floor; screens and data untouched.
4. **The community-dependency tension is acknowledged and priced:**
   react-native-maps as fallback is an explicit, standing exception to the
   official-tooling policy — accepted because the official option is alpha
   and the fallback is the ecosystem standard with a decade of production
   use.
5. **Android posture (later):** `GoogleMaps.View` requires a Google Maps API
   key (`android.config.googleMaps.apiKey`) — a build-time credential, not a
   runtime backend, so it does not violate the no-backend constraint; the
   Google Cloud account/key ceremony is deferred to the Android pass and
   noted as friction there.
6. **No snapshots in v1, by design:** History thumbnails stay out (already
   excluded by ADR 0005's no-RN-per-SwiftUI-row rule); `summary_polyline`
   (ADR 0004 schema) keeps every thumbnail option open for v2 — SVG
   sparklines, fallback-map snapshots, or expo-maps once it grows the API.

## Consequences

- The app renders native Apple Maps inside SwiftUI-native screens —
  consistent with the system-UI bet (ADR 0005) at zero account/token cost,
  which no third-party map matches.
- The iOS 18.0 floor is a real but small and shrinking exclusion (non-updater
  tail only; no hardware left behind vs iOS 17), and it is reversible: the
  floor exists *because of* expo-maps, so flipping to the fallback also
  restores iOS 15.1+.
- Alpha churn is contained the same way every platform risk in this app is:
  a pinned version, a port boundary, a pre-agreed fallback with explicit
  triggers — the decision to flip requires no new debate.
- Camera-fit correctness is our code, not the library's: testable math in
  `domain/`, immune to library churn on either side of the port.
- Waiting for the fallback to be needed costs nothing now; adopting it
  preemptively would cost the official-path benefits (SwiftUI rendering,
  no key ceremony on iOS) on speculation.

## Alternatives considered

- **react-native-maps as primary** — mature, iOS 15.1+, snapshots. Rejected
  as primary: community dependency against the tooling policy while an
  official option exists and suffices for v1's read-only route display; its
  extra reach is exactly what the fallback slot preserves.
- **MapLibre (or other OSS map SDKs)** — rejected: community dependency
  *plus* a tile-source decision (hosted tiles = accounts/keys; self-hosted =
  a backend), losing on both policy axes.
- **Static route images (MKMapSnapshotter)** — rejected: no official Expo
  wrapper, so it needs custom native code against CNG; also loses pan/zoom
  interactivity on the detail screen.
- **Mapbox** — rejected in the spec: account, token, telemetry, and
  usage-metering conflict with the no-backend/no-accounts ethos.
- **Defer maps beyond v1** — rejected: the route map is Stage 4's entire
  user-visible value and a core paid-app-parity feature; deferral would
  also leave `summary_polyline` and `run_points` write-only data.
