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
| Run detail screen | **No second detail screen.** The map card goes into the existing summary, which already serves both fresh-finish and Log-revisit. Supersedes master spec §8/§13's *screen split* — but not its route naming, see below. |
| Route naming | The summary moves `run-summary/[id]` → **`runs/[runId]/index`**, and the viewer is its child **`runs/[runId]/route`** (§9.1). Clearer intent, and it restores master spec §8's `runs/[runId]` naming. |
| Summary map | **Non-interactive**, camera-fitted preview in a `Card` directly under the headline, with a visible expand affordance; tapping it opens the viewer. |
| Full-screen viewer | `runs/[runId]/route`, presented as **`presentation: 'modal'`** — swipe-down dismissal, with a toolbar `xmark` as redundancy (§7.4). |
| Polyline colours | The existing **4-kind palette** (`useSegmentColors()`), **double-encoded with stroke width** so phase never depends on hue alone (§7.3). Supersedes master spec §8's accent/muted wording. |
| Direction arrows | **Removed** (§5) — designed, built, adversarially reviewed and verified on device, then dropped after a live look: the start/finish markers already make direction clear enough on their own. |
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
`_MapKit_SwiftUI`** — so array order is the *only* lever for paint order.
Markers/annotations above overlays is documented for UIKit `MKOverlayLevel`
but not for SwiftUI; both need the §10 check.

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
            └─ join segmentSeq → kind → useSegmentColors() (+ width, §7.3)
                 └─ RouteMapRoute (stable ids)
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
interface CameraFit { center: LatLng; zoom: number }

function smoothTrackForRender(fixes: readonly SegmentedFix[]): RenderPoint[];
function toSegmentPolylines(points: readonly RenderPoint[], epsilon?: number): SegmentPolyline[];
function cameraForBoundingBox(bbox: BoundingBox, aspectRatio: number, paddingRatio?: number): CameraFit;
```

`smoothTrackForRender` reuses `smoothFix` — the same reducer the live engine and
the finalize rollup use. A `restarted` step with points already emitted marks a
real mid-track gap, as opposed to the track's first point (also a `restarted`
step); this was brute-force verified sound across 372k branches, including gaps
spanned by velocity-gated fixes, because the gap check runs *before* the gate.
`smoothTrackBySegment` is left untouched.

**`gapBefore` must be carried, not read off the same step.** The naive
`gapBefore = restarted && points.length > 0` is wrong once seed points are
dropped (below): the `restarted` step's own point is never emitted, so the flag
would be computed on a point that does not exist and lost. The fold therefore
holds a pending-gap flag and applies it to the next point it actually emits.

**Seed points are dropped from the render stream only.** `smoothFix` emits the
*raw* measurement for the first fix after a start or gap reset (the `!started`
branch) and again for the next one (`fixesSinceReset === 1` seeds velocity from
two points), and `accuracyFilter` admits up to 50 m. Since
`simplifyPolyline` keeps `keep[0]` unconditionally, a legal 45 m cold-start fix
becomes a **permanent spur** in the drawn line, repeating after every gap, and
inflates the bbox — measured at +24% zoom-out. `smoothTrackForRender` therefore skips points while
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

`cameraForBoundingBox` returns only **`center`** and **`zoom`** — no metric span.
An earlier draft additionally returned `fittedSpanM`, the vertical extent the
camera would show, in metres — chevron sizing (§5) was its only consumer, and
the field was removed along with the chevrons.

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

The hook — not the port — computes the camera, because it already reduces the
same bbox for the extent gate (§8): `endpoints` and the `MIN_ROUTE_EXTENT_M`
check both need the bounding box of the *drawn* chunks (deliberately excluding
any dropped chunk's outlier), so building the camera from that same bbox is
reuse, not duplication. Handing the bbox to `RouteMap` instead would make the
port re-derive "which points are drawn" from the route lines it's given —
redoing a reduction the hook has already done, and risking disagreement with
the extent gate over what counts as the route's extent. This is a deliberate,
narrow deviation from ADR 0010 §2's "`RouteMap` owns the camera-fit math": the
*math* remains a pure, unit-tested helper in `domain/geo.ts`, which is what the
ADR was protecting. Record it in the amendment.

`endpoints` are the first point of the first chunk and the last point of the last
chunk — the route's true extremities even when a gap split the track.

## 5. Direction arrows

**Removed.** Direction-of-travel chevrons synthesised along the rendered route
were designed, built, adversarially reviewed (§13) and verified on the
simulator and device — then removed after the repo owner looked at the shipped
feature on a live device and judged the start and finish markers already make
direction clear enough on their own, without the added visual noise. Added in
`2721a1d` (`feat(geo): synthesise direction chevrons along the rendered
route`) with follow-up fixes `3cd49ca` (`fix(geo): carry gaps past dropped
chunks, dedupe arrows by proximity`) and `027faee` (`fix(theme): make the
route chevron ink scheme-aware`); removed in `543b0de` (`fix(route-map):
remove direction-of-travel chevrons`).

Two platform facts from that work are kept here because they were hard-won on
device and would otherwise be rediscovered by any future overlay work:

- **`AppleMapsPolyline` exposes no dash, arrow, texture or line-cap
  property**, and neither `AppleMapsMarker` nor `AppleMapsAnnotation` exposes
  rotation (§3). Any oriented mark on this map — an arrow, a heading indicator,
  anything direction-carrying — has to be synthesised as raw geometry (extra
  polylines or polygons), never styled onto an existing line or marker.
- **A single ink cannot satisfy WCAG 1.4.11 in dark mode against both the
  basemap and the warmup/cooldown segment hues.** 3:1 against the dark basemap
  (L ≈ 0.014) needs an ink of luminance ≥ 0.141; 3:1 against the brighter
  dark-variant warmup `#FF9F0A` (L = 0.461) and cooldown `#40CBE0` (L = 0.492)
  needs ≤ 0.120 and ≤ 0.131 respectively. Those windows are disjoint, so no
  single ink — at any alpha, since alpha only slides the composite between the
  two bounds — can satisfy both simultaneously. Any future overlay drawn in one
  ink across the whole route will hit the same wall in dark mode.

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

