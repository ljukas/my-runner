# 10. Maps: expo-maps (alpha) with an iOS 17.0 floor, react-native-maps as pre-approved fallback

> **Android: stage 4 (maps)** — Android ships in stages ([ADR 0025](0025-android-staged-migration.md)); the Android provisions below belong to stage 4 (maps): the `GoogleMaps.View` adapter. Check ADR 0025's stage table for whether they have shipped.

Date: 2026-07-11

## Status

Accepted, **amended 2026-07-29** on implementation — see
[Amendment (2026-07-29)](#amendment-2026-07-29). The shipped floor is **17.0**
via app.json's built-in `ios.deploymentTarget`, not 18.0 via
`expo-build-properties`. The title, Decision and Consequences are corrected in
place; the filename keeps `ios18-floor` because ADR filenames are permanent
links. Research findings under Context are left as the dated 2026-07-11 record
of what was believed then, and the amendment says where they were wrong.

## Context

Maps arrive in Stage 4 (spec §13): the run summary and run detail render the
recorded route as segment-colored polylines with start/finish markers and a
camera fitted to the route, behind the `RouteMap` component port (ADR 0003,
ADR 0005). Choosing the map library carries the most user-visible
irreversibility in the app: expo-maps requires raising the iOS deployment
target to 18.0, which is a public, ratcheting change. (**That premise was
false** — the requirement is 17.0, and only the README claimed 18.0; see the
amendment.)

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
and the iOS deployment target moves to 17.0 — with react-native-maps
pre-approved as the fallback and explicit triggers for flipping.**

1. **Adoption mechanics (Stage 4):** app.json's **built-in**
   `ios.deploymentTarget` sets `"17.0"` — **not** `expo-build-properties`,
   whose equivalent option has been deprecated for this purpose since SDK 56;
   expo-maps is version-pinned; the feature checklist (per-polyline
   color/width, markers, camera control) is re-verified against the installed
   package at install time, alpha being what it is.
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
- The iOS 17.0 floor **does** leave hardware behind, which the original 18.0
  framing obscured: the app's effective floor was 16.4 (nothing being set), and
  16.4 still runs on iPhone 8/8 Plus/X. 17.0 and 18.0 drop that 2017 cohort
  alike, so the real cost is those devices, not the non-updater software tail
  the adoption statistics above measure. It stays reversible — the floor exists
  *because of* expo-maps, so flipping to the fallback restores iOS 15.1+.
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

## Amendment (2026-07-29)

Written on implementing Stage 4. Sources are the design spec
[2026-07-28-stage-4-maps-design.md](../superpowers/specs/2026-07-28-stage-4-maps-design.md)
§3, §4.2, §4.3, §9 and §13, all re-derived from expo-maps' own source by
independent reviewers.

1. **The floor is 17.0, set through app.json's built-in `ios.deploymentTarget`.**
   Not 18.0, and not via `expo-build-properties` — that package's option has
   been deprecated for this purpose since SDK 56 ("use built-in
   `ios.deploymentTarget` property instead") and would add a dependency plus
   four unrelated `Podfile.properties.json` side effects. The built-in property
   rewrites the **app target's** `IPHONEOS_DEPLOYMENT_TARGET` and leaves Pods at
   16.4, as every SDK 57 app does; the app target is what gates App Store
   installs via `MinimumOSVersion`. Confirmed in the built binary's Info.plist.
   Note the failure mode: `expo run:ios` reuses an existing `ios/`, so this
   field does nothing until `bun run prebuild:dev` runs.

2. **The 18.0 requirement was a README error, contradicted four ways.**
   expo-maps' own podspec is at 16.4 (its release XCFramework declares
   `minos 16.0`); its iOS-17 renderer is *complete*, not a stub — same
   `MapPolyline`/`.stroke`, markers, annotations, `mapControls` and camera code,
   including `emphasis: MUTED`; `isMapsAvailable` reports true from 17.0; and the
   SDK 57 docs page states no deployment target at all, version-annotating only
   the click handlers (18.0+) and `monogram` (17.0+). iOS 18 gates only click
   events and programmatic selection, neither of which a read-only map uses.
   Below 17 the package renders `EmptyView()` — blank, no crash — which is why
   17.0 is the minimum at which a map renders at all.

3. **The real trade was never 17-vs-18 — it was whether to drop 2017 iPhones,**
   and the original ADR missed that framing entirely. The app's effective floor
   was 16.4 because nothing was set, and 16.4 still supports iPhone 8/8 Plus/X;
   **both** 17.0 and 18.0 drop that hardware. The adoption statistics under
   Context measure the iOS-18-vs-17 software tail, not this hardware cohort, so
   they do not support the decision they were cited for.

   **Counter-argument, recorded rather than buried (spec §13).** One reviewer
   argued for keeping 16.4 and gating the map at runtime via `Platform.Version`:
   under a 17.0 floor those owners lose *the whole app* — coach, cues, timer,
   distance, splits — whereas under 16.4 plus a gate they lose *one card*. For a
   free C25K app aimed at beginners on older hardware, whose value is the
   coaching rather than the cartography, that trade plausibly points the other
   way. The reviewer also showed the "dead code" argument for the floor is
   circular: the runtime check is only dead *because* the floor was raised. The
   floor stands, chosen deliberately so everyone who can install gets the same
   experience rather than a silently blank map — but it is a judgement call with
   a live objection, not a settled fact, and reversing it costs one gate.

4. **The camera fit is our exact minimum-span formula, and it is load-bearing.**
   expo-maps requests an *isotropic degree span* while Mercator stretches
   latitude by `f = 1 / cos(centerLat)` (exactly `dy/dφ`); MapKit then fits that
   region to the view, only ever *expanding* it. With `A` the viewport aspect
   ratio, `S = max(lngSpanDeg / max(1, A·f), latSpanDeg·f / max(1/A, f))` and
   `zoom = log2(360 / (S · (1 + 2·padding)))`. Brute-force validated against an
   exact Mercator/aspect-expand simulation over 40 000 random `(A, lat, bbox)`
   triples: `formulaS / trueMinimalS ∈ [0.99962, 1.0000029]`. It rests on
   expo-maps' own degree→region conversion, so **re-verify it against
   `MapUtils.swift` on every expo-maps bump** — an upstream change there silently
   breaks every camera in the app. Antimeridian- and pole-naive by inheritance,
   which is outside the C25K footprint.

5. **Polyline `id` is a correctness requirement, not a nicety.**
   `ExpoAppleMapPolyline` is `Identifiable` with `id` defaulting to
   `UUID().uuidString`, rendered through `ForEach`. Omit it and every prop update
   mints fresh identities, so SwiftUI tears down and rebuilds all overlays. The
   port's `RouteMapLine.id` therefore has to be deterministic.

6. **The missing interaction lock is a wrapper gap, not a platform limitation.**
   The original ADR assumed Apple offered no interaction lock. It does:
   `MapInteractionModes` has existed since iOS 14 and sits in the very
   initializer expo-maps calls
   (`init<C>(position:bounds:interactionModes:scope:content:)`), but expo-maps
   never passes it. So the inert preview is achieved RN-side with
   `pointerEvents="none"`, and a one-argument upstream fix or patch would remove
   the need for that workaround. (`scrollGesturesEnabled` and friends genuinely
   are Google-only.) Worth revisiting on each bump.

7. **Paint order is array order, and nothing else.** The content builder runs
   markers → polylines → polygons → circles → annotations, and there is no
   z-index in the Apple path or anywhere in `_MapKit_SwiftUI` — so position
   within the array is the only lever. Device-verified on the 17.5 runtime that
   a later array entry does paint above an earlier one. Apple documents nothing
   here for SwiftUI, so any future overlay must re-check it; the design spec
   retains a **polygons fallback** as the contingency if it ever stops holding,
   even though its only consumer (direction chevrons) was removed from the
   product. Also note `compassEnabled`, `myLocationButtonEnabled`,
   `togglePitchEnabled` and `properties.selectionEnabled` all default to **true**,
   and POIs default to all-shown — a read-only map must suppress each explicitly.

8. **Reverted — Decision item 2 stands: the port takes the bbox, the adapter fits
   the camera.** This item previously recorded a narrow deviation in which
   `useRunRoute` computed `cameraForBoundingBox` over the drawn chunks and passed
   a ready `camera` to `RouteMap`, which only latched it. Its justification — "the
   port surface stays library-agnostic" — did not survive review: `CameraFit.zoom`
   *is* expo-maps' own convention (the library shows `360 / 2^zoom` degrees on
   **both** axes, and the fit bakes in that isotropic-degree plus `f = 1/cos(lat)`
   Mercator quirk), so every caller of the port had to speak it, and the
   react-native-maps fallback item 3 pre-approves would have had to invert it. The
   port now carries `bbox` in plain degrees plus the viewport `aspectRatio`, and
   `adapter.ios.tsx` calls the fit.

   The reuse concern that motivated the deviation is still honoured, because what
   crosses the port is the **already-reduced bbox**, not the route lines: the hook
   still decides which chunks are drawn and reduces them exactly once, so the
   adapter cannot disagree with the route-extent gate about the route's extent — it
   only converts a bbox and an aspect ratio into this library's zoom. The freeze is
   also unchanged and now reads as the contract it always was: the Swift host snaps
   to any later `cameraPosition`, so the adapter takes the fit once in `useState`'s
   initializer, and a re-fit would yank a view the user has panned. The math
   remains a pure, unit-tested helper in `domain/geo.ts`.

