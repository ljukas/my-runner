# Stage 4 — Maps: Design Spec

**Date:** 2026-07-28
**Status:** Approved pending final user review · revised after three independent adversarial reviews (§13)
**Stage:** 4 of 5 (master spec [§13](2026-07-11-c25k-app-design.md))
**Governing ADRs:** 0003 (ports), 0004 (storage/reactivity), 0005 (native UI), 0006 (modal surfaces), 0010 (maps), 0013 (components), 0016 (Maestro selectors), 0021 (GPS smoothing)

## 1. Goal

*Runs become visible.* A finished run shows its recorded route on Apple Maps —
segment-coloured, with direction-of-travel arrows, start/finish markers and a
camera fitted to the route — on the run summary, plus a full-screen viewer for
panning and zooming.

Stage 4 is **read-side only**. It adds no schema, no migration, no engine
change, and no new permission. Every input already exists: Stage 3 persists
`run_points` (raw fixes tagged with `segment_seq`) as the single source of
truth, and `domain/geo.ts` already ships the smoother, `simplifyPolyline`
(Douglas–Peucker) and `boundingBox`.

## 2. Decisions

| Topic | Decision |
|---|---|
| Run detail screen | **No `runs/[runId]` screen.** The map card goes into the existing `run-summary/[id]`, which already serves both fresh-finish and Log-revisit. Supersedes master spec §8/§13. |
| Summary map | **Non-interactive**, camera-fitted preview in a `Card` directly under the headline, with a visible expand affordance; tapping it opens the viewer. |
| Full-screen viewer | New route `run-route/[id]`, presented as **`presentation: 'modal'`** — swipe-down dismissal, with a toolbar `xmark` as redundancy (§7.3). |
| Polyline colours | The existing **4-kind palette** (`useSegmentColors()`), **double-encoded with stroke width** so phase never depends on hue alone (§7.3). Supersedes master spec §8's accent/muted wording. |
| Direction arrows | **Chevrons synthesised as extra 3-point polylines** — the only mechanism the API supports — in a dark casing ink, sized from the *fitted camera span* (§5). |
| Geometry source | Derived from `run_points` (re-smoothed + DP-simplified). **Never** from `runs.summary_polyline`; nothing about finalize changes. |
| Library | `expo-maps@~57.0.1` behind the `RouteMap` component port; react-native-maps stays the pre-approved fallback (ADR 0010 §3). |
| iOS floor | `ios.deploymentTarget: "17.0"` — set via app.json's **built-in** property, *not* `expo-build-properties` (§9). Amends ADR 0010. Reviewer objection recorded in §13. |
| Live map during a run | Still out (master spec §8: glanceability + battery). |

## 3. Verified platform facts

ADR 0010 §1 requires re-verifying expo-maps against the installed package
rather than the docs, "alpha being what it is". Done — against
`expo-maps@57.0.1`'s shipped declarations and Swift sources, then
**independently re-derived by a second reader** who confirmed every
load-bearing claim below and corrected two (§13). Several findings contradict
the package's own README.

**Camera.** `CameraPosition` is `{ coordinates?, zoom? }` — no bounds, span,
region, padding, heading or pitch. `ios/MapUtils.swift:15-16` converts it as:

```swift
let longitudeDelta = 360 / pow(2, zoom)
let latitudeDelta = longitudeDelta / cos(0 * .pi / 180)   // cos(0) == 1 — dead code
```

So the requested span is **`360 / 2^zoom` degrees, isotropic** — *not* a
Web-Mercator tile zoom, and with no `cos(latitude)` term (the `cos(0)` is a bug
where `cos(latitude)` was intended). The inverse is `zoom = log2(360 / spanDeg)`.
A Web-Mercator-derived zoom would be ~2× wrong at 59°N.

**Why a manual fit is unavoidable:** the pre-`onAppear` state is
`MapCameraPosition.automatic` (`ios/AppleMapsViewState.swift:9,21`) — MapKit's
own content framing — which `.onAppear` unconditionally overwrites with the
prop. There is no way to ask the library to frame the content.

**The `cameraPosition` prop is honoured on first render; the ref is not needed.**
Both renderers guard a one-shot `.onAppear` with a non-`@Published`
`hasInitializedCamera` flag that *reads the prop*, with no default or
user-location fallback on that path. RN applies props before view insertion
(`RCTMountingManager.mm:83-90`: `updateProps:` → `finalizeUpdates:` →
`mountChildComponentView:`) and the SwiftUI tree attaches only in
`didMoveToWindow`, so the prop is always populated first. Consequences:
**always pass `cameraPosition`** (its default is `(0,0)` at `zoom: 1` — null
island at a 180° span); **never call `setCameraPosition` at mount** (an async
call landing before `.onAppear` is clobbered); the prop path is unanimated
while the ref path is `withAnimation`; and the sticky flag surviving a window
round-trip is *desirable* — the hosting controller re-attaches on window
changes, so `.onAppear` can re-fire, and the flag is what stops the card
re-fitting after the viewer is dismissed.

`Map(position:)` is a **two-way binding** — user pan/zoom writes back into
state, and a later prop commit with a *different* value snaps the view back.
Equality is by value (`MapRecords.swift:41-48`), so re-sending an identical
camera is a no-op. The camera must therefore be **value-stable** across renders
(see the props note below — reference identity is neither achievable nor the
mechanism that protects us).

**Expand-only is the one assumption everything rests on.** The containment
argument in §4.2 requires that MapKit only ever *enlarges* a requested region
to satisfy the viewport's aspect ratio. That is documented for UIKit
`MKMapView.setRegion`, but **nothing in the SwiftUI `_MapKit_SwiftUI` interface
states it** for `MapCameraPosition.region`. If the fit were a crop instead, the
aspect correction inverts and over half a route can be lost (§11). §10.2 must
assert framing tightness on device, not merely "nothing clipped".

**Polylines.** `AppleMapsPolyline` is exactly `{ id?, coordinates, color?,
width?, contourStyle? }` (`src/apple/AppleMaps.types.ts:348-369`). There is
**no dash, pattern, texture, arrowhead, line-cap, line-join or opacity
property**, and `contourStyle` is only `STRAIGHT | GEODESIC` (projection, not
styling). The renderer calls only `.stroke(color, lineWidth:)`. Stay on
`STRAIGHT`: `GEODESIC` interpolates 30 great-circle points per segment during
iOS 18 hit-testing.

**`id` is a correctness requirement, not a nicety.** Swift declares
`ExpoAppleMapPolyline: Record, Identifiable` with `id` defaulting to
`UUID().uuidString` (`MapRecords.swift:88-89`), rendered through `ForEach`.
Omit `id` and every prop update mints new identities, so SwiftUI tears down and
rebuilds all overlays.

**Paint order.** Content-builder order is markers → polylines → polygons →
circles → annotations → `UserAnnotation()`, identically on both renderers.
There is **no z-index in the Apple path, and none anywhere in
`_MapKit_SwiftUI`** — so array order is the *only* lever, and the `polygons`
fallback (§5) is the only real plan B. Markers/annotations above overlays is
documented for UIKit `MKOverlayLevel` but not for SwiftUI; both need the §10
check.