**A second Stage 3 observation, surfaced by the Batch A review: `smoothFix` has a
cliff one second wide below `MAX_GAP_S`.** The seed-drop above (§4.1) removes the
raw cold-start vertex, leaving a ~6.9 m decaying excursion. But that mitigation
only engages on the *gap* path. Feed the same legal 45 m resume fix after a
dropout **shorter** than `MAX_GAP_S = 30 s` and no reset fires, so nothing is
dropped:

| dropout | 5 s | 10 s | 16 s | 25 s | **29 s** | 31 s |
|---|---|---|---|---|---|---|
| max excursion in the render stream | 3.3 m | 11.4 m | 23.4 m | 35.0 m | **37.8 m** | 6.9 m |
| survives DP at ε=5 and ε=2 | no | yes | yes | yes | **yes** | yes |
| raises `gapBefore` | no | no | no | no | **no** | yes |

So a 29 s dropout — a bus passing, a tunnel, a dense urban canyon — produces an
artefact **5.5× worse than the one the seed drop removes**, on the unprotected
side of the threshold, surviving simplification at both epsilons, inflating the
bounding box by ~38 m, and rendering with no visible break to explain it.

This is `smoothFix` behaviour and therefore ADR 0021's, not Stage 4's — the render
fold is merely the first consumer that can see it. It is recorded here rather than
fixed because the honest resolution belongs with the other Milestone-0 tuning
against real device tracks: the same `KALMAN_PROCESS_NOISE` sweep that fixes the
walk-pace residual also damps this excursion, and choosing `MAX_GAP_S` against
real dropout-length data is a better answer than special-casing the render path.
Deliberately **not** worked around in `smoothTrackForRender`: a render-only
heuristic would make the drawn line disagree with the distance, which ADR 0021 §3
exists to prevent.

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