## Amendment (2026-09-21): Android realised — `GoogleMaps.View` behind the same port

Written on building Android stage 4 (ADR 0025). The port (`port.ts`), the iOS
adapter, the hooks and both route files are untouched; the Android adapter is
`route-map/adapter.android.tsx`, and the stage-1 `route-map-card.android.tsx`
stub is gone. What Android added to the record:

1. **Google's zoom is pixel-based, so the adapter measures itself.** Google's
   `CameraPosition.fromLatLngZoom` shows a world `256 · 2^zoom` dp wide,
   Web-Mercator on latitude — the fit depends on the view's *size in dp*, not
   only its aspect ratio, so `cameraForBoundingBox` (isotropic degrees, Apple's
   convention, item 4) cannot be reused. Amendment item 8's decision stands: the
   port still carries `bbox` + `aspectRatio` and no library convention crosses it.
   The Android adapter reads its own first non-zero `onLayout`, fits with the new
   pure helper `googleCameraForBoundingBox(bbox, { widthDp, heightDp })`
   (`domain/geo.ts`, unit-tested: binding axis fills exactly `1/(1+2p)` of the
   view, clamped to Google's 3–21), and mounts `GoogleMaps.View` only *after* that
   layout so its first `cameraPosition` is already the fit. The fit is frozen like
   iOS's: `GoogleMapsView.kt` rebuilds its `CameraPositionState` on every
   `cameraPosition` change, so a re-fit would yank a panned view.
2. **Polyline `width` is in pixels** (handed straight to Compose's `Polyline`),
   so `ROUTE_STROKE_W`/`ROUTE_STROKE_W_RUN` are multiplied by `PixelRatio.get()`;
   without it the run/walk width channel (spec §7.3) is ~3× too thin. Polyline `id`
   defaults to a fresh UUID on Android too (`Records.kt`), so the port's
   deterministic id is passed through (item 5 holds on both platforms).
3. **Endpoints are `circles`, not markers.** `GoogleMapsMarker` cannot be tinted
   or given a symbol; a custom icon needs an `expo-image` `SharedRef`, a native
   dependency on *both* platforms that would move the iOS fingerprint. Start and
   finish are filled circles in `colors.primary` / `colors.success` with a
   `colors.background` ring, radius `endpointRadiusM(bbox)` (1.5 % of the bbox
   diagonal, floored at 4 m so a route at the extent gate still shows a dot),
   merged below `ENDPOINT_MERGE_M` as on iOS. Circles are composed after polylines
   in expo-maps' content. Custom `figure.run`/`flag.checkered` icons are the
   deferred follow-up, to bundle with another native bump.
4. **The interaction lock is real on Google** (`scrollGesturesEnabled`,
   `zoomGesturesEnabled`, `rotationGesturesEnabled`, `tiltGesturesEnabled`,
   `scrollGesturesEnabledDuringRotateOrZoom: false`) — item 6's Google aside
   confirmed. The RN `Pressable` + `pointerEvents="none"` wrapper is kept anyway
   for the press and the a11y role. Default-on controls that a read-only map must
   suppress on Google: `zoomControlsEnabled`, `mapToolbarEnabled`,
   `compassEnabled`, `myLocationButtonEnabled`, `indoorLevelPickerEnabled`,
   `scaleBarEnabled`, `properties.selectionEnabled`, plus `isBuildingEnabled`
   (3D blocks over the route at street zoom). `colorScheme: FOLLOW_SYSTEM`,
   `mapType: NORMAL`; Google has no equivalent of Apple's `MUTED` emphasis — a
   POI-hiding `mapStyleOptions` JSON is a later nicety.
5. **The key (item 5) is baked by Expo's prebuild core, not by expo-maps**, from
   `android.config.googleMaps.apiKey` into a `<meta-data
   android:name="com.google.android.geo.API_KEY">` (plus `org.apache.http.legacy`).
   `app.config.ts` reads `GOOGLE_MAPS_ANDROID_API_KEY` from the environment
   (gitignored `.env.local` locally; an EAS environment variable in stage 7) and
   falls back to `MISSING_GOOGLE_MAPS_ANDROID_API_KEY`, because **no meta-data at
   all crashes the app** — `MapView.onCreate` throws `IllegalStateException: API
   key not found` the first time a route renders (measured) — while an *invalid*
   key only logs `Authorization failure` and paints nothing. The field would have
   moved the iOS fingerprint; ADR 0012's amendment of the same date has the strip.
   A bare `android.*` field change needs `bun run prebuild:dev:android` and a
   Gradle rebuild before anything changes on the emulator. **Key restriction:**
   the dev build is signed with the debug keystore Expo prebuild writes to
   `android/app/debug.keystore` — the classic React Native one, SHA-1
   `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` as the Maps SDK
   itself reports in logcat — **not** `~/.android/debug.keystore`'s
   fingerprint that the stage plan quoted.
6. **What an unauthorised map looks like, so nobody debugs the adapter for it.**
   maps-compose 6.10 composes its `AndroidView(MapView)` only once its
   `GoogleMapsInitializer` reports success (a few hundred ms after the first
   map mounts; the fixed camera means no visible snap). The first `MapView` of the
   process is created — Google's logo draws, the renderer logs `Model is not
   recognized` — then `Authorization failure` arrives and the SDK shuts its
   renderer down (`Shutting down renderer while it's not idle - phase is
   INVALID`); every later `MapView` in that process is withheld (an empty
   `AndroidViewsHandler` in `dumpsys activity top`). No tiles, no overlays, no
   logo, no crash. Verified on the emulator with the placeholder key: the card
   mounts at 3:2 with "Map of your 0.67 km route", the viewer mounts full-bleed
   with "Your 0.67 km route", back returns to the summary, and the treadmill /
   no-location / under-gate degradations (spec §8) all show the right card.
   **Still to verify with a real key:** polyline colours and run/walk widths at
   card zoom, circle paint order above the lines, `FOLLOW_SYSTEM` dark tiles,
   first-paint time of the card.