**expo-maps never passes `interactionModes`, so no interaction lock is
reachable through the JS surface.** This is a *wrapper gap, not a platform
limitation*: `MapInteractionModes` has existed since iOS 14 and sits in the
very initializer the package calls —
`_MapKit_SwiftUI.swiftinterface:478`, `init<C>(position:bounds:interactionModes: MapInteractionModes = .all, scope:content:)`
— while `interactionModes` appears nowhere in expo-maps. A one-argument
upstream fix or patch would remove the need for the RN workaround in §7.1.
(`scrollGesturesEnabled` and friends genuinely are Google-only.)

Also note `uiSettings.compassEnabled`, `myLocationButtonEnabled` and
`togglePitchEnabled` **default to true**, `properties.selectionEnabled` defaults
to **true** (on iOS 18 a tap raises Apple's place-detail accessory), and POIs
default to *all shown*.

**`AppleMaps.View` is itself a SwiftUI island.**
`ios/AppleMapsView.swift:32` — `struct AppleMapsViewWrapper: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView`
— the same conformance pair as `@expo/ui`'s `HostView.swift:46`, instantiated by
the same `SwiftUIViewDefinition.swift:111-113` path into a
`UIHostingController`-backed `ExpoView`. It is **not** a plain
`RCTViewComponentView`. This governs §7.1 and §10.

**Markers are full-size balloons.** `Marker(title, systemImage:, coordinate:)`
with `.tint(tintColor)` — no sizing API, and `annotationTitles(_:)` is never
called. An empty `title` (the default) gives an unlabelled balloon; that is the
only lever. `AppleMapsAnnotation.icon` is hard-coded to a 50×50 screen-space
frame.

**Colour alpha works.** Polyline and polygon colours pass through RN
`processColor`, so `"rgba(0,0,0,0.55)"` and 8-digit hex yield real alpha.
`marker.tintColor` is *not* processed in JS, but Swift parses colour strings
directly, so a plain hex string is fine there.

**Props: value stability, not reference identity.** RN's Fabric prop diff for
object/array props is an unlimited-depth deep compare
(`ReactNativeAttributePayload.js:36-45` → `deepDiffer`, `maxDepth = -1`), so a
value-identical new array produces no native commit. Reference identity is not
achievable at the boundary anyway — expo-maps' own wrapper rebuilds the array
every render (`src/apple/AppleMapsView.tsx:69-72`, no `memo`). What *does* cost
is a genuine change: Expo's bridge hands **all** accumulated props to Swift on
every commit (`ExpoViewProps.cpp:14-28`, `ExpoFabricViewObjC.mm:124-137`), and
`Coordinate` uses `@Field` rather than the `@Record` macro, so every coordinate
goes through uncached `Mirror` reflection (`Record.swift:196-210`). On iOS 18
each polyline additionally builds an `MKPlacemark` + `MKMapItem` per body
evaluation. Mitigation: keep values stable and vertex counts low (§6).

**Deployment target.** SDK 57's default is **16.4**
(`ios/Podfile:25`, `platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'`,
with no `ios.deploymentTarget` in `Podfile.properties.json`); expo-maps'
podspec matches at 16.4, and its shipped release XCFramework declares
`minos 16.0` with a simulator slice — so nothing needs raising to compile or
link, and the dev-client and `e2e-simulator` builds are fine. Nothing else in
the dependency set imposes a higher floor (every `node_modules/**/ios/*.podspec`
is at 16.4). The package runtime-branches: iOS 18 → `AppleMapsViewiOS18`,
iOS 17 → `AppleMapsViewiOS17`, **below 17 → `EmptyView()`** (blank, no crash).
The iOS 17 renderer is complete, not a stub: same `MapPolyline`/`.stroke`, same
markers, annotations, polygons, circles, `mapControls`, `mapStyle` (including
`emphasis: MUTED`, `@available(iOS 17.0)`) and camera code. **iOS 18 gates only
click events and programmatic selection**, neither of which a read-only map
uses.

The README's *"requires a minimum deployment target of iOS 18.0"*
(`README.md:12`) is contradicted **four** ways: its own podspec (16.4), the
complete iOS-17 renderer, `isMapsAvailable` reporting true from 17.0, and the
SDK 57 docs page, which states no deployment target at all and version-annotates
only the click handlers (iOS 18.0+) and `monogram` (iOS 17.0+).

**Two caveats on the sources above.** SDK 57 links the *prebuilt* XCFramework
(`EXPO_USE_PRECOMPILED_MODULES=1`, `ios/Podfile:23-24`), so the quoted Swift is
not literally what ships — it matches because Expo builds the prebuild from the
same tag. And `isMapsAvailable` is **not reachable from JS**
(`src/index.ts:36-62` re-exports only the views, types and permission helpers),
so it is evidence, not an available runtime gate; a real gate would use
`Platform.Version`.

**Importing `expo-maps` throws if the native module is absent.**
`src/ExpoMaps.ts:5` is a top-level `requireNativeModule('ExpoMaps')`, which
throws rather than degrading. Practical consequence in §9.

## 4. Architecture

```
run_points (immutable after finalize)
  └─ loadRunPoints(runId) → SegmentedFix[]   sync, non-reactive (ADR 0004 §3)
       └─ smoothTrackForRender(fixes)         4th fold over the shared smoothFix reducer;
       │                                      tags segmentSeq + gapBefore, drops seed points
       ├─ boundingBox(points) → cameraForBoundingBox(bbox, aspect)
       └─ toSegmentPolylines(points, ε)       split by segment/gap → DP each chunk
            ├─ join segmentSeq → kind → useSegmentColors() (+ width, §7.4)
            └─ chevronsAlongRoute(chunks, fittedSpanM)
                 └─ RouteMapRoute + RouteMapDecoration[] (stable ids)
                      └─ RouteMap port → adapter.ios.tsx → AppleMaps.View
```

The engine, `save-run.ts` and the schema are untouched. `summary_polyline`
keeps storing the full smoothed track for v2 thumbnails; nothing reads it.

### 4.1 `domain/geo.ts` additions

```ts
// Additive field on the existing reducer — set where smoothFix already calls startAt
interface SmoothStep { /* …existing… */ restarted: boolean }

interface RenderPoint { point: LatLng; segmentSeq: number; gapBefore: boolean }
interface SegmentPolyline { segmentSeq: number; points: LatLng[]; gapBefore: boolean }
interface Chevron { points: readonly [LatLng, LatLng, LatLng] }
interface CameraFit { center: LatLng; zoom: number; fittedSpanM: number }

function smoothTrackForRender(fixes: readonly SegmentedFix[]): RenderPoint[];
function toSegmentPolylines(points: readonly RenderPoint[], epsilon?: number): SegmentPolyline[];
function chevronsAlongRoute(chunks: readonly SegmentPolyline[], fittedSpanM: number): Chevron[];
function cameraForBoundingBox(bbox: BoundingBox, aspectRatio: number, paddingRatio?: number): CameraFit;
```

`smoothTrackForRender` reuses `smoothFix` — the same reducer the live engine and
the finalize rollup use. `gapBefore = restarted && points.length > 0`
distinguishes a real mid-track gap reset from the track's first point (also a
`restarted` step); this was brute-force verified sound across 372k branches,
including gaps spanned by velocity-gated fixes, because the gap check runs
*before* the gate. `smoothTrackBySegment` is left untouched.