interface RouteMapProps {
  route: RouteMapRoute;
  endpoints: { start: LatLng; finish: LatLng } | null;
  camera: CameraFit;
  interactive: boolean;
  /** Applied only when `interactive` is false — see the accessibility note. */
  accessibilityLabel?: string;
  onPress?: () => void;               // card only
  style?: StyleProp<ViewStyle>;
}
```

The adapter owns everything expo-maps-specific: mapping to `AppleMapsPolyline`
with deterministic ids (`seg-3`); two `AppleMapsMarker`s
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
that would collapse MapKit's own elements — but is not left mute either: since a
polyline overlay has no accessibility representation of its own and the card's
summary would otherwise be lost on the way in, it carries a route-summary label on
a sibling node, plus a real screen title. Two constraints pin that node's shape,
and they nearly cancel: it cannot go on the wrapper, because `accessible` there is
exactly the flattening the previous sentence rules out — and it cannot be
positioned *over* the map either, because ADR 0005's overlap rule costs RN the very
accessibility identity the node exists for, which is the shape of that ADR's own
"RN 'Done' unfindable beneath a lingering form sheet". So it is laid out **in flow
above** the map (1 pt tall, `pointerEvents="none"`): a real, non-empty frame that
never intersects the host. A zero-size node is not an option either — VoiceOver
skips empty frames, so it would be a silent no-op. Its wording differs from the
card's, because `presentation: 'modal'` leaves the card in the hierarchy underneath
and §7.4's two-"Close" hazard applies to any duplicated label. §10.6 must confirm
it surfaces; the rule is empirical, so nothing here is settled without the check.

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

`src/app/runs/[runId]/route.tsx`, registered in the root `Stack` as
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
`session/[key]` (formSheet) → `run` (fullScreenModal) → the summary (modal) in
one root Stack. Header options are set once at registration and never
toggled, per the verified gotcha that toggling `headerShown` on an in-flight
modal freezes the screen.

The screen live-queries `runSegments` for its `id` (an approved live-query table
scoped to a fixed `run_id`) — and `runs`, the way the summary does, for the distance
its accessibility label is composed from — gates on the loaded idiom (§4.3), and
calls `useRunRoute` with ε=2 m and the **content box's** aspect ratio — the window
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

`ready: true` therefore additionally requires the **drawn** route's own extent: the
bounding-box diagonal, in metres, over the coordinates of the *kept* chunks
(`boundingBoxDiagonalM`, against `MIN_ROUTE_EXTENT_M`). Measuring the kept chunks
rather than every render point keeps an outlier that nothing draws out of the
predicate, and the 60 m threshold subsumes "at least two distinct post-DP
coordinates" — a repeated coordinate measures 0 m.

**The gate must never read a camera property.** The first implementation gated on
`cameraForBoundingBox`'s `fittedSpanM`, which fails twice over. It is
aspect-dependent (§4.2), so a borderline-short route can clear the gate at the
card's 3:2 and fail it at the viewer's ~0.55 — the user taps a working map and
lands on "This run isn't available". Worse, it can never reject anything:
`fittedSpanM` derives from `max(neededDeg, MIN_SPAN_DEG) · (1 + 2·padding)` scaled
by `max(f, 1/A)/f`, which is ≥ 1 by construction, so its floor is
`0.0005 · 1.3 · 111 195 ≈ 72.3 m` — above `MIN_ROUTE_EXTENT_M` at every latitude
and aspect tested. The treadmill case this section exists to prevent was therefore
shipping: four stationary fixes leave two post-seed render points on one
coordinate, `simplifyPolyline` returns a copy for ≤ 2 points so the chunk survives
the `< 2` drop, and the card renders a 72 m window on the runner's front door with
a pin in it. The same route measures 0 m of drawn extent. Both the measure and that
pipeline are unit-pinned (`geo.test.ts`, "route extent gate").

`fittedSpanM` itself was later deleted — direction chevrons (§5) were its only
consumer, and once they were removed nothing else read it. Its removal retired
the regression test that pinned this bug (`cameraForBoundingBox(...).fittedSpanM`
compared against `MIN_ROUTE_EXTENT_M`), but that is a strict improvement, not a
loss of coverage: with no `fittedSpanM` field left on `CameraFit`, a reversion to
the old, camera-based predicate now fails `tsc` before it can even run, rather
than passing a green suite the way it did when a reviewer tried exactly that
revert in an isolated clone. The bug is not merely tested against — it is
unrepresentable.

| Case | Behaviour |
|---|---|
| The run recorded no fixes at all (location off, or GPS never fixed) | `RouteUnavailableCard` — "No route for this run" plus one honest line. **The reason is read from the run row, never from today's permission:** `save-run` nulls `summary_polyline` iff zero fixes were accepted, and that is the only per-run record of which case this was. Branching on the live permission relabels history — deny, record three runs, then grant, and all three are suddenly blamed on a treadmill. |
| Fixes recorded, no usable extent (indoor, treadmill, stationary) | Same card, **different copy** — the user did nothing wrong, so the copy must not imply they did, and must not draw a map of their home. |
| Location not granted *now* | Adds the CTA, and only the CTA: `Open Settings` when `denied`, `Enable Location` when `undetermined` — iOS shows no Location row at all for an app that has never asked, so Settings is a dead end for that cohort — and nothing while `useLocationPermission()` is still `null`. Mirrors `run-location-banner` (ADR 0008 §2). |
| Fewer than 2 smoothed points | Same card. |
| GPS gap | Rendered as a genuine break — the chunks either side share no vertex, so nothing draws across it. |
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

### 9.1 Route rename

The summary becomes a directory so the viewer can be its child:

```
src/app/run-summary/[id].tsx   →   src/app/runs/[runId]/index.tsx
                          (new)    src/app/runs/[runId]/route.tsx
