# Android Stage 4 — Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **handoff**: stage 3 is built on `ll/android-stage-3` (PR #65, stacked on #63 → #62 → #61); branch this stage as `ll/android-stage-4` on top of it. Read [ADR 0025](../../adr/0025-android-staged-migration.md) (stage table + both 2026-09-21 amendments), [ADR 0010](../../adr/0010-maps-expo-maps-ios18-floor.md) **including its 2026-07-29 amendment** (items 4, 5, 7 and 8 are the contract this adapter must honour), the iOS maps spec [`2026-07-28-stage-4-maps-design.md`](../specs/2026-07-28-stage-4-maps-design.md) §3, §4.2, §7.2–7.5 and §8, the [stage 3 plan](2026-09-21-android-stage-3-spoken-cues.md)'s "As built" section (emulator traps) and the `android-stage-3` memory first.

**Goal:** An Android run summary shows the recorded route the way iOS does — segment-coloured polylines with run/walk stroke widths, start/finish endpoints, a camera framed around the route, inert in the card and pannable/zoomable in the full-screen viewer — with the treadmill-run degradation intact, a Maps API key that never enters git, and **iOS unchanged, including its fingerprint**.

**Architecture:** Replace the stage-1 stub `src/components/route-map/adapter.android.tsx` with a `GoogleMaps.View` adapter behind the unchanged `RouteMap` port (`port.ts`), and delete the null-rendering `route-map-card.android.tsx` stub so the shared `RouteMapCard` and the shared viewer route render on Android. The only new domain code is a Google-convention camera fit (Google zoom is pixel-based, so the Apple fit in `cameraForBoundingBox` cannot be reused — see Verified facts). The key arrives through `app.config.ts` from an environment variable and is stripped from the fingerprint's `expoConfig` source by a hook, because the whole normalised Expo config is a fingerprint source on **both** platforms. Governing ADRs: 0003, 0010, 0012 (the hook is an amendment), 0013, 0019, 0021, 0025.

**Tech Stack:** Expo SDK 57 · `expo-maps` 57.0.1 (`GoogleMaps.View`, Compose `maps-compose` underneath; already installed and autolinked on Android since stage 1) · Google Maps SDK for Android key · `@expo/fingerprint` `fileHookTransform` · argent 0.25.2 on `emulator-5554` (Pixel 9 Pro API 36, Play services 26.33.32 present — Google Maps renders on it) · Metro on 8087

**Spec:** ADR 0025 row 4 ("`GoogleMaps.View` behind the `RouteMap` port; needs a build-time Maps API key (`android.config.googleMaps.apiKey`, ADR 0010). Route card and viewer return to the summary. Plugs in at `route-map/adapter.android.tsx`; delete the `route-map-card.android.tsx` stub.") plus the iOS spec sections above, which define the behaviour Android must match.

## Verified facts (2026-09-21, in source — do not re-derive, do re-check on an expo-maps bump)