**Seed points are dropped from the render stream only.** `smoothFix` emits the
*raw* measurement for the first fix after a start or gap reset (the `!started`
branch) and again for the next one (`fixesSinceReset === 1` seeds velocity from
two points), and `accuracyFilter` admits up to 50 m. Since
`simplifyPolyline` keeps `keep[0]` unconditionally, a legal 45 m cold-start fix
becomes a **permanent spur** in the drawn line, repeating after every gap, and
inflates the bbox — measured at +24% zoom-out and a distorted chevron size on a
400 m loop. `smoothTrackForRender` therefore skips points while
`fixesSinceReset <= 2`. This is render-only and does not touch ADR 0021's
determinism guarantee: distance still folds over every fix.

**The segment-boundary rule.** Adjacent fixes belong to different segments by
construction, so no shared vertex exists in the raw stream and naive chunking
leaves a visible break at *every* segment change (17 in W1D1). At an ordinary
transition, `toSegmentPolylines` prepends **the last point emitted so far** —
not "the previous chunk's last point", which is `undefined` when a segment
contributed zero render points (every fix gated) — to the next chunk before
simplifying. Because `simplifyPolyline` retains both endpoints of any slice *by
object reference*, the two differently-coloured lines then meet at a
bit-identical coordinate. Empty chunks are dropped **before** the prepend is
read; sub-2-point chunks are dropped after simplification. At a **real GPS gap**
it does not prepend — the break is the intended rendering (ADR 0021 §5, master
spec §11). A segment interrupted mid-way by a gap yields two chunks sharing one
`segmentSeq`.

Two notes on this rule. It is **load-bearing for E2E**: under the compressed
plan (`EXPO_PUBLIC_E2E`) W1D1 is ~40 s over 17 segments, so at ~0.5 fix/s 15 of
17 chunks are single-point chunks rescued entirely by the prepend — the only
path the Maestro flows ever exercise. And the prepend can displace the chunk's
own first point during simplification, so a colour boundary may sit up to ε from
the true segment change; continuity is unbroken and the deviation is bounded by
ε, which is acceptable for a legend-keyed map.

**Simplification epsilon is per surface:** ε = `DP_EPSILON_M` (5 m) for the
card, ε = `VIEWER_DP_EPSILON_M` (2 m) for the viewer, which zooms in far enough
for ε=5 to visibly cut corners — i.e. the card is knowingly drawn with slightly
cut corners, which is invisible at ~1.9 m/pt. Both are sub-millisecond (§6).

### 4.2 Camera fit

`expo-maps` requests an **isotropic degree span**, while Mercator stretches
latitude by `f = 1 / cos(centerLat)` (exactly `dy/dφ`). MapKit then fits that
region to the view, only ever *expanding* it (§3 flags this as the load-bearing
assumption). Writing `A` for the viewport aspect ratio (width / height), the
minimum span containing the route is:

```
S = max( lngSpanDeg / max(1, A·f),  latSpanDeg·f / max(1/A, f) )
zoom = log2( 360 / (S · (1 + 2·padding)) )
```

Independently re-derived and brute-force validated against an exact
Mercator/aspect-expand simulation over 40 000 random `(A, latitude, bbox)`
triples spanning both regimes: `formulaS / trueMinimalS ∈ [0.99962, 1.0000029]`
— it *is* the exact minimum, to within an O(latSpan²·tan lat) midpoint-secant
residual. Both `max()` terms switch at the same threshold
(`A·f ≥ 1 ⟺ f ≥ 1/A`), so the formula is regime-consistent by construction.
Degenerate shapes behave: a point bbox floors to `MIN_SPAN_DEG` (without which
`S = 0` → `zoom = ∞`), pure east-west and pure north-south lines fit exactly,
and the pole degrades gracefully rather than producing `NaN`.

The fit needs only the **aspect ratio**, never pixel dimensions — so no
`onLayout`, no measurement race, no post-layout re-render.

**Padding is not purely cosmetic.** At `padding = 0` the fit is exactly tight,
which means the Mercator linearisation residual can put the route marginally
outside the view, half the polyline's stroke width falls off-screen at the
extremes, and the full-size marker balloons — drawn *above* their anchor with no
sizing API — clip hard. Slack per side is exactly `p / (1 + 2p)`, i.e. 11.54% at
`CAMERA_PADDING_RATIO = 0.15` (≈27 pt on the card), which comfortably covers a
balloon. `paddingRatio` is a fraction of the content span **per side**.

`cameraForBoundingBox` also returns **`fittedSpanM`** — the vertical extent the
camera will actually show, `max(W/A, H)` in metres — because that, not the
bounding-box diagonal, is the scale chevron sizing must track (§5).

Antimeridian- and pole-naive, inheriting `boundingBox`'s documented stance: a
route straddling ±180° yields a whole-planet span. Outside the C25K footprint,
noted because a `MIN_SPAN_DEG` floor exists and no maximum does.

### 4.3 Data access

`db/run-points.ts` becomes the **single** `run_points` reader, returning domain
types:

```ts
function loadRunPoints(runId: string): SegmentedFix[];
```

This is more than the rename first proposed. Today there are two readers —
`db/active-run.ts:22` (→ `BufferedRunPoint[]`, for crash resume) and
`save-run.ts:11` `rollupFromPoints` (a private copy mapping to `SegmentedFix`) —
and `smoothTrackForRender` needs `SegmentedFix`, which `BufferedRunPoint` is
not. A bare move would have added a *third* row-mapper. Instead the new module
owns the query, `save-run.ts` re-points at it, and the run-engine keeps its
`BufferedRunPoint` shape via a thin adapter at its own call site — which also
removes the `db/ → services/run-engine/types` import the move would otherwise
carry forward.

`src/hooks/use-run-route.ts`:

```ts
type RunRoute =
  | { ready: false }
  | { ready: true; camera: CameraFit; route: RouteMapRoute; decorations: RouteMapDecoration[];
      endpoints: { start: LatLng; finish: LatLng } };

function useRunRoute(runId: string, segments: readonly RunSegment[],
                     aspectRatio: number, epsilon?: number): RunRoute;
```

**Two memos, not one.** Geometry is keyed on `[runId, segments, aspectRatio,
epsilon]` and is theme-free; colouring is keyed on `[geometry, segmentColors]`.
A single memo including `segmentColors` would re-run a ~1710-row SQLite read on
every light/dark switch just to change four hex strings.