```

`/runs/[runId]` reads as the run's own surface and `/runs/[runId]/route` as a
view of it, which `run-route/[id]` only implied. It also **restores master spec
§8's route naming** — §8 chose `runs/[runId]` specifically "to avoid colliding
with the `/history` tab route", and since that tab is now `log` there is no
collision from either direction. The remaining deviation from §8 is only the
screen *split*, not the naming.

**No `_layout.tsx` goes in that directory.** expo-router only creates a nested
navigator where one exists, so both files stay flat entries in the **root**
Stack with their own `presentation` options — which is what ADR 0006 requires.
Registered as `name="runs/[runId]/index"` and `name="runs/[runId]/route"`.

Mechanical changes, all five current call sites:

| File | Change |
|---|---|
| `src/app/_layout.tsx:100` | `name="run-summary/[id]"` → `"runs/[runId]/index"`, plus the new `"runs/[runId]/route"` screen |
| `src/app/run.tsx:6,54-55` | import site (below) and `pathname: '/runs/[runId]'`, `params: { runId, celebrate: '1' }` |
| `src/app/resume-run.tsx:35` | same pathname/param rename |
| `src/app/(tabs)/log/index.tsx:88` | same pathname/param rename |
| the screen itself | `useLocalSearchParams<'/runs/[runId]'>()` now yields `runId`, not `id` |

**`UNSAVED_RUN_ID` moves out of the screen.** Today `run.tsx:6` imports it from
the summary *route module* — one screen reaching into another, which ADR 0013's
"screens compose only" argues against, and which would otherwise become the
odd-looking `@/app/runs/[runId]`. Relocate it to `src/constants/routes.ts`. The
sentinel's behaviour is unchanged: a dynamic segment cannot be empty, so a failed
save still routes with it and the screen renders the save-failure state.

**The rename is E2E-neutral.** No `.maestro/` flow references either route —
they navigate by tapping and assert visible text, and none uses `openLink`. This
removes the only objection to nesting raised earlier in the design.

Two follow-through items the implementation must not skip. **Typed routes**: the
new route literals do not type-check until Metro regenerates
`.expo/types/router.d.ts` (start `bun expo start`, kill it once the file
appears) — the caveat AGENTS.md already documents. And **stale path pointers**:
`AGENTS.md` and ADRs 0005, 0006 and 0023 all name `run-summary/[id]`. ADR 0006's
route inventory and AGENTS.md are live descriptions of the app and must be
updated; ADR 0005's and 0023's mentions are historical evidence with line
numbers, so update the *path* only and leave the reasoning and line references
as the record of what was observed when. For the same reason, every
`run-summary/[id].tsx:NN` citation in *this* spec refers to the file at its
pre-rename path.

The deep link changes from `runbro://run-summary/<id>` to `runbro://runs/<id>`;
nothing in the repo or the flows uses either.

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