- **Component surface** (`node_modules/expo-maps/src/google/GoogleMaps.types.ts`, `GoogleMapsView.tsx`): `GoogleMaps.View` takes `cameraPosition: { coordinates: { latitude, longitude }, zoom }`, `polylines: { id?, coordinates, color, width, geodesic? }[]`, `markers: { id?, coordinates, title?, snippet?, icon?: SharedRefType<'image'>, anchor?, zIndex?, showCallout?, draggable? }[]`, `circles: { id?, center, radius (m), color?, lineColor?, lineWidth? }[]`, `polygons`, `uiSettings` (`compassEnabled`, `indoorLevelPickerEnabled`, `mapToolbarEnabled`, `myLocationButtonEnabled`, `rotationGesturesEnabled`, `scrollGesturesEnabled`, `scrollGesturesEnabledDuringRotateOrZoom`, `tiltGesturesEnabled`, `zoomControlsEnabled`, `zoomGesturesEnabled`, `scaleBarEnabled`, `togglePitchEnabled`), `properties` (`isBuildingEnabled`, `isIndoorEnabled`, `isMyLocationEnabled`, `isTrafficEnabled`, `mapType: GoogleMapsMapType.NORMAL|HYBRID|SATELLITE|TERRAIN`, `selectionEnabled`, `minZoomPreference` (default 3), `maxZoomPreference` (default 21), `mapStyleOptions: { json }`), `colorScheme: GoogleMapsColorScheme.LIGHT|DARK|FOLLOW_SYSTEM`, `contentPadding`, `onMapLoaded`, `onCameraMove`, and a ref with `setCameraPosition` (animates). Polyline/circle colours go through `processColor`, so the port's hex strings work as-is. The component returns `null` off Android, so it is safe in an `.android.tsx` file only.
- **Camera snaps on every prop change, exactly like iOS** — `GoogleMapsView.kt:updateCameraState` does `remember(cameraPosition) { CameraPositionState(CameraPosition.fromLatLngZoom(...)) }`, so a new `cameraPosition` object yanks a panned view. Take the fit once in `useState`'s initializer (ADR 0010 amendment item 8), as `adapter.ios.tsx` does. Default zoom when none is given is 10 (`Records.kt:133`).
- **Google zoom is not Apple zoom.** `CameraPosition.fromLatLngZoom(latLng, zoom)` uses Google's Web-Mercator zoom: at zoom `z` the world is `256 · 2^z` dp wide. The fit therefore depends on the view's **size in dp**, not only its aspect ratio — and the port carries only `aspectRatio` (ADR 0010 amendment item 8, deliberately). `cameraForBoundingBox` bakes in expo-maps' Apple convention (isotropic degrees, `f = 1/cos(lat)` on latitude) and must **not** be reused. Decision below: the Android adapter measures itself with `onLayout` and fits with a new pure helper; the port stays untouched.
- **Polyline `id` defaults to a fresh UUID** (`Records.kt:94` `PolylineRecord.id = UUID.randomUUID()`), the same identity trap as iOS (ADR 0010 amendment item 5). The port's `RouteMapLine.id` is deterministic — pass it through.
- **Polyline `width` is in screen pixels**, passed straight to Compose's `Polyline(width = …)` (`GoogleMapsView.kt:162`); iOS points ≈ dp. Multiply `ROUTE_STROKE_W` / `ROUTE_STROKE_W_RUN` (`src/constants/theme.ts:72-73`, applied in `src/domain/route-render.ts`) by `PixelRatio.get()` in the adapter or the run/walk width channel (spec §7.3 — the load-bearing second encoding) comes out ~3× too thin on a 3× device.
- **Markers cannot be tinted or given a symbol.** `GoogleMapsMarker` has no `tintColor`/`systemImage`; a custom `icon` needs a `SharedRef<'image'>` (expo-image's `useImage`) and **`expo-image` is not installed** (adding it is a native dependency on both platforms → iOS fingerprint moves). Without `icon` you get Google's default red pins. Decision below.
- **Interaction lock exists on Google** — `uiSettings.scrollGesturesEnabled/zoomGesturesEnabled/rotationGesturesEnabled/tiltGesturesEnabled: false` are real (ADR 0010 amendment item 6 noted they are Google-only). Keep the iOS `Pressable` + `pointerEvents="none"` wrapper anyway for `onPress` and the a11y role; the gesture flags are belt-and-braces.
- **Defaults a read-only map must suppress:** `zoomControlsEnabled` (true — Android's +/− buttons), `mapToolbarEnabled` (true — Google's "open in Maps / directions" toolbar on marker tap), `compassEnabled`, `myLocationButtonEnabled`, `indoorLevelPickerEnabled`, `scaleBarEnabled`; `properties.selectionEnabled: false`, `isBuildingEnabled: false` (3D blocks fight the route at street zoom), `isTrafficEnabled` (false by default), `isMyLocationEnabled` (false by default — no permission prompt; expo-maps' own plugin only handles that permission string and bails unless asked, so **no plugin entry is needed**, same as iOS).
- **The key is written by Expo, not by expo-maps.** `@expo/config-plugins/build/android/GoogleMapsApiKey.js` (a prebuild core step) turns `android.config.googleMaps.apiKey` into `<meta-data android:name="com.google.android.geo.API_KEY" …/>` plus `<uses-library android:name="org.apache.http.legacy" android:required="false"/>` in the main application. It is a **bare `android.*` field**: `expo run:android` does nothing until `bun run prebuild:dev:android` re-runs, then `cd android && APP_VARIANT=development ./gradlew :app:installDebug` (stage-2 gotcha). Without a key the map renders grey tiles and logcat shows the Maps SDK's `Authorization failure` — that is the smoke-test signal, not a crash.
- **The key moves the iOS fingerprint — measured, and mitigated.** With `android.config.googleMaps.apiKey` in `app.json` the iOS hash moved `9061ec14… → ff6345ca…` (and Android `d1e3dbb1… → dc4491bd…`) because `@expo/fingerprint` hashes the whole normalised Expo config as one `contents` source (`expoConfig`, serialised with its own `stringifyJsonSorted`) on both platforms. A `fileHookTransform` branch that parses that source, deletes `android.config.googleMaps` (and an emptied `android.config`), and re-serialises **with the same `stringifyJsonSorted`** (`require('@expo/fingerprint/build/sourcer/Utils')`) restored **both** hashes to their no-key values exactly; plain `JSON.stringify` did not (different formatting → a third hash). The hook already exists in `fingerprint.config.js` for `AndroidManifest.xml` files and is called for `contents` sources too (`build/hash/Hash.js:192-201`). Trade-off, deliberate: a key rotation alone no longer forces a native build — acceptable because old binaries keep their own baked key and JS never reads it; record in ADR 0012 as an amendment. Related, discovered the same day: **the root `.gitignore` is also a fingerprint source** (`bareGitIgnore`) — keep new ignore rules in nested `.gitignore` files (stage 3's `modules/audio-focus/android/.gitignore` is the precedent).
- **Expo CLI loads `.env*` files** for `expo prebuild` / `expo run:android` / `expo start` (`@expo/env`), and `.env*.local` is already gitignored. `app.config.ts` can read `process.env.GOOGLE_MAPS_ANDROID_API_KEY`; a bare `./gradlew` run does not load `.env`, which is fine because the key is baked at prebuild time.
- **Google pricing/restrictions:** Google lists Mobile Native Dynamic Maps (Maps SDK for Android/iOS) at no charge under the 2025 Essentials tier — re-verify on the pricing page when creating the key. Restrict the key to Android apps by package name + signing SHA-1: `se.lukaslindqvist.runbro.dev` with the debug keystore's `DD:7D:C2:28:9B:5B:62:94:C6:1E:02:A5:C6:FF:C9:13:F5:3F:C2:AA` (`keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`) now; `.e2e` and the production package with EAS/Play signing SHA-1s in stage 7. ADR 0010 item 5 already rules that a build-time credential does not breach the no-backend constraint.
- **Shared files that need a glyph pair or a gate on Android** (ADR 0025 item 5: a bare SF Symbol renders nothing on Android): `route-map-card.tsx:66` `name="arrow.up.left.and.arrow.down.right"` → `{ ios: 'arrow.up.left.and.arrow.down.right', android: 'open_in_full' }` (`open_in_full` verified in `expo-symbols/src/android/symbols.json`); `route-unavailable-card.tsx` has no `SymbolView`. The viewer's `Stack.Toolbar.Button icon="xmark"` in `src/app/_layout.tsx:126` already warns on Android (`Stack.Toolbar.Button on Android requires an ImageSourcePropType icon`) and renders nothing — the summary's own Close button (`_layout.tsx:105`) has carried the same warning since stage 1. Decision below.
- **What is already platform-blind and needs no work:** `useRunTrack` / `useRunRoute` (`src/hooks/use-run-track.ts`), the extent gate (`MIN_ROUTE_EXTENT_M`, spec §8), `toSegmentPolylines`, the smoother (ADR 0021), `useSegmentColors` (`use-theme.android.ts` maps the Material palette), `RouteUnavailableCard`, `runs/[runId]/index.tsx` (renders `RouteMapCard`, currently the null stub) and `runs/[runId]/route.tsx` (renders `RouteMap` interactive with `frame.width / frame.height`).

## Decisions for Lukas (settle before Task 2; the plan is written for the recommended option of each)

1. **Endpoint markers.** (A, recommended for v1) **no `markers`**; draw start and finish as `circles` — start filled `colors.primary`, finish filled `colors.success`, radius a fixed fraction of the bbox diagonal (a pure helper, so the dots scale with the route; merge to one when `haversineMeters(start, finish) < ENDPOINT_MERGE_M`, as iOS does) — zero new dependencies and the app's own colours. (B) Google's default red pins — free, but two identical pins that say nothing about start vs finish and trigger the marker callout/toolbar. (C) custom `icon`s via `expo-image` `useImage` — the faithful port of iOS's `figure.run`/`flag.checkered`, but a new native module on **both** platforms (iOS fingerprint moves) — defer to a later pass.
2. **Key handling.** (A, recommended) `app.config.ts` sets `android.config.googleMaps.apiKey` from `process.env.GOOGLE_MAPS_ANDROID_API_KEY` **only when present**; the key sits in `.env.local` (gitignored) locally and becomes an EAS environment variable in stage 7; the fingerprint hook strips it. A checkout without the key builds fine and shows grey tiles. (B) commit an Android-restricted key in `app.json` — common practice for restricted Android keys, but the repo's visibility decides it, and the hook is still needed. (C) accept the iOS fingerprint move — costs the next iOS release its OTA path for a config field iOS never reads; not recommended.
3. **Viewer close on Android.** (A, recommended) render the `Stack.Toolbar` only on iOS (`Platform.OS === 'ios'`) — Android already has the header back arrow and predictive back (stage 2), and the summary's Close has worked that way since stage 1; kills the startup warning. (B) an Android `require()`d close icon for `Stack.Toolbar.Button` — a bundled asset for a control Android does not need.
4. **Map look.** `colorScheme: FOLLOW_SYSTEM`, `mapType: NORMAL`, buildings off; Google has no equivalent of Apple's `MUTED` emphasis — a `mapStyleOptions.json` that hides POI labels is a v1.1 nicety, not this stage.

## Global Constraints

- **Read https://docs.expo.dev/versions/v57.0.0/sdk/maps/ first**; verify every prop against `node_modules/expo-maps/src/google/GoogleMaps.types.ts` and the Kotlin (`node_modules/expo-maps/android/src/main/java/expo/modules/maps/GoogleMapsView.kt`, `Records.kt`). Context7 is fine for expo-maps.
- **iOS must not change.** `adapter.ios.tsx`, `port.ts`, `index.ts`, `use-run-track.ts`, `cameraForBoundingBox`, `route.tsx`, `runs/[runId]/index.tsx` untouched. Shared files change only by an `{ ios, android }` glyph pair (`route-map-card.tsx`) and a `Platform.OS` gate on the viewer toolbar (`_layout.tsx`) — both behaviour-identical on iOS. **Measure the iOS fingerprint before and after every task** (`bunx expo-updates fingerprint:generate --platform ios | jq -r .hash`); it must end where it started (stage-3 tip: `9061ec14…`).
- **The key never enters git.** `.env.local` only; `git diff` before every commit; the fingerprint hook is committed, the key is not.
- **Native config ⇒ explicit rebuild:** `bun run prebuild:dev:android` then `cd android && APP_VARIANT=development ./gradlew :app:installDebug`. **Stage-3 emulator traps still apply:** `/data` under ~700 MB free fails Gradle's install — `adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk` stages one copy; a `pm revoke`/force-stop puts the app in the stopped state (`launch-app` by package, then `open-url runbrodev://expo-development-client/?url=http://localhost:8087`); another dev client launched on the emulator mid-test takes your taps — re-`describe` before every tap after a pause; Settings rows shift when location is denied.
- **A geo-fed run is the fixture** (AGENTS.md "Moving the emulator": `adb -s emulator-5554 emu geo fix <lon> <lat>` once per second, latitude += 0.000025° ≈ 2.8 m/s). The route gate is **extent**, not distance: `MIN_ROUTE_EXTENT_M` is 100 m of bbox diagonal, i.e. ≥ ~36 s of accepted fixes at that speed. Stage 3's 1-minute compressed runs recorded only 0.03–0.06 km, so feed for the whole run (or use a real-plan run) and read the summary's Distance tile before trusting a "no route" card as a gate result. A run with the feed **off** is the treadmill fixture for spec §8.
- **Comments WHY-only; architecture in ADR 0010/0025.** Objective gate per task: `bun run lint && bun run typecheck && bun run typecheck:android && bun test`. Metro on **8087**; `APP_VARIANT=development`; never touch `bun.lock`/`CHANGELOG.md`/`version`; `export COREPACK_ENABLE_AUTO_PIN=0`.

## Task Order and Why

Key, config and the fingerprint hook first — they force the one Gradle rebuild and prove the hook before any UI depends on it. Then the pure Google fit, unit-tested, so the adapter is a thin consumer. Then the adapter with a fixed camera and no markers, verified on a geo-fed run; then endpoints and the card/viewer plumbing; then the degradation and dark-mode passes; docs last.

---

### Task 1: the key, the config field and the fingerprint hook

**Files:** `app.config.ts` (modify), `fingerprint.config.js` (modify), `.env.local` (create, gitignored — **never committed**), `docs/adr/0012-release-please-fingerprint-gated-releases.md` (amend in Task 6).

- [ ] Create the key in Google Cloud (Maps SDK for Android enabled; application restriction "Android apps": `se.lukaslindqvist.runbro.dev` + the debug SHA-1 above). Put it in `.env.local` as `GOOGLE_MAPS_ANDROID_API_KEY=…`. Confirm `git status` does not list it.
- [ ] `app.config.ts`: inside the returned `android` object add
  ```ts
  config: process.env.GOOGLE_MAPS_ANDROID_API_KEY
    ? { ...config.android?.config, googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY } }
    : config.android?.config,
  ```
  with a one-line why (build-time credential, kept out of git; ADR 0010 item 5). Check with `APP_VARIANT=development bunx expo config --type public --json | jq .android.config` that the field appears with the env var set and is absent without it.
- [ ] `fingerprint.config.js`: extend the existing `fileHookTransform` with a first branch
  ```js
  if (source.type === 'contents' && source.id === 'expoConfig' && typeof chunk === 'string') {
    const { stringifyJsonSorted } = require('@expo/fingerprint/build/sourcer/Utils');
    const cfg = JSON.parse(chunk);
    if (cfg.android?.config?.googleMaps) {
      delete cfg.android.config.googleMaps;
      if (Object.keys(cfg.android.config).length === 0) delete cfg.android.config;
    }
    return stringifyJsonSorted(cfg);
  }
  ```
  and a why comment: the Maps key is baked into the Android manifest and never read by JS, the whole normalised config is a fingerprint source on both platforms, and re-serialising with the sourcer's own function is what keeps the hash byte-identical (`JSON.stringify` does not). Measure: iOS hash with the env var set must equal the hash without it (stage-3 tip `9061ec14…`); same for `--platform android`.
- [ ] `bun run prebuild:dev:android` (with the env var loaded — run it from a shell where `.env.local` is picked up, i.e. via `bun expo …`, not a bare gradle), confirm `android/app/src/main/AndroidManifest.xml` carries `com.google.android.geo.API_KEY`, Gradle-build and install. Nothing visible changes yet; logcat must not show `Authorization failure` once Task 3 draws a map.
- [ ] Gate + commit: `build(android): bake the Google Maps key from the environment and keep it out of the fingerprint`.

### Task 2: the Google camera fit

**Files:** `src/domain/geo.ts` (add), `src/domain/geo.test.ts` (add tests; find the existing `cameraForBoundingBox` describe block and add a sibling).

**Interfaces — produces:**
```ts
export interface ViewportDp { widthDp: number; heightDp: number }
/** Google Maps zoom: the world is 256·2^zoom dp wide. Web-Mercator on latitude; pole- and antimeridian-naive like the rest of this file. */
export function googleCameraForBoundingBox(bbox: BoundingBox, viewport: ViewportDp, paddingRatio = CAMERA_PADDING_RATIO): CameraFit;
export function endpointRadiusM(bbox: BoundingBox): number; // Decision 1A: ~1.5 % of the bbox diagonal, floored so a 100 m route still shows a dot
```

- [ ] Write failing tests first (bun test, pure TS):
  ```ts
  describe('googleCameraForBoundingBox', () => {
    const bbox = { minLat: 59.3293, maxLat: 59.3353, minLng: 18.0686, maxLng: 18.0686 + 0.0005 };
    test('centre is the bbox midpoint', () => {
      const fit = googleCameraForBoundingBox(bbox, { widthDp: 360, heightDp: 240 });
      expect(fit.center.lat).toBeCloseTo(59.3323, 6);
      expect(fit.center.lng).toBeCloseTo(18.06885, 6);
    });
    test('a north–south route is limited by height: the padded lat span fills 1/(1+2p) of the view', () => {
      const fit = googleCameraForBoundingBox(bbox, { widthDp: 360, heightDp: 240 }, 0.15);
      const worldDp = 256 * 2 ** fit.zoom;
      const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
      const latDp = ((mercY(bbox.maxLat) - mercY(bbox.minLat)) / (2 * Math.PI)) * worldDp;
      expect(latDp * 1.3).toBeCloseTo(240, 3);
    });
    test('a wide route is limited by width', () => {
      const wide = { minLat: 59.33, maxLat: 59.3305, minLng: 18.0, maxLng: 18.05 };
      const fit = googleCameraForBoundingBox(wide, { widthDp: 360, heightDp: 240 }, 0.15);
      const lngDp = (0.05 / 360) * 256 * 2 ** fit.zoom;
      expect(lngDp * 1.3).toBeCloseTo(360, 3);
    });
    test('a degenerate bbox is floored by MIN_SPAN_DEG and clamps inside Google\'s 3–21 range', () => {
      const dot = { minLat: 59.33, maxLat: 59.33, minLng: 18.06, maxLng: 18.06 };
      const fit = googleCameraForBoundingBox(dot, { widthDp: 360, heightDp: 240 });
      expect(Number.isFinite(fit.zoom)).toBe(true);
      expect(fit.zoom).toBeLessThanOrEqual(21);
    });
    test('a zero-size viewport (pre-layout) does not produce NaN', () => {
      const fit = googleCameraForBoundingBox(bbox, { widthDp: 0, heightDp: 0 });
      expect(Number.isFinite(fit.zoom)).toBe(true);
    });
  });
  ```
- [ ] Run `bun test src/domain/geo.test.ts` — expect the new block to fail with "not a function".
- [ ] Implement in `geo.ts` next to `cameraForBoundingBox`:
  ```ts
  const GOOGLE_TILE_DP = 256;
  const GOOGLE_MIN_ZOOM = 3;
  const GOOGLE_MAX_ZOOM = 21;

  export interface ViewportDp {
    widthDp: number;
    heightDp: number;
  }

  const mercatorY = (latDeg: number) => Math.log(Math.tan(Math.PI / 4 + (latDeg * DEG_TO_RAD) / 2));

  export function googleCameraForBoundingBox(
    bbox: BoundingBox,
    viewport: ViewportDp,
    paddingRatio = CAMERA_PADDING_RATIO,
  ): CameraFit {
    // why: a pre-layout viewport measures 0/0, which turns the whole fit NaN.
    const widthDp = viewport.widthDp > 0 ? viewport.widthDp : GOOGLE_TILE_DP;
    const heightDp = viewport.heightDp > 0 ? viewport.heightDp : GOOGLE_TILE_DP;
    const lngSpanDeg = Math.max(bbox.maxLng - bbox.minLng, MIN_SPAN_DEG);
    const latSpanY = Math.max(mercatorY(bbox.maxLat) - mercatorY(bbox.minLat), MIN_SPAN_DEG * DEG_TO_RAD);
    const pad = 1 + 2 * paddingRatio;
    const zoomForWidth = Math.log2(widthDp / (GOOGLE_TILE_DP * (lngSpanDeg / 360) * pad));
    const zoomForHeight = Math.log2(heightDp / (GOOGLE_TILE_DP * (latSpanY / (2 * Math.PI)) * pad));
    const zoom = Math.min(GOOGLE_MAX_ZOOM, Math.max(GOOGLE_MIN_ZOOM, Math.min(zoomForWidth, zoomForHeight)));
    return {
      center: { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 },
      zoom,
    };
  }
  ```
  (`DEG_TO_RAD` already exists in the file.) `CameraFit.zoom`'s doc comment says "expo-maps zoom … on BOTH axes" — leave it; add one line to the new function's JSDoc saying which convention this one returns.
- [ ] `endpointRadiusM`: `Math.max(4, 0.015 * boundingBoxDiagonalM(bbox))` with one test (`100 m diagonal → 4 m floor`, `2 km → 30 m`).
- [ ] Run the tests — pass. Gate + commit: `feat(android): Google-convention camera fit for the route map`.

### Task 3: the real `adapter.android.tsx`

**Files:** rewrite `src/components/route-map/adapter.android.tsx`; read `adapter.ios.tsx` as the template and keep the same section order.

**Interfaces — consumes:** `RouteMapProps` (unchanged), `googleCameraForBoundingBox`, `endpointRadiusM`, `ENDPOINT_MERGE_M`, `haversineMeters`, `useTheme` (`colors.primary`, `colors.success`).

- [ ] Skeleton (fill from `adapter.ios.tsx`; the deltas are the camera source and the endpoints):
  ```tsx
  import { GoogleMaps } from 'expo-maps';
  import { useMemo, useState } from 'react';
  import { type LayoutChangeEvent, PixelRatio, Pressable, View } from 'react-native';

  import { ENDPOINT_MERGE_M, endpointRadiusM, googleCameraForBoundingBox, haversineMeters } from '@/domain/geo';
  import { useTheme } from '@/hooks/use-theme';
  import type { RouteMapProps } from './port';

  /** Read-only styling: every default-on control off, no selection, no 3D blocks over the route (spec §3 for Android). */
  const PROPERTIES: GoogleMaps.MapProperties = {
    selectionEnabled: false,
    isBuildingEnabled: false,
    isMyLocationEnabled: false,
    isTrafficEnabled: false,
    mapType: GoogleMaps.MapType.NORMAL,
  };
  const UI_SETTINGS: GoogleMaps.MapUISettings = {
    compassEnabled: false,
    indoorLevelPickerEnabled: false,
    mapToolbarEnabled: false,
    myLocationButtonEnabled: false,
    scaleBarEnabled: false,
    togglePitchEnabled: false,
    zoomControlsEnabled: false,
  };
  const INERT_GESTURES: GoogleMaps.MapUISettings = {
    ...UI_SETTINGS,
    rotationGesturesEnabled: false,
    scrollGesturesEnabled: false,
    scrollGesturesEnabledDuringRotateOrZoom: false,
    tiltGesturesEnabled: false,
    zoomGesturesEnabled: false,
  };
  ```
  Check the exact exported names (`GoogleMaps.MapProperties`, `GoogleMaps.MapUISettings`, `GoogleMaps.MapType`, `GoogleMaps.MapColorScheme`) in `node_modules/expo-maps/src/index.ts` / `google/GoogleMaps.types.ts` before typing them.
- [ ] Camera: the port gives `aspectRatio` only, Google needs dp — measure once:
  ```tsx
  const [viewport, setViewport] = useState<{ widthDp: number; heightDp: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    if (viewport) return; // why: fit once — a later re-fit would yank a view the user has panned (ADR 0010 amendment 8)
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setViewport({ widthDp: width, heightDp: height });
  };
  const camera = useMemo(() => (viewport ? googleCameraForBoundingBox(bbox, viewport) : null), [viewport, bbox]);
  ```
  Render `<View style={{ flex: 1 }} onLayout={onLayout}>{camera ? <GoogleMaps.View … /> : null}</View>` — the map mounts only after the first layout, so its first `cameraPosition` is already the fit and there is no visible snap. `bbox` is stable for a given route (the hook memoises it), so `camera` does not recompute after the first fit.
- [ ] Polylines: `route.lines.map((line) => ({ id: line.id, coordinates: line.points.map((p) => ({ latitude: p.lat, longitude: p.lng })), color: line.color, width: line.width * PixelRatio.get() }))` with a one-line why on the `PixelRatio` multiply (pixels, not dp — `GoogleMapsView.kt:162`).
- [ ] Endpoints (Decision 1A): `circles` — start `{ id: 'start', center, radius: endpointRadiusM(bbox), color: colors.primary, lineColor: colors.background, lineWidth: 2 * PixelRatio.get() }`, finish likewise in `colors.success`, merged to the start dot alone when `haversineMeters(endpoints.start, endpoints.finish) < ENDPOINT_MERGE_M`. Circles paint above polylines in Compose Maps' default z-order; verify on the emulator and, if not, set the circle `zIndex`.
- [ ] Interactive vs inert: `interactive` → `uiSettings={UI_SETTINGS}` inside `<View style={style}>`; otherwise `uiSettings={INERT_GESTURES}` inside the iOS-style `Pressable` (`accessibilityRole="button"`, `accessibilityLabel`, `accessibilityHint="Opens the full-screen route"`, pressed opacity) with the map subtree `pointerEvents="none"`. `colorScheme={GoogleMaps.MapColorScheme.FOLLOW_SYSTEM}`.
- [ ] Verify on the emulator: fresh geo-fed run (feed running for the whole run; compressed plan on) → summary shows the card with the route and both dots; logcat has no `Authorization failure`; `describe` shows the card as a button with "Map of your 0.0x km route". Take the argent screenshot into the PR. Then `adb shell cmd uimode night yes` → the map follows (and `no` to restore).
- [ ] Gate + fingerprint check + commit: `feat(android): render the recorded route with Google Maps behind the RouteMap port`.

### Task 4: the card, the stub and the viewer

**Files:** delete `src/components/route-map-card.android.tsx`; modify `src/components/route-map-card.tsx:66` (glyph pair); modify `src/app/_layout.tsx:125-133` (Decision 3A gate).

- [ ] Delete the stub. `runs/[runId]/index.tsx` now renders the shared `RouteMapCard` on Android. Check the card's Compose/RN nesting renders at the 3:2 aspect (the `min-h-[100px]` why in the card is an iOS SwiftUI-host workaround; if Android shows the card at the floor height only, the map host's intrinsic size is the suspect — measure with `describe` frames).
- [ ] `route-map-card.tsx`: `name={{ ios: 'arrow.up.left.and.arrow.down.right', android: 'open_in_full' }}` — behaviour-identical on iOS (ADR 0025 item 5).
- [ ] `_layout.tsx`: wrap the viewer's `<Stack.Toolbar>` in `{Platform.OS === 'ios' ? … : null}` with a why (Android exits through the header back arrow / predictive back; the SF-Symbol toolbar button renders nothing there and warns at startup). Leave the summary's Close toolbar alone unless Lukas wants the same gate — it is the same warning, and it is stage-1 behaviour.
- [ ] Verify: tap the card → viewer opens full-bleed (title empty, header transparent), pan and pinch work, `describe` finds "Your 0.0x km route"; back gesture returns to the summary intact; deep link `runbrodev://runs/<id>/route` for a run without a route shows `RunUnavailable` ("no-route"), for a bogus id shows "missing".
- [ ] Gate + fingerprint check + commit: `feat(android): route card and full-screen viewer on the run summary`.

### Task 5: degradation and the extent gate on Android

- [ ] Run with the geo feed **off** (stationary emulator): summary shows `RouteUnavailableCard` — never a dot on a map of the emulator's default location (spec §8). Run with location denied: the permission-flavoured copy of the same card.
- [ ] Run with the feed on for only ~15 s then off: extent under `MIN_ROUTE_EXTENT_M` → unavailable card, Distance tile present — the case the gate exists for.
- [ ] Record: whether `PixelRatio` scaling made run/walk widths distinguishable at card zoom on the Pixel 9 Pro (2.6×), whether the circles need a `zIndex`, and the first-paint time of the card (Google's map view is heavier than Apple's; if the summary visibly stalls, `onMapLoaded` + a placeholder is the follow-up).

### Task 6: docs

- [ ] ADR 0010: dated amendment "Android realised" — Google zoom convention and the dp-measured fit (why the port stayed as amendment 8 left it), pixel-width polylines, circles instead of markers (Decision 1 and its C follow-up), the gesture lock being real on Google, the key mechanics and the fingerprint hook, `FOLLOW_SYSTEM`.
- [ ] ADR 0012: dated amendment — the `expoConfig` strip in `fingerprint.config.js`, what it skips and why that is safe, and the "root `.gitignore` is a source" rule.
- [ ] ADR 0025: row 4 → **Built <date>**; amendment with what changed beyond the plan and the emulator facts.
- [ ] AGENTS.md: Maps bullet gains the Android key handling (`.env.local`, never committed, EAS env in stage 7), the `Authorization failure` smoke signal, the prebuild-after-key gotcha, and the dark-mode toggle (`adb shell cmd uimode night yes|no`).
- [ ] Memory: `android-stage-4.md` with what surprised you; mark `android-stage-4-handoff` superseded.

## Deferred (not this stage)

- Custom start/finish marker icons (needs `expo-image`; a both-platform native change — bundle with another native bump).
- POI-muting `mapStyleOptions` for parity with Apple's `MUTED` emphasis.
- Health Connect (5); elevation (6); Android release pipeline, EAS env for the key, Maestro on Android (7).
- `POST_NOTIFICATIONS` for the tracking notification (open since stage 2).

## As built (2026-09-21) — read before the next stage

Shipped as PR #66 on `ll/android-stage-4`, stacked on #65. All four decisions
above went with the recommended option. The record of what was verified and
what deviated lives in ADR 0010's, ADR 0012's, ADR 0019's and ADR 0025's
2026-09-21 amendments; the short version:

- **"Without a key the map renders grey tiles" was wrong.** No key meta-data at
  all crashes the app (`API key not found` from `MapView.onCreate`); only an
  *invalid* key degrades. `app.config.ts` always bakes a key, falling back to
  `MISSING_GOOGLE_MAPS_ANDROID_API_KEY`, and the stage-3 dev client (no
  meta-data) could not render a map, so the Gradle rebuild came first, not last.
- **The key's SHA-1 is prebuild's `android/app/debug.keystore`**
  (`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`), not
  `~/.android/debug.keystore`'s as written above. The key lives in `.env.local`
  (copy it into each new worktree).
- **An unauthorised map is blank, not grey**: maps-compose gates its
  `AndroidView(MapView)` on `GoogleMapsInitializer`, the SDK creates only the
  first `MapView` per process once authorisation has failed, and nothing draws —
  no tiles, overlays or logo. Everything was re-verified with the real key the
  same day.
- **Two adjustments the key surfaced:** `colorScheme` is passed as `LIGHT`/`DARK`
  from `useColorScheme()` (`FOLLOW_SYSTEM` is read once at creation), and the
  summary's content container gained `android:pb-safe-offset-10` (the last card
  ran into the gesture bar — the third Android screen to ship without the inset;
  the rule is in AGENTS.md).
- **Fixtures:** a 1-minute compressed run recorded 17 fixes / 52 m, under the
  extent gate; the route fixtures are real-plan runs ended by hand (0.67 km
  warm-up-only; 0.47 km with run/walk segments after skipping the warm-up).
- **Emulator storage** at ~620 MB free fails even `adb install -r`; the
  uninstall → install → `run-as` restore → `pm grant` recipe is in ADR 0025's
  amendment.
- **Open tuning:** the metric endpoint circles read small at card zoom; the
  fixed-size icon needs `expo-image` (a both-platform native bump — the natural
  batch partner for stage 5's iOS fingerprint move, see the stage 5 handoff).

Handoff for stage 5: [`2026-09-22-android-stage-5-health-connect.md`](2026-09-22-android-stage-5-health-connect.md).