`loadRunPoints` is synchronous, so there is no effect and no loading state.
`segments` comes from the screen's existing live query — the hook never queries
`run_segments` itself; it only needs the `segmentSeq → kind` join. `run_points`
is read **once per mount, never live** (ADR 0004 §3).

**`ready: false` until segments have loaded.** `useLiveQuery` returns `[]`
before its first result, so a screen that renders immediately would join against
nothing and produce uncoloured chunks and a partial bbox — and because the
camera is read once at `.onAppear` (§3), a wrong camera would never correct.
Both screens gate on the `updatedAt !== undefined` idiom already used in
`run-summary/[id].tsx:53`, and the hook additionally returns `{ ready: false }`
while `segments.length === 0`. If the bbox can ever change after mount, the
adapter must `key`-remount rather than rely on a camera prop update.

The hook — not the port — computes the camera, because `fittedSpanM` is the same
quantity chevron sizing needs and deriving it twice invites drift. This is a
deliberate, narrow deviation from ADR 0010 §2's "`RouteMap` owns the camera-fit
math": the *math* remains a pure, unit-tested helper in `domain/geo.ts`, which
is what the ADR was protecting. Record it in the amendment.

`endpoints` are the first point of the first chunk and the last point of the last
chunk — the route's true extremities even when a gap split the track.

## 5. Direction arrows

The requested `----->-----` reading has exactly one viable mechanism.
`AppleMapsPolyline` has no dash/arrow/texture property, and **neither
`AppleMapsMarker` nor `AppleMapsAnnotation` exposes rotation**, so oriented
icons would mean pre-rendering a bitmap per bearing bucket. Chevrons are
therefore synthesised as geometry: pure maths, no assets, on the
library-agnostic side of the port.

`chevronsAlongRoute` concatenates each **gap-free** run of chunks (adjacent
non-gap chunks share their boundary coordinate exactly, so this reconstructs the
line the user sees; segment-colour changes are transparent to the walk), then
places arrows by arc length, interpolates the point, takes the local bearing,
and emits `[backLeft, tip, backRight]`. `sizeM` is the **tip-to-wing-end
length**; with `CHEVRON_WING_DEG = 35` off the reverse bearing that gives a mark
`1.15·sizeM` wide and `0.82·sizeM` deep.

Riding on the already-simplified geometry rather than the dense raw stream cuts
the work ~16× (1710 → 103 vertices) and measurably reduces bearing jitter
(bearing standard deviation 71° raw at 2 m spacing → 23.5° at ε=5).

Four corrections came out of review, each of which the naive version gets wrong:

**Size tracks the fitted camera span, not the bbox diagonal.** The camera shows
`fittedSpanM = max(W/A, H)`, not `√(W²+H²)`, so sizing by the diagonal varies
on-screen size by `max(1/A,1)·√(1+A²)` **purely from bbox shape** — 1.8× on the
card, 2.4× full-screen — before any clamp. With a 25 m maximum the failure is
severe: a **5 km point-to-point run, the app's goal state, would render a 1.7 pt
chevron** under a ~3 pt stroke, i.e. nothing at all. Sizing from `fittedSpanM`
makes the invariance exact, and `CHEVRON_MAX_SIZE_M` becomes a sanity rail
rather than a design parameter.

**Opposed arrows must be deduplicated.** On any route that retraces its ground,
arc-length positions `p` and `L − p` are the same physical spot, so uniform
spacing makes every arrow's mirror also an arrow. Measured on a 1.4 km
out-and-back with a 4 m return offset: **4 of 8 arrows sat 4 m from an identical
arrow pointing 180° the other way**, while the chevrons themselves were 25 m long
— interpenetrating. Out-and-back is the canonical beginner route, and the
half-offset placement variant does not help. After placing, drop any candidate
within `2·sizeM` of a placed chevron whose bearing differs by more than 120°
(O(n²) on n ≤ 24). This also fixes loop closure and multi-lap routes.

**Spacing is global, not per run.** Computing `spacing` per gap-free run makes
`CHEVRON_TARGET_COUNT` not a budget: two GPS gaps tripled the arrow count from 8
to 24. Derive spacing from the total length across all runs, then walk each run
on that global grid.

**Guard the duplicated boundary vertex.** Concatenating chunks that share a
boundary point puts that point in twice, producing a zero-length segment; a
scan using `<=` lands on it and `atan2(0, 0)` returns 0, silently emitting a
**due-north arrow**. Dedupe equal consecutive points on concatenation and guard
the degenerate bearing.

| Constant | Value |
|---|---|
| `CHEVRON_SIZE_RATIO` (of `fittedSpanM`) | `0.05` |
| `CHEVRON_MIN_SIZE_M` / `CHEVRON_MAX_SIZE_M` | `3` / `150` |
| `CHEVRON_TARGET_COUNT` | `8` |
| `CHEVRON_MIN_SPACING_MULTIPLIER` | `4` |
| `CHEVRON_MIN_RUN_LENGTH_M` | `20` |
| `CHEVRON_WING_DEG` | `35` |
| `CHEVRON_OPPOSED_DEG` / `CHEVRON_DEDUPE_MULTIPLIER` | `120` / `2` |
| `MIN_SPAN_DEG` | `0.0005` |
| `CAMERA_PADDING_RATIO` | `0.15` |
| `ROUTE_STROKE_W` / `ROUTE_STROKE_W_RUN` / `CHEVRON_STROKE_W` | `4` / `7` / `3` |
| `VIEWER_DP_EPSILON_M` | `2` |

**Colour: a dark casing, not white.** Chevrons stay blind to segment kind (they
carry direction, not phase). White fails WCAG 1.4.11's 3:1 for non-text graphics
against two of the four segment colours — measured 2.2:1 on warmup orange
`#FF9500` and 2.6:1 on cooldown teal `#30B0C7` (and 3.3:1 on walk grey, itself
marginal), made worse by alpha and by an *inlaid* narrower stroke, and it
vanishes entirely where it overshoots onto a light basemap.
`ROUTE_DIRECTION_COLOR = 'rgba(0,0,0,0.55)'` — the standard cartographic casing
ink — holds against all four vivid hues *and* against light land, and inverts the
overshoot failure mode. Scheme-independent, because MapKit's basemap is not
skinned by the app's theme.

**If chevrons paint *under* the route** (§3: SwiftUI guarantees no intra-array
order, and there is no z-index anywhere to fall back on), the same geometry
becomes a filled `polygons` entry: that `ForEach` is emitted after the whole
`polylines` one, giving builder-level ordering plus a real fill with working
alpha. §7.1's discriminated port is what keeps this an adapter-local change.

## 6. Measured cost and fidelity

Benchmarked against the shipped `domain/geo.ts` on a synthetic W1D1-shaped
track (1710 fixes at 1 Hz, 17 segments, ~2.8 km, Stockholm latitude), then
**independently reproduced** with a different PRNG (§13).