**Master spec deviations to fold back:** §8/§13's *separate* run-detail screen is
dropped, though its `runs/[runId]` route naming is now honoured (§9.1); §8's
accent/muted colouring is replaced by the 4-kind palette plus width; §8's route
tree gains `runs/[runId]/route`; §13's Stage 4 bullet gains the direction arrows.
**Open for Stage 5:**
master spec §9 assigns the `healthkit_saved` retry affordance to the deleted run
detail screen; it needs a new home, presumably the summary.

## 10. Testing

**`bun test`** — extending `domain/geo.test.ts`:

- `smoothTrackForRender`: correct `segmentSeq` tagging; `gapBefore` false on the
  first point and on an ordinary transition, true exactly past `MAX_GAP_S` (not
  *at* it); seed points dropped, verified with a 45 m cold-start fix whose
  residual **decays** — no emitted point keeps a quarter of the injected error,
  and the tail converges inside `DP_EPSILON_M`, where no spur survives DP. (The
  residual is inherent: the filter seeds velocity from two points, so the peak is
  6.9 m at the third emitted point. Asserting a maximum instead fits the
  observation and fails on other legal 50 m cold starts.)
- `toSegmentPolylines`: adjacent non-gap chunks share a bit-identical boundary
  vertex; chunks across a gap are disjoint and the second carries `gapBefore`;
  a mid-segment gap yields two chunks with one `segmentSeq`; a **zero-point
  segment** does not break continuity; a single-point segment is rescued by the
  prepend (the compressed-plan case); sub-2-point chunks dropped — and a dropped
  chunk **hands its `gapBefore` to the next kept one** (a single-point post-gap
  chunk otherwise takes the break with it, and the next drawn line would
  otherwise read as continuous across it).
- `cameraForBoundingBox`: centres on the bbox midpoint; the returned span
  contains the bbox for a square aspect, for `A·f > 1`, **and for `A·f < 1`**
  (the real full-screen regime, and the only branch where the second `max()`
  term is load-bearing); it is also **tight** — on a non-square bbox the binding
  axis carries exactly the padding and no more, which containment alone never
  checks; slack per side equals `p/(1+2p)`; a near-single-point bbox floors to
  `MIN_SPAN_DEG`; zoom decreases monotonically as the bbox grows; a non-finite
  or non-positive aspect ratio falls back to a square viewport.
- **The route-extent gate** (§8) — the one predicate that shipped with no unit
  cover at all: `boundingBoxDiagonalM` in metres; 0 m for a drawn line that never
  leaves one coordinate; a **stationary four-fix run rejected** end-to-end through
  `smoothTrackForRender` → `toSegmentPolylines`; an outlier inside a dropped chunk
  not counted; a real route clearing it. (The regression pin that instead proved
  the old, camera-based predicate could never reject that same run was retired
  once `fittedSpanM` was deleted — §8 records why that bug is now unrepresentable
  rather than merely untested.)
- `toRouteLines` (`domain/route-render.ts`) — the hook's mapping stage, extracted so
  it is reachable without a React runtime: kind → colour per chunk, only run
  intervals thick, deterministic `seg-N` ids in drawing order, chunk points passed
  through by reference (the boundary-sharing guarantee), and a chunk whose
  `segmentSeq` matches no row drawn as **walk** — the fallback ADR 0021 §4 and
  `save-run`'s own `__DEV__` invariant warning make load-bearing rather than
  defensive.

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

1. **Paint order** — markers above the route lines (§3).
2. **Framing tightness** — assert the route touches neither edge on a short
   loop *and* a long point-to-point, in both bbox aspect regimes. This is the
   check that validates the expand-only assumption everything in §4.2 rests on.
3. **Route legibility** at card size on a 17-segment W1D1 track — does the
   hue+width encoding read as phases rather than as a dashed line (§7.3)?