| Metric | Result |
|---|---|
| Full derivation (smooth + chunk + DP + bbox) | mean **1.3 ms**, max **3.6 ms** |
| Vertices after DP | 1710 → **103** (ε=5 m) · 386 (ε=2 m) · 46 (ε=12 m) |
| Polyline chunks | 17 |
| Boundary continuity | **16/16 adjacent pairs share a bit-identical vertex; residual gap 0.00 m** |
| Fitted zoom | 15.9 (3:2 card) · **14.9** (full screen at a real 393×852 pt) |

**Two caveats on these figures.** They exclude `loadRunPoints` — a ~1710-row
`.all()` plus row mapping, paid synchronously in render, and **unmeasured**; the
read is at least index-served (`primaryKey([runId, seq])`). And the vertex/DP
figures come from a **white-noise** track while the pace figures below come from
an **AR(1)** track; under the more realistic AR(1) model the same harness gives
113–153 vertices at ε=5 and a DP shortening of **9–13%**, not 23%. Both are
model-dependent until Milestone-0 tracks exist.

3 ms sits inside a frame, so the memo needs no deferral, and ~100–150 vertices
keeps the per-commit reflection cost (§3) negligible — DP earns its place for
performance, not only appearance.

**Accepted divergence.** DP shortens the drawn path against the smoothed track
(9–13% under AR(1) noise, 23% under white noise) because it cuts the jitter
zigzag. Intended and harmless: ADR 0021 §6 declares the rendered line
presentation-only and forbids deriving distance from it. Recorded so it is not
later mistaken for a bug.

**Stage 3 observation, not Stage 4 scope.** The same harness measured the ADR
0021 smoother under AR(1) (φ = 0.9–0.98) noise. The filter works — it cuts error
3–5× and is exact on a noiseless control — but the residual is pace-dependent:
**+5.6 to +6.8% jogging versus +18.6 to +22.6% walking**, and it is already 3.7%
at 3.2 m/s. This is a law, not an artefact: `relative_excess · speed²` is
constant at 0.38–0.41 across a 3.2× pace range, both duration- and
distance-matched, because `E|s·û + n| ≈ s + σ⊥²/(2s)` per step gives a relative
excess of `σ⊥²/(2s²Δt)` — **quadratic** in 1/pace. C25K week 1 is ~62% walking.

The prescribed remedy is confirmed to work: sweeping `KALMAN_PROCESS_NOISE` down
100–300× takes walk error to 4.7–6.8% and jog to 1.4–2.0%. **But the existing
CV-walker test returns exactly 82.60 m at every `q` value** — the fixture is
perfectly constant-velocity, so the CV model is exact regardless — meaning the
suite has *no guard against over-smoothing* and Milestone-0 tuning would have no
regression net. Both belong to Stage 3's distance path and must be validated
against real device tracks, not synthetic noise. Rendering is unaffected: DP
removes exactly the jitter that inflates the number. See §11 for the sequencing
consequence.

## 7. Components and screens

### 7.1 The `RouteMap` component port

First component port in the codebase (ADR 0003 §5, which sanctions component
ports "under `components/`" — `route-map/` is therefore legal alongside ADR
0013's four layers, not a violation of them), mirroring
`services/location-tracker`'s triplet: `port.ts` (types only),
`adapter.ios.tsx` (export explicitly annotated with the port type, per ADR 0003
§2), `index.ts` (re-export, no composition wrapper — no cross-platform gating
seam).

```ts
interface RouteMapLine { id: string; points: LatLng[]; color: string; width: number }
interface RouteMapRoute { lines: RouteMapLine[] }          // segment-coloured chunks
interface RouteMapDecoration extends RouteMapLine { closed: boolean }  // chevrons

interface RouteMapProps {
  route: RouteMapRoute;
  decorations: RouteMapDecoration[];
  endpoints: { start: LatLng; finish: LatLng } | null;
  camera: CameraFit;
  interactive: boolean;
  /** Applied only when `interactive` is false — see the accessibility note. */
  accessibilityLabel?: string;
  onPress?: () => void;               // card only
  style?: StyleProp<ViewStyle>;
}
```

Route and decorations are **discriminated rather than flattened into one
ordered array**. A flat list would force the adapter to sniff `id` strings to
find the chevrons, so the `polygons` fallback (§5) would ripple through the
port, the hook and both screens instead of staying adapter-local — and it would
bake a paint-order guarantee into the port that §3 shows the renderer does not
provide. `closed` is what lets a decoration switch between a stroked polyline
and a filled polygon without a port change.

The adapter owns everything expo-maps-specific: mapping to `AppleMapsPolyline`
with deterministic ids (`seg-3`, `arrow-5`); two `AppleMapsMarker`s
(`figure.run` / `flag.checkered`, tinted, **empty titles**) for the endpoints,
collapsing to a single marker when they are within `ENDPOINT_MERGE_M` of each
other — beginners run loops and out-and-backs from their front door, so two
unsizable balloons would otherwise stack on the route's most interesting point;
the props §3 shows are needed for a calm read-only map (`uiSettings` all four
**explicitly false** — three default true; `selectionEnabled: false`;
`pointsOfInterest: { including: [] }`; `emphasis: MUTED`; `colorScheme:
AUTOMATIC`; `contourStyle: STRAIGHT`); and an always-present `cameraPosition`
passed as a **prop**, never the mount-time ref.

Non-interactivity is RN-side, because §3 shows no lock is reachable through the
JS surface. `Pressable` → `View pointerEvents="none"` → map. The mechanism is
verified: `RCTViewComponentView.mm:773-786` returns `nil` from `hitTest:` for
`PointerEventsMode::None` and `:347` sets `userInteractionEnabled = NO`, so the
whole subtree — including the hosting view — is unreachable to MapKit's gesture
recognisers.

**Accessibility is a verification item, not a settled claim.** §3 establishes
that `AppleMaps.View` is an `ExpoSwiftUI` hosting view — the same class as an
`@expo/ui` `Host` — so ADR 0005's amended rule applies: RN that *overlaps* a
host can lose its accessibility identity, which is exactly the PR #33 failure
recorded in this project's history. Here the `Pressable` is the map's **parent**,
not a positioned sibling, which is the sanctioned containment idiom and is
expected to be fine — but "expected" is not "verified", and the composed label
is the entire a11y and Maestro story for the card. §10 must confirm it via
`inspect_screen`. **Fallback if it does not surface:** move the tap affordance to
RN laid out *beside* the map inside the card, the shape ADR 0005 proves works
(`run-summary/[id].tsx:81-99`), rather than reaching for an ADR 0016 id escape
hatch.

The card is one `accessible` group with `accessibilityRole="button"`, a label
naming the route ("Map of your 2.1 km route") and the activation phrasing in
`accessibilityHint` — not appended to the label, which would duplicate what
VoiceOver already says for a button. The grouping lives in **one** place: the
adapter, when `interactive` is false. The viewer is deliberately not flattened —
that would collapse MapKit's own elements — but is not left mute either: it gets
a route-summary label on the map's container plus a real screen title, since a
polyline overlay has no accessibility representation of its own and the card's
summary would otherwise be lost on the way in.

### 7.2 Summary card

`src/components/route-map-card.tsx` — ADR 0013 domain component: owns its
`Card surface="card"` chrome with `p-0 overflow-hidden aspect-[3/2]` (the map
goes edge-to-edge inside the squircle, Apple Fitness-style, so the default `p-4`
is dropped), composes the label from `run.distanceM`, and opens the viewer.
The fixed aspect ratio means the card holds no text and so never fights Dynamic
Type, unlike the tiles that reflow at `fontScale >= 1.6`.

**A visible expand affordance is required**, not optional: the card is
non-interactive by construction, which is precisely the signal that reads as
"static image". A small `arrow.up.left.and.arrow.down.right` chip in a corner
(the Photos/Fitness idiom) plus a pressed state on the `Pressable`. This is also
the only visible cue at accessibility text sizes.

It sits **directly under `RunSummaryHeadline`**, above `RunStatGrid`. With GPS
the grid is six tiles in three rows under a headline and a large title, so
placing the map after it puts the route below the fold on an SE-class screen
while the fresh-finish "Done" footer invites the user to leave — inverting the
emotional hierarchy for a beginner, whose route *is* the reward. The colour
legend consequently sits a scroll below rather than directly beneath, which the
width double-encoding (§7.3) is what makes tolerable.

### 7.3 Route colouring

Segment kind is encoded by **hue and stroke width together**: run segments at
`ROUTE_STROKE_W_RUN`, all walking phases (warmup/walk/cooldown) at
`ROUTE_STROKE_W`. Hue alone was the original plan and is not defensible here.
W1D1 alternates run/walk eight times, so at card scale the route is ~16
alternating runs of roughly 20–50 pt — which reads as a dashed or glitched line,
not as phase information, while the legend insists it is meaningful. `width` is
a free second channel the API already provides (§3), and it also carries the
run/walk distinction for colour-vision-deficient users, for whom cooldown teal
and walk grey collapse under tritanopia. The app's other surfaces get away with
hue alone because they also carry position and proportion; a map has neither.
§10 must still settle legibility on the simulator.

### 7.4 Full-screen viewer

`src/app/run-route/[id].tsx`, registered in the root `Stack` as
`presentation: 'modal'`, title **"Route"**, with a `Stack.Toolbar` `xmark`
labelled **"Close map"** whose handler is `router.back()`.

Three corrections to the first draft, all from review:

- **`presentation: 'modal'`, not `fullScreenModal`.** The original justification
  — that a toolbar `xmark` is "already-proven" for Maestro — is contradicted by
  `log-revisit.yaml:24-29`, which states the summary's xmark "has no text-first
  target (ADR 0016)" and dismisses with a coordinate swipe instead; no shipped
  flow taps it. And `fullScreenModal` is the one iOS presentation with **no**
  dismiss gesture, so a user who has pinch-zoomed into their route would have
  exactly one small glyph as an exit, and §10's round trip would be unwritable
  if that glyph does not resolve. `modal` inherits the swipe-down dismissal this
  repo has already shipped, and keeps the xmark as redundancy.
- **`router.back()`, not `dismissAll()`.** The summary's xmark calls
  `router.dismissAll()` (`_layout.tsx:103-109`), so "mirroring" it literally
  would unwind to the Plan tab and discard the summary — including an
  un-acknowledged "Done" on a fresh finish.
- **A distinct `accessibilityLabel`.** The summary's is "Close"; two
  simultaneous "Close" elements across stacked modals would make the §10
  dismissal ambiguous, which ADR 0005's lingering-form-sheet observation shows
  is a live risk.

Nesting a modal over the summary's modal is fine — the app already stacks
`session/[key]` (formSheet) → `run` (fullScreenModal) → `run-summary/[id]`
(modal) in one root Stack. Header options are set once at registration and never
toggled, per the verified gotcha that toggling `headerShown` on an in-flight
modal freezes the screen.

The screen live-queries `runSegments` for its `id` (an approved live-query table
scoped to a fixed `run_id`), gates on the loaded idiom (§4.3), and calls
`useRunRoute` with ε=2 m and the **content box's** aspect ratio — the window
minus the nav bar and safe-area insets, not the window itself, since the map
does not fill it. Being independently deep-linkable, it handles a bad `id` with
the shared unavailable-state component (§7.5).

### 7.5 Shared unavailable state

The viewer needs the same "run unavailable" branch the summary already has
(`run-summary/[id].tsx:56-75`, ~20 lines). Promote it to
`src/components/run-unavailable.tsx` in this PR rather than copying it — a
second copy is exactly the "concepts without modules" smell ADR 0013 opens with.

## 8. Degradation

The predicate is **route extent, not point count**. A stationary or indoor run
with permission *granted* produces plenty of `run_points` — ADR 0021's
near-stationary deadband suppresses the drift into `distanceM = 0`, which is why
`complete-session.yaml:21` can assert `assertNotVisible: "Distance"` on a run
that has fixes. Gating on point count alone, every check passes: ~40
near-identical fixes → 17 chunks that survive DP (endpoints are always kept) →
`ready: true` → degenerate bbox → floored by `MIN_SPAN_DEG` → **a coloured dot on
a street map of the user's front door**, on a screen people screenshot and share.
A treadmill run in February is an entirely normal thing for a C25K beginner.

`ready: true` therefore additionally requires a minimum bounding-box diagonal
(`MIN_ROUTE_EXTENT_M`) and at least two distinct post-DP coordinates.

| Case | Behaviour |
|---|---|
| Location denied | `RouteUnavailableCard` — "No route for this run", one honest line, and the Enable-Location / Open-Settings affordance the run screen already owns via `useLocationPermission`. |
| Permission granted, no usable route (indoor, treadmill, GPS never fixed) | Same card, **different copy** — the user did nothing wrong, so the copy must not imply they did, and must not draw a map of their home. |
| Fewer than 2 smoothed points | Same card. |
| GPS gap | Rendered as a genuine break; no chevron bridges it. |
| Deep link to a missing run | `RunUnavailable` (§7.5). |

Silent absence — the first draft's answer — is wrong for this app. Location is
genuinely optional (the primer ships a "Not Now", ADR 0008 §5 degrades rather
than blocks, master spec §11 promises "Session fully works… no distance/route",
and `run-denied-path.yaml` is a first-class journey), so a real cohort will
finish *every* run with no route. The run screen is honest about exactly this
("Location is off… Open Settings"); going quiet afterwards abandons the user at
the one moment they are motivated to act. `SegmentSplits`' silent omission is
not a precedent: there, the grid has already dropped Distance and Avg Pace, so
the absence is legible.

**No iOS-version gate is needed.** expo-maps renders `EmptyView()` below iOS 17,
but the 17.0 floor (§9) means no such device can install the app — so that
branch is unreachable and a check guarding it would be dead code.

## 9. Build config and ADR impact

- `bun expo install expo-maps` → `~57.0.1`. **No `expo-build-properties`.**
- `app.json` gains `"ios": { "deploymentTarget": "17.0" }` — the **built-in**
  SDK 57 property (`@expo/config-types` `ExpoConfig.ios.deploymentTarget`,
  implemented by `@expo/config-plugins` `ios/DeploymentTarget.js:54-76`).
  `expo-build-properties`' equivalent option is **deprecated since SDK 56**
  ("use built-in `ios.deploymentTarget` property instead") and would drag in a
  dependency plus four unrelated `Podfile.properties.json` side effects. The
  built-in property rewrites the app target's `IPHONEOS_DEPLOYMENT_TARGET`
  (leaving Pods at 16.4, as every SDK 57 app does), which is what actually gates
  App Store installs via `MinimumOSVersion`.
- `expo-maps` needs **no** plugin entry and **no** Info.plist key: it autolinks,
  its bundled plugin bails unless `requestLocationPermission` is explicitly set,
  and `isMyLocationEnabled` defaults false so no `UserAnnotation()` and no
  prompt. `app.config.ts` already spreads `config.ios` and `config.plugins`, so
  no variant work.
- **Fingerprint:** a new autolinked native module plus a config change alters the
  hash. The `e2e-ios` cache misses on this PR, forcing one full
  `eas build --local` (~20 min) instead of a repack, then re-caching; the next
  release takes the native build → manual approval → submit path. Both correct
  for a native change. `fingerprint.config.js` is **not** touched.
- **Two practical consequences worth planning for.** `expo-maps` throws at
  import when its native module is absent (§3), so the first `e2e-refresh` after
  this lands **must** be a full rebuild — a JS repack into a pre-Stage-4 `.app`
  fails at import, not subtly. And `e2e.yml:47` is `timeout-minutes: 45` against
  a ~20 min build plus boot, install and the whole suite: the first run may fail
  on timeout and read as a flake, and because `actions/cache` writes are
  branch-scoped, the first run on `main` after merge pays the full build again.
- Local `bun run start` recompiles native once.

**ADR 0010 amendment (required).** Its §1 mechanic ("`expo-build-properties`
sets `ios.deploymentTarget: "18.0"`") is wrong twice over: the tool's option is
deprecated, and the version rests on a README claim the package's own podspec,
its complete iOS-17 renderer, `isMapsAvailable`, and the SDK 57 docs all
contradict. The floor becomes **17.0** — the minimum at which a map renders at
all — set through the built-in property. The amendment should also record the
framing the original ADR missed: the app's *current* effective floor is 16.4
(nothing being set), and 16.4 still supports iPhone 8/8 Plus/X, whereas **both**
17.0 and 18.0 drop that hardware. The real choice was never 17-vs-18 but whether
to drop 2017 iPhones — taken deliberately so every user who can install gets the
same experience rather than a silently blank map (objection recorded in §13).
It should further record the verified camera formula and its `f` term, the `id`
identity requirement, that the missing interaction lock is a *wrapper gap* with
an upstream fix available rather than a platform limitation, the paint-order
caveat, and the narrow §4.3 deviation on where camera fit is invoked.

**ADR 0021** flips from *Proposed* to *Accepted* (implemented and shipping). Its
§6 DP assignment to Stage 4 is satisfied by `toSegmentPolylines`; the promise
that distance never derives from the rendered line is preserved (§6).

**Master spec deviations to fold back:** §8/§13's `runs/[runId]` screen is
dropped; §8's accent/muted colouring is replaced by the 4-kind palette plus
width; §13's Stage 4 bullet gains the direction arrows. **Open for Stage 5:**
master spec §9 assigns the `healthkit_saved` retry affordance to the deleted run
detail screen; it needs a new home, presumably the summary.

## 10. Testing

**`bun test`** — extending `domain/geo.test.ts`:

- `smoothTrackForRender`: correct `segmentSeq` tagging; `gapBefore` false on the
  first point and on an ordinary transition, true exactly past `MAX_GAP_S` (not
  *at* it); seed points dropped, verified with a 45 m cold-start fix that must
  not appear in the output or move the bbox.
- `toSegmentPolylines`: adjacent non-gap chunks share a bit-identical boundary
  vertex; chunks across a gap are disjoint and the second carries `gapBefore`;
  a mid-segment gap yields two chunks with one `segmentSeq`; a **zero-point
  segment** does not break continuity; a single-point segment is rescued by the
  prepend (the compressed-plan case); sub-2-point chunks dropped.
- `chevronsAlongRoute`: none below `CHEVRON_MIN_RUN_LENGTH_M`; none bridging a
  gap; **an out-and-back fixture yields no pair of opposed arrows closer than
  `sizeM`**; **arrow count stays near `CHEVRON_TARGET_COUNT` as the number of
  GPS gaps varies from 0 to 5**; on-screen size (`sizeM / fittedSpanM`) stays
  within a narrow band across the five route archetypes (park loop, W1D1 loop,
  out-and-back, 5 km point-to-point, laps of a 400 m track); a duplicated
  boundary vertex never produces a due-north bearing.
- **Bearing, at three latitudes.** A due-north and a due-east fixture are
  worthless on their own: those are exactly the two bearings at which a missing
  `cos(latitude)` term produces *zero* error, so a broken implementation passes.
  The test must use a **north-east** fixture at Stockholm latitude and assert the
  tip is at equal *metre* offsets north and east (a `cos(lat)`-less
  implementation is 18° off there), repeated at latitude 0 and 60.
- `cameraForBoundingBox`: centres on the bbox midpoint; the returned span
  contains the bbox for a square aspect, for `A·f > 1`, **and for `A·f < 1`**
  (the real full-screen regime, and the only branch where the second `max()`
  term is load-bearing); slack per side equals `p/(1+2p)`; a near-single-point
  bbox floors to `MIN_SPAN_DEG`; zoom decreases monotonically as the bbox grows.

**Maestro** — extend `.maestro/tests/run-distance.yaml`. The steps go **between
`assertVisible: "Avg Pace"` (line 43) and the `"Interval Pace"`
`scrollUntilVisible` (line 44)** — not after the `"Fastest"` assertion, by which
point the flow has already scrolled past the card and `scrollUntilVisible`
defaults to scrolling further away, with the closing `assertVisible: "Distance"`
no longer on screen. The anchor must be a **pattern** (`"Map of your .* route.*"`)
because the flow travels ~100 m, so any literal distance in the label cannot
match. Then tap, assert the "Route" title, dismiss by swipe, and re-assert
`"Distance"` for the round trip. Selectors grounded with `inspect_screen` per ADR
0016; the map itself is never asserted against.

**Simulator (argent + Maestro)** — what cannot be unit-tested:

1. **Paint order** — chevrons above the route, markers above both (§3); if not,
   switch decorations to `polygons`.
2. **Framing tightness** — assert the route touches neither edge on a short
   loop *and* a long point-to-point, in both bbox aspect regimes. This is the
   check that validates the expand-only assumption everything in §4.2 rests on.
3. Chevron legibility against all four segment colours **and** against light
   basemap land, in light and dark. Resolve §5's sizing first, or this measures
   the wrong thing.
4. **Route legibility** at card size on a 17-segment W1D1 track — does the
   hue+width encoding read as phases rather than as a dashed line (§7.3)?
5. `cameraPosition` sticking on first paint without the ref.
6. The card not stealing `ScrollView` drags; tap opening the viewer; pressed
   state visible.
7. **The card's `accessible` group surfacing in `inspect_screen`** with its
   composed label, and tappable by text (§7.1). This gates the Maestro plan.
8. Squircle clipping of the hosting view under `overflow-hidden`.
9. Endpoint markers: balloon size acceptable, and the merge rule firing on a
   loop.
10. **Memory** — open the viewer over the card (two live map views on the same
    route), then browse 5+ runs from the Log, watching footprint. Each map is a
    `UIHostingController` + SwiftUI `Map` with its own caches, released only when
    it leaves the window.
11. Light↔dark switch **with the map on screen** — `colorScheme: AUTOMATIC`
    skips the modifier entirely and inherits the hosting controller's traits,
    which is exactly the kind of propagation that silently fails.
12. **The iOS 17 render path, on the local iOS 17.5 runtime.** The 17.0 floor
    ships a *second* Swift renderer (`AppleMapsViewiOS17`), and CI will never
    exercise it — `e2e.yml:124-125` picks an arbitrary iPhone from whatever
    runtimes the `macos-26` runner ships. It is verifiable locally: iOS 17.5 and
    18.6 runtimes are both installed. Because the branch is
    `#available(iOS 18.0) / #available(iOS 17.0)`, **any** 17.x runtime exercises
    the same code path as 17.0, so 17.5 is a faithful test of the floor.
    The 17.5 runtime currently has **no device**, so create one first
    (`xcrun simctl create` — outside argent's tool surface, which boots existing
    devices; the argent rule sanctions `xcrun` for exactly this kind of device
    management). Then install the dev build and smoke the map: route and chevrons
    render, camera fits, no compass / pitch / my-location controls, and — since
    `selectionEnabled` and the tap handlers are iOS-18-only — confirm a tap on
    the viewer's map does nothing untoward. Run item 1 (paint order) on 17.5 as
    well as 18.6: the two renderers build their content in the same declaration
    order but are separate code paths, so ordering must be confirmed on both.

Polyline pixel-correctness stays a visual check per master spec §13.

## 11. Risks

| Risk | Mitigation |
|---|---|
| SwiftUI doesn't honour intra-array polyline order | Decorations re-emitted as `polygons`, builder-ordered after polylines (§5); the discriminated port keeps it adapter-local. No z-index exists anywhere as a fallback. |
| **MapKit's SwiftUI region fit is crop, not expand** | Undocumented for SwiftUI (§3). If wrong, the aspect correction inverts and >50% of a route can be lost. §10.2 asserts framing tightness explicitly. |
| **A future expo-maps patch fixes the `cos(0)` bug** | `latitudeDelta = longitudeDelta / cos(lat)` would silently zoom out ~2× at Stockholm and not at all at the equator — a latitude-dependent regression no unit test can see. Re-verify the `f` term against `MapUtils.swift` on **every** expo-maps bump; the version is pinned. |
| expo-maps alpha churn generally | Pinned; port boundary; react-native-maps pre-approved with ADR 0010 §3 triggers. |
| Prop commits re-converting every coordinate | Value-stable props; DP keeps vertices ~100–150 (§6). |
| Two live map views + several summary screens | §10.10 memory check; consider unmounting the card's map while the viewer is presented. |
| iOS 26 MapKit churn (the package carries a documented iOS 26 tap workaround) | Read-only surface uses no tap handling; sim-verified per release. |
| **Stage 4 makes Stage 3's walk-pace error visible for the first time** | Until now nobody could sanity-check "2.80 km"; with a route on screen, a beginner who ran four laps of a known 400 m track can see the number is wrong (§6). Decide explicitly whether Stage 4 ships before or after Milestone-0 validation. |
| iOS 17.x render path never exercised by CI | Verified locally instead: the iOS 17.5 runtime is installed and exercises the same `AppleMapsViewiOS17` branch as the 17.0 floor (§10.12). Retains a gap only for real 17.x *hardware*, which is the standard simulator caveat. |

## 12. Out of scope

Live map during a run · History row thumbnails (ADR 0005 forbids RN per SwiftUI
row; `summary_polyline` keeps the v2 options open) · map snapshots (no
expo-maps API) · elevation profile (ADR 0015, separate) · route sharing or
export · Android adapter (`adapter.android.tsx` joins later under the same
`moduleSuffixes` mechanism).

## 13. Review dispositions

Three independent adversarial reviewers (platform fitness; geometry and
numerics; repo fit and human consequences), with no shared context, produced 60+
findings. What they confirmed, and the one objection left open:

**Confirmed by independent re-derivation.** The §4.2 camera formula is the
*exact* minimum containing span (40 000 random `(A, lat, bbox)` triples,
`formulaS / trueMinimalS ∈ [0.99962, 1.0000029]`), correct in both aspect
regimes and at every latitude tested. `gapBefore` tagging: 0 mislabels across
372 000 branches. Boundary vertices are shared by object reference, so
bit-identical. Every §6 figure reproduced with a different PRNG. And 24 of the
§3 platform claims were re-derived from source by a second reader, including the
camera conversion quoted line-for-line.

**Corrected in this revision.** Two §3 claims were wrong: "no interaction lock
exists on Apple" (it exists since iOS 14; expo-maps just never passes it) and
`expo-build-properties` (deprecated for this purpose since SDK 56). The ADR 0005
exemption in §7.1 was based on package identity rather than on the mechanism the
ADR actually describes, and both the platform and repo reviewers independently
falsified it. §7.4's entire justification for `fullScreenModal` was contradicted
by `log-revisit.yaml`. §5's chevron sizing was wrong in a way that made arrows
invisible on the app's goal-state run, and its uniform spacing put half the
arrows head-to-head on an out-and-back. §8 was keyed on the wrong predicate,
which would have drawn a map of the user's home for a treadmill run. §10's
bearing tests were blind to the likeliest bearing bug. Plus the seed-point spur,
the global spacing grid, the duplicate-vertex bearing, the two-memo split, the
`loadRunPoints` consolidation, the white chevron's contrast failure, the missing
expand affordance, the card's placement, the `dismissAll` hazard, and the Maestro
insertion point.

**Open objection — the iOS floor.** One reviewer argued to keep 16.4 and gate
the map at runtime instead: under a 17.0 floor, iPhone 8/8 Plus/X owners lose
*the whole app* (coach, cues, timer, distance, splits), whereas under 16.4 plus
a gate they lose *one card* — and for a free C25K app aimed at beginners on
older hardware, whose value is the coaching rather than the cartography, that
trade points the other way. It also noted that §8's "dead code" argument is
circular (the check is only dead *because* the floor was raised) and that ADR
0010's adoption statistics measure the iOS-18-vs-17 software tail, not the
iPhone 8/X hardware cohort this actually excludes. The floor was chosen
deliberately for a uniform experience and stands; the reasoning is recorded here
so the ADR amendment can carry the counter-argument rather than bury it.