4. `cameraPosition` sticking on first paint without the ref.
5. The card not stealing `ScrollView` drags; tap opening the viewer; pressed
   state visible.
6. **The card's `accessible` group surfacing in `inspect_screen`** with its
   composed label, and tappable by text (§7.1). This gates the Maestro plan.
   **And the viewer's label node with it** — same ADR 0005 mechanism, same
   `inspect_screen` evidence standard, and its 1 pt in-flow frame (§7.1) is a
   judgement about where the host's frame ends, not a certainty. If it does not
   surface, move it into the card-shaped fallback §7.1 already names rather than
   positioning it over the map.
7. Squircle clipping of the hosting view under `overflow-hidden`.
8. Endpoint markers: balloon size acceptable, and the merge rule firing on a
   loop.
9. **Memory** — open the viewer over the card (two live map views on the same
   route), then browse 5+ runs from the Log, watching footprint. Each map is a
   `UIHostingController` + SwiftUI `Map` with its own caches, released only when
   it leaves the window.
10. Light↔dark switch **with the map on screen** — `colorScheme: AUTOMATIC`
    skips the modifier entirely and inherits the hosting controller's traits,
    which is exactly the kind of propagation that silently fails.
11. **The iOS 17 render path, on the local iOS 17.5 runtime.** The 17.0 floor
    ships a *second* Swift renderer (`AppleMapsViewiOS17`), and CI will never
    exercise it — `e2e.yml:124-125` picks an arbitrary iPhone from whatever
    runtimes the `macos-26` runner ships. It is verifiable locally: iOS 17.5 and
    18.6 runtimes are both installed. Because the branch is
    `#available(iOS 18.0) / #available(iOS 17.0)`, **any** 17.x runtime exercises
    the same code path as 17.0, so 17.5 is a faithful test of the floor.
    The 17.5 runtime currently has **no device**, so create one first
    (`xcrun simctl create` — outside argent's tool surface, which boots existing
    devices; the argent rule sanctions `xcrun` for exactly this kind of device
    management). Then install the dev build and smoke the map: route renders,
    camera fits, no compass / pitch / my-location controls, and — since
    `selectionEnabled` and the tap handlers are iOS-18-only — confirm a tap on
    the viewer's map does nothing untoward. Run item 1 (paint order) on 17.5 as
    well as 18.6: the two renderers build their content in the same declaration
    order but are separate code paths, so ordering must be confirmed on both.

Polyline pixel-correctness stays a visual check per master spec §13.

## 11. Risks

| Risk | Mitigation |
|---|---|
| **MapKit's SwiftUI region fit is crop, not expand** | Undocumented for SwiftUI (§3). If wrong, the aspect correction inverts and >50% of a route can be lost. §10.2 asserts framing tightness explicitly. |
| **A future expo-maps patch fixes the `cos(0)` bug** | `latitudeDelta = longitudeDelta / cos(lat)` would silently zoom out ~2× at Stockholm and not at all at the equator — a latitude-dependent regression no unit test can see. Re-verify the `f` term against `MapUtils.swift` on **every** expo-maps bump; the version is pinned. |
| expo-maps alpha churn generally | Pinned; port boundary; react-native-maps pre-approved with ADR 0010 §3 triggers. |
| Prop commits re-converting every coordinate | Value-stable props; DP keeps vertices ~100–150 (§6). |
| Two live map views + several summary screens | §10.9 memory check; consider unmounting the card's map while the viewer is presented. |
| iOS 26 MapKit churn (the package carries a documented iOS 26 tap workaround) | Read-only surface uses no tap handling; sim-verified per release. |
| **Stage 4 makes Stage 3's walk-pace error visible for the first time** | Until now nobody could sanity-check "2.80 km"; with a route on screen, a beginner who ran four laps of a known 400 m track can see the number is wrong (§6). Decide explicitly whether Stage 4 ships before or after Milestone-0 validation. |
| iOS 17.x render path never exercised by CI | Verified locally instead: the iOS 17.5 runtime is installed and exercises the same `AppleMapsViewiOS17` branch as the 17.0 floor (§10.11). Retains a gap only for real 17.x *hardware*, which is the standard simulator caveat. |

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
