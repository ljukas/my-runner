# Stage 4 — Maps: Design Spec

**Date:** 2026-07-28
**Status:** Approved pending final user review
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
| Summary map | **Non-interactive**, camera-fitted preview in a `Card`; tapping it opens the full-screen viewer. |
| Full-screen viewer | New route `run-route/[id]`, presented as **`fullScreenModal`** with a `Stack.Toolbar` `xmark` (§7.3 explains why not a push). |
| Polyline colours | The existing **4-kind palette** (`useSegmentColors()`: warmup/run/walk/cooldown), so the legend already on the summary keys the map. Supersedes master spec §8's accent/muted wording. |
| Direction arrows | **Chevrons synthesised as extra 3-point polylines** — the only mechanism the API supports (§5). |
| Geometry source | Derived from `run_points` (re-smoothed + DP-simplified). **Never** from `runs.summary_polyline`; nothing about finalize changes. |
| Library | `expo-maps@~57.0.1` behind the `RouteMap` component port; react-native-maps stays the pre-approved fallback (ADR 0010 §3). |
| iOS floor | `ios.deploymentTarget: "17.0"` via `expo-build-properties@~57.0.7` — **not 18.0**. Amends ADR 0010 (§9). |
| Live map during a run | Still out (master spec §8: glanceability + battery). |

## 3. Verified platform facts

ADR 0010 §1 requires re-verifying expo-maps against the installed package
rather than the docs, "alpha being what it is". Done — against
`expo-maps@57.0.1`'s shipped TypeScript declarations and Swift sources. These
findings are load-bearing; several contradict the package's own README.

**Camera.** `CameraPosition` is `{ coordinates?, zoom? }` — no bounds, span,
region, padding, heading or pitch. `MapUtils.swift` converts it as:

```swift
let longitudeDelta = 360 / pow(2, zoom)
let latitudeDelta = longitudeDelta / cos(0 * .pi / 180)   // cos(0) == 1 — dead code
```

So the requested span is **`360 / 2^zoom` degrees, isotropic** — *not* a
Web-Mercator tile zoom, and with no `cos(latitude)` term (the `cos(0)` is
clearly a bug where `cos(latitude)` was intended). The inverse is therefore
`zoom = log2(360 / spanDegrees)`. At 59°N a Web-Mercator-derived zoom would be
off by ~2×.

**The `cameraPosition` prop is honoured on first render; the ref is not needed.**
Both renderers guard a one-shot `.onAppear` with a non-published
`hasInitializedCamera` flag that *reads the prop* — there is no
default/user-location fallback on that path. RN applies props before view
insertion (`RCTMountingManager`: `updateProps` → `finalizeUpdates` →
`mountChildComponentView`), and the SwiftUI tree attaches only in
`didMoveToWindow`, so the prop is always populated before `onAppear` runs.
Consequences: **always pass `cameraPosition`** (its default is `(0,0)` at
`zoom: 1` — null island at a 180° span); **never call `setCameraPosition` at
mount** (an async call landing before `onAppear` gets clobbered); and the
prop path is unanimated while the ref path is `withAnimation`.

`Map(position:)` is a **two-way binding** — user pan/zoom writes back into
state, and a later prop commit with a *different* value snaps the view back.
Equality is by value, so re-sending an identical camera is a no-op. The camera
object must therefore be referentially and value-stable across renders.

**Polylines.** `AppleMapsPolyline` is exactly `{ id?, coordinates, color?,
width?, contourStyle? }`. There is **no dash, pattern, texture, arrowhead,
line-cap, line-join or opacity property**, and `contourStyle` is only
`STRAIGHT | GEODESIC` (projection, not styling). The renderer calls only
`.stroke(color, lineWidth:)`. Stay on `STRAIGHT`: `GEODESIC` interpolates 30
great-circle points per segment during iOS 18 hit-testing.

**`id` is a correctness requirement, not a nicety.** Swift declares
`ExpoAppleMapPolyline: Record, Identifiable` with `id` defaulting to a fresh
`UUID()`, rendered through `ForEach`. Omit `id` and every prop update mints new
identities, so SwiftUI tears down and rebuilds all overlays.

**Paint order.** Content-builder order is markers → polylines → polygons →
circles → annotations → user annotation, identically on both renderers. There
is no z-index anywhere in the Apple path (`zIndex` exists only on the Google
types). Markers/annotations are **documented** above all overlays
(`MKOverlayLevel.aboveLabels` is "below annotations"). Within one overlay level
UIKit documents list order as paint order, but **SwiftUI's `MapContentBuilder`
makes no such guarantee** — so "chevrons last in the array paint on top" is
highly likely but must be confirmed on the simulator (§10).

**No interaction lock exists on Apple.** `scrollGesturesEnabled`,
`zoomGesturesEnabled`, `rotationGesturesEnabled` and `MapInteractionModes` are
all **Google/Android-only**. A static preview must therefore be built RN-side.
Also note `uiSettings.compassEnabled`, `myLocationButtonEnabled` and
`togglePitchEnabled` **default to true**, and `properties.selectionEnabled`
defaults to **true** (on iOS 18 a tap raises Apple's place-detail accessory),
and POIs default to *all shown*.

**Markers are full-size balloons.** `Marker(title, systemImage:, coordinate:)`
with `.tint(tintColor)` — no sizing API, and expo-maps never calls
`annotationTitles(_:)`. An empty `title` (the default) gives an unlabelled
balloon; that is the only lever. `AppleMapsAnnotation.icon` is the alternative
but is hard-coded to a 50×50 screen-space frame.

**Colour alpha works.** Polyline colours pass through RN `processColor`, so
`"rgba(255,255,255,0.9)"` and 8-digit hex both yield real alpha.
`marker.tintColor` is **not** processed in JS but Swift parses colour strings
directly, so a plain hex string is fine there.

**Deployment target.** The podspec declares `ios => '16.4'` — identical to SDK
57's own default (`ios/Podfile:25`, `platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'`),
so nothing needs raising to compile. The package runtime-branches:
iOS 18 → `AppleMapsViewiOS18`, iOS 17 → `AppleMapsViewiOS17`, **below 17 →
`EmptyView()`** (blank, no crash). The iOS 17 renderer is complete, not a stub:
same `MapPolyline`/`.stroke` call, same markers, annotations, polygons, circles,
`uiSettings`, styling and camera code. **iOS 18 gates only click events and
programmatic selection**, neither of which a read-only route map uses.
The README's "requires a minimum deployment target of iOS 18.0" is inaccurate
for this use and is contradicted three ways inside its own tarball.

**Per-prop-commit cost is the real performance hazard.** Expo's Fabric bridge
hands *all* accumulated props to Swift on every update, and `Coordinate` uses
`@Field` rather than the `@Record` macro, so each coordinate goes through
uncached `Mirror` reflection. Changing *any* prop re-converts *every*
coordinate. On iOS 18 each polyline additionally constructs an
`MKPlacemark` + `MKMapItem` per body evaluation for its selection tag.
Mitigation is entirely ours: keep props referentially stable, and keep vertex
counts low (§6 measures this).

## 4. Architecture

```
run_points (immutable after finalize)
  └─ loadRunPoints(runId)                  sync, non-reactive (ADR 0004 §3)
       └─ smoothTrackForRender(fixes)      4th fold over the shared smoothFix reducer;
       │                                   tags every point with segmentSeq + gapBefore
       ├─ boundingBox(points)  ─────────┐
       └─ toSegmentPolylines(pts, ε)     │  split by segment/gap → DP each chunk
            ├─ join segmentSeq → kind → useSegmentColors()
            └─ chevronsAlongRoute(chunks, bbox)
                 └─ RouteMapPolyline[] (coloured chunks + white chevrons, stable ids)
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
interface CameraFit { center: LatLng; zoom: number }

function smoothTrackForRender(fixes: readonly SegmentedFix[]): RenderPoint[];
function toSegmentPolylines(points: readonly RenderPoint[], epsilon?: number): SegmentPolyline[];
function chevronsAlongRoute(chunks: readonly SegmentPolyline[], bbox: BoundingBox): Chevron[];
function cameraForBoundingBox(bbox: BoundingBox, aspectRatio: number, paddingRatio?: number): CameraFit;
```

`smoothTrackForRender` reuses `smoothFix` — the same reducer the live engine and
the finalize rollup use — so the rendered geometry is the same smoothed track
the distance came from. `gapBefore = restarted && points.length > 0`
distinguishes a real mid-track gap reset from the track's first point (also a
`restarted` step). `smoothTrackBySegment` is left untouched.

**The segment-boundary rule.** Adjacent fixes belong to different segments by
construction, so no shared vertex exists in the raw stream and naive chunking
leaves a visible break at *every* segment change (17 in W1D1). At an ordinary
transition, `toSegmentPolylines` **prepends the previous chunk's last point** to
the next chunk before simplifying; because `simplifyPolyline` always retains
both endpoints of whatever slice it receives, the two differently-coloured lines
then meet at an exact shared coordinate. At a **real GPS gap** it does *not*
prepend — the break is the intended rendering (ADR 0021 §5, master spec §11).
Chunks with fewer than two points are dropped. A segment interrupted mid-way by
a gap correctly yields two chunks sharing one `segmentSeq`.

**Simplification epsilon is per surface:** ε = `DP_EPSILON_M` (5 m) for the
card, ε = 2 m for the full-screen viewer, which zooms in far enough for ε=5 to
visibly cut corners. Both are sub-millisecond (§6).

### 4.2 Camera fit

`expo-maps` requests an **isotropic degree span**, while Mercator stretches
latitude by `f = 1 / cos(centerLat)`. MapKit then fits that region to the view,
only ever *expanding* it. Writing `A` for the viewport aspect ratio (width /
height), the minimum span that provably contains the route is:

```
S = max( lngSpanDeg / max(1, A·f),  latSpanDeg·f / max(1/A, f) )
zoom = log2( 360 / (S · (1 + 2·padding)) )
```

Two properties worth noting. It needs only the **aspect ratio**, never pixel
dimensions — so the card gets a fixed `aspect-[3/2]` and `A` is a constant,
with no `onLayout`, no measurement race and no post-layout re-render. And
because MapKit only expands, the failure mode is a marginally loose frame,
never a clipped route; `padding` is cosmetic rather than correctness-critical.
A `MIN_SPAN_DEG` floor keeps a near-stationary run from implying an absurd zoom.

### 4.3 Data access

`loadRunPoints` moves `db/active-run.ts` → **`db/run-points.ts`** (unchanged
body and signature); it is no longer only a crash-resume concern. Its one
existing caller in `services/run-engine/index.ts` re-points its import;
`active-run.ts` keeps `findActiveRun`.

`src/hooks/use-run-route.ts`:

```ts
type RunRoute =
  | { ready: false }
  | { ready: true; bbox: BoundingBox; polylines: RouteMapPolyline[];
      endpoints: { start: LatLng; finish: LatLng } };

function useRunRoute(runId: string, segments: readonly RunSegment[],
                     epsilon?: number): RunRoute;
```

One `useMemo` keyed on `[runId, segments, segmentColors, epsilon]`.
`loadRunPoints` is synchronous, so there is no effect and no loading state.
`segments` is passed in from the screen's existing live query — the hook never
queries `run_segments` itself; it only needs the `segmentSeq → kind` join.
`run_points` is read **once per mount, never live** (ADR 0004 §3). No
cross-screen cache: a finished run's points are immutable, and §6 shows the
whole derivation costs ~3 ms.

`endpoints` are the first point of the first chunk and the last point of the
last chunk — the route's true extremities even when a GPS gap split the track.

The hook returns the **bounding box, not a camera**: camera fit stays inside the
port (ADR 0010 §2, "`RouteMap` owns the camera-fit math"), which also means the
`cameraPosition` handed to `AppleMaps.View` is computed in a `useMemo` *inside*
the adapter and never crosses a prop boundary — removing the value-stability
hazard of §3 by construction. The memoised `polylines` array is the one large
prop that does cross, so both screens must keep it referentially stable.

## 5. Direction arrows

The requested `----->-----` reading has exactly one viable mechanism.
`AppleMapsPolyline` has no dash/arrow/texture property, and **neither
`AppleMapsMarker` nor `AppleMapsAnnotation` exposes rotation**, so oriented
icons would mean pre-rendering a bitmap per bearing bucket. Chevrons are
therefore synthesised as geometry: pure maths, no assets, and entirely on the
library-agnostic side of the port (ADR 0010 §2 — "coordinate arrays and
per-segment colors, nothing expo-maps-specific").

`chevronsAlongRoute` walks each **gap-free run** of chunks (concatenated in
order — adjacent non-gap chunks already share their boundary coordinate exactly,
so this reconstructs the line the user sees, and segment-colour changes are
transparent to the walk). Per run it accumulates arc length via
`haversineMeters`, places arrows at evenly spaced positions, interpolates the
exact point, takes the local bearing from the straddling vertices in a flat
local-metre plane, and emits `[backLeft, tip, backRight]`.

Riding on the **already-simplified** geometry rather than the dense raw stream
is deliberate: it halves the work and materially reduces bearing jitter.

Sizing keeps arrows visually constant under a bbox-fitted camera. A fixed-metre
chevron would look enormous on a 400 m loop and invisible on a 5 km route;
because the camera's scale tracks the bounding-box diagonal, sizing as a
*fraction* of that diagonal cancels out:

```
sizeM   = clamp(bboxDiagonalM · CHEVRON_SIZE_RATIO, CHEVRON_MIN_SIZE_M, CHEVRON_MAX_SIZE_M)
spacing = max(runLengthM / CHEVRON_TARGET_COUNT, sizeM · CHEVRON_MIN_SPACING_MULTIPLIER)
```

so a long run keeps ~`CHEVRON_TARGET_COUNT` arrows spaced further apart, while a
short run thins out rather than letting arrows collide. On the zoomable viewer
they scale like markings painted on the road, which is the correct model.

Load-bearing constants, named exports beside ADR 0021's (the same
tune-first convention):

| Constant | Value |
|---|---|
| `CHEVRON_SIZE_RATIO` | `0.025` |
| `CHEVRON_MIN_SIZE_M` / `CHEVRON_MAX_SIZE_M` | `3` / `25` |
| `CHEVRON_TARGET_COUNT` | `8` |
| `CHEVRON_MIN_SPACING_MULTIPLIER` | `4` |
| `CHEVRON_MIN_RUN_LENGTH_M` | `20` |
| `CHEVRON_WING_DEG` | `35` |

Colour is presentation, not geometry: chevrons are deliberately blind to segment
kind (they carry direction, not phase) and use one fixed
`ROUTE_DIRECTION_COLOR = 'rgba(255,255,255,0.9)'` in `constants/theme.ts` —
scheme-independent, because MapKit's basemap is not skinned by the app's theme.
Stroke width sits just under the route's so the chevron reads as an inlay.

**If the simulator shows chevrons painting *under* the route** (§3: SwiftUI does
not guarantee intra-array order), the fallback needs no new geometry — the same
three points become a filled `polygons` entry. The `polygons` `ForEach` is
emitted *after* the whole `polylines` `ForEach`, giving builder-level ordering
plus a real fill with working alpha. Cost: iOS 18 ray-casts polygons first on
each tap, which is irrelevant to a non-interactive card.

## 6. Measured cost and fidelity

Benchmarked against the shipped `domain/geo.ts` on a synthetic W1D1-shaped
track (1710 fixes at 1 Hz, 17 segments, ~2.8 km, Stockholm latitude):

| Metric | Result |
|---|---|
| Full derivation (smooth + chunk + DP + bbox) | **1.5 – 3.3 ms** |
| Vertices after DP | 1710 → **103** (ε=5 m) · 373 (ε=2 m) · 47 (ε=12 m) |
| Polyline chunks | 17 |
| Boundary continuity | **16/16 adjacent pairs share an exact vertex; residual gap 0.00 m** |
| Fitted zoom | 15.9 (3:2 card) · 15.0 (full screen) |
| Chevron size at 2.5 % of diagonal | 14.5 – 18.8 m |

3 ms sits well inside a frame, so the `useMemo` needs no deferral. ~100
vertices across 17 polylines also keeps the per-prop-commit reflection cost
(§3) negligible — DP earns its place for performance, not only appearance.

**Accepted divergence.** DP at ε=5 m shortens the drawn path by ~23 % against
the smoothed track, because it cuts the jitter zigzag. This is intended and
harmless: ADR 0021 §6 already declares the rendered line presentation-only and
forbids deriving distance from it. It is recorded here so it is not later
mistaken for a bug — the drawn route is deliberately *not* a distance
measurement.

**Stage 3 observation, not Stage 4 scope.** The same harness incidentally
measured the ADR 0021 smoother against a temporally-correlated (AR(1),
φ = 0.9–0.98) noise model. The filter works — it cuts distance error 3–5× in
every scenario and is exact on a noiseless control — but the residual is
pace-dependent: ~+5–7 % at jogging pace versus **~+20–23 % at walking pace**,
because at 1.35 m/s the true 1-second step is smaller than the noise
innovation itself. C25K week 1 is ~62 % walking, so this is worth pursuing.
It is explicitly **not** a Stage 4 blocker: it belongs to Stage 3's distance
path, the remedy is already prescribed (ADR 0021 fallback ladder step 1 — tune
`KALMAN_PROCESS_NOISE`) and must be validated against **real device tracks at
the Milestone-0 gate**, not against synthetic noise. Rendering is unaffected —
DP removes exactly the jitter that inflates the number.

## 7. Components and screens

### 7.1 The `RouteMap` component port

First component port in the codebase (ADR 0003 §5), mirroring
`services/location-tracker`'s triplet under `src/components/route-map/`:
`port.ts` (types only), `adapter.ios.tsx`, `index.ts` (re-export, no
composition wrapper — there is no cross-platform gating seam).

```ts
interface RouteMapPolyline { id: string; points: LatLng[]; color: string }

interface RouteMapProps {
  polylines: RouteMapPolyline[];      // coloured chunks then chevrons, in paint order
  endpoints: { start: LatLng; finish: LatLng } | null;
  bbox: BoundingBox;                  // the port fits the camera to it
  aspectRatio: number;                // the shape of the box the caller is giving the map
  interactive: boolean;
  accessibilityLabel: string;         // required — the map carries no text
  onPress?: () => void;               // card only
  style?: StyleProp<ViewStyle>;
}
```

`aspectRatio` is passed rather than measured: the card is a fixed
`aspect-[3/2]` and the viewer is the window, both known before layout, so the
port needs no `onLayout` and there is no first-paint camera jump.

The port never learns the word "chevron", never sees a `SegmentKind`, a
`run_points` row, or an expo-maps type. Flipping to react-native-maps (ADR 0010
§3) is then one adapter file, with `port.ts`, the hook and `domain/geo.ts`
untouched.

The adapter owns everything expo-maps-specific: mapping to `AppleMapsPolyline`
with stable ids; two `AppleMapsMarker`s (`figure.run` / `flag.checkered`,
tinted, **empty titles**) for the endpoints; and the props §3 shows are needed
to make a calm, read-only map — `uiSettings` all four **explicitly false**
(three default true), `selectionEnabled: false`, `pointsOfInterest: { including: [] }`,
`emphasis: MUTED`, `colorScheme: AUTOMATIC`, `contourStyle: STRAIGHT`, and an
always-present `cameraPosition` passed as a **prop** (never the mount-time ref).

Non-interactivity is RN-side, since Apple exposes no lock: `Pressable` →
`View pointerEvents="none"` → map, so touches never reach MapKit. No ADR 0005
hazard — `AppleMaps.View` is a plain RN host component, not an `@expo/ui`
`Host`, so this is RN over RN. When `interactive`, no `Pressable` is added and
`pointerEvents` stays default so MapKit's own gestures and VoiceOver rotor pass
through untouched.

Accessibility is asymmetric by design. The card is one `accessible` group with
`accessibilityRole="button"` and a composed label ("Map of your 2.1 km route.
Double tap to view full screen."). The viewer is deliberately **not** flattened
— that would collapse MapKit's internal accessibility elements into one opaque
blob — so it relies on its screen title instead.

### 7.2 Summary card

`src/components/route-map-card.tsx` — ADR 0013 domain component: owns its
`Card surface="card"` chrome with `p-0 overflow-hidden aspect-[3/2]` (the map
goes edge-to-edge inside the squircle, Apple Fitness-style, so the default
`p-4` is dropped), composes the a11y label from `run.distanceM`, and opens the
viewer. It renders `null` when the route isn't renderable (§8).

It slots between `RunStatGrid` and `SegmentBreakdown` in
`src/app/run-summary/[id].tsx`, so the colour legend sits directly beneath the
map it keys.

### 7.3 Full-screen viewer

`src/app/run-route/[id].tsx`, registered in the root `Stack` as
`presentation: 'fullScreenModal'` with a `Stack.Toolbar` `xmark`, mirroring how
`run-summary/[id]` is dismissed.

A sibling top-level route is chosen over nesting the summary into a directory,
which would rename an E2E-covered route for tidiness alone.

**Why a modal rather than the master spec's "standard push":** Maestro's `back`
command is **Android-only**, and an iOS pushed screen's back affordance is a
nav-bar button labelled with the parent's title (here `Week 1 · Day 1`, which
collides with the Log row text) or an edge-swipe, both poor automation targets.
A toolbar `xmark` is a deterministic, already-proven target. It is also ADR
0006-consistent, avoids the nested-push-inside-a-modal quirks, and matches how
Apple's own Fitness app opens a full route. The cost is the loss of a
drill-down swipe-back, which a full-bleed viewer does not need.

The screen live-queries `runSegments` for its `id` (an approved live-query
table scoped to a fixed `run_id`), calls `useRunRoute` with the window aspect
ratio and ε = 2 m, and renders `RouteMap interactive style={{ flex: 1 }}`. Being
independently deep-linkable, it handles a bad `id` with the same
`ContentUnavailableView` pattern the summary already uses.

## 8. Degradation

| Case | Behaviour |
|---|---|
| No points (location denied) | `{ ready: false }` → card renders `null`, exactly as `SegmentSplits` omits itself without distance. No placeholder. |
| Fewer than 2 smoothed points | Same path — a single point cannot form a polyline. |
| GPS gap | No special case — `gapBefore` chunking renders a genuine break, and no chevron bridges it. |
| Deep link to a missing run | `ContentUnavailableView`, as on the summary. |

**No iOS-version gate is needed.** expo-maps renders `EmptyView()` below iOS 17,
but the 17.0 deployment target (§9) means no such device can install the app —
so that branch is unreachable and a runtime check would be dead code. This is a
direct dividend of choosing a floor over a runtime gate.

## 9. Build config and ADR impact

- `bun expo install expo-maps expo-build-properties` → `~57.0.1` / `~57.0.7`.
- `app.json` gains one plugin entry: `["expo-build-properties", { "ios": { "deploymentTarget": "17.0" } }]`.
  `expo-maps` needs **no** plugin entry and **no** Info.plist key (it autolinks;
  its bundled plugin is opt-in for location, which a route preview doesn't
  want). `app.config.ts` already spreads `config.plugins`, so no variant work.
- **Fingerprint:** a new native module plus a deployment-target change alters
  the `@expo/fingerprint` hash. Consequences: the `e2e-ios` cache misses on
  this PR, forcing one full `eas build --local` (~20 min) instead of a repack,
  then re-caching; and the next release is not OTA-eligible, taking the native
  build → manual approval → submit path. Both are correct behaviour for a
  native change. `fingerprint.config.js` is **not** touched.
- Local `bun run start` recompiles native once (CocoaPods re-resolves).

**ADR 0010 amendment (required).** Its §1 mechanic ("`expo-build-properties`
sets `ios.deploymentTarget: "18.0"`") rests on a README claim the package's own
podspec, its complete iOS-17 renderer, and its `isMapsAvailable` property all
contradict (§3). The floor becomes **17.0** — the minimum at which a map
renders at all. Note the framing the original ADR missed: the app's *current*
effective floor is 16.4 (SDK 57's default, nothing being set), and 16.4 still
supports iPhone 8/8 Plus/X, whereas **both** 17.0 and 18.0 drop that hardware.
The real choice was never 17-vs-18 but whether to drop 2017 iPhones — taken
deliberately here, so every user who can install gets the same experience
rather than a silently blank map. The amendment should also record the verified
camera formula, the `id` identity requirement, the absent interaction lock, and
the paint-order caveat, since these are durable design constraints.

**ADR 0021** flips from *Proposed* to *Accepted* (it is implemented and
shipping). Its §6 DP-simplification assignment to Stage 4 is satisfied by
`toSegmentPolylines`; the §6 promise that distance never derives from the
rendered line is preserved and re-stated in §6 above.

**Master spec deviations to fold back:** §8/§13's `runs/[runId]` screen is
dropped (superseded by the summary card + viewer); §8's accent/muted polyline
colouring is replaced by the 4-kind palette; §13's Stage 4 bullet gains the
direction arrows.

## 10. Testing

**`bun test`** — all new pure functions, extending `domain/geo.test.ts`:

- `smoothTrackForRender`: correct `segmentSeq` tagging; `gapBefore` false on the
  first point and on an ordinary transition, true exactly past `MAX_GAP_S`;
  positional parity with `smoothTrack` on a gap-free fixture.
- `toSegmentPolylines`: adjacent non-gap chunks share an exact boundary vertex
  (the direct regression for the 17-gap trap); chunks across a real gap are
  disjoint and the second carries `gapBefore`; a mid-segment gap yields two
  chunks with one `segmentSeq`; sub-2-point chunks dropped.
- `chevronsAlongRoute`: none below `CHEVRON_MIN_RUN_LENGTH_M`; none bridging a
  gap; due-north and due-east fixtures put the tip north/east of centre
  respectively (pins the bearing sign convention — the easiest bug class here);
  size scales with a 10× bbox within the clamps; count near
  `CHEVRON_TARGET_COUNT` on a long route, thinned on a short one.
- `cameraForBoundingBox`: centres on the bbox midpoint; the returned span
  contains the bbox for both a square and a deliberately mismatched aspect
  ratio; padding matches a hand-computed span; a near-single-point bbox floors
  to `MIN_SPAN_DEG`; zoom decreases monotonically as the bbox grows.

**Maestro** — extend `.maestro/tests/run-distance.yaml` (the only flow that
produces a moving fix stream, via `travel`). After the existing `Fastest`
assertion: `scrollUntilVisible` the card's label, tap it, assert the viewer's
title, dismiss via the `xmark`, then re-assert `Distance` to prove the round
trip and that the new card didn't displace the existing assertions. Selectors
grounded with `inspect_screen` per ADR 0016; the map itself is never asserted
against — reachability and a11y wiring only.

**Simulator (argent + Maestro)** — the checks that cannot be unit-tested:

1. **Paint order** — chevrons above the route (§3/§5); if not, switch to `polygons`.
2. Camera framing on a short loop *and* a long point-to-point, in both
   orientations of bbox aspect — nothing clipped, no excessive slack.
3. Chevron legibility against all four segment colours, light and dark basemap.
4. `cameraPosition` sticking on first paint without the ref (§3).
5. The card not stealing `ScrollView` drags; tap opening the viewer.
6. Squircle clipping of the native map view under `overflow-hidden`.
7. Marker balloon size — confirm empty-title balloons read as acceptable, or
   evaluate `circles` as subtler endpoint dots.

Polyline pixel-correctness stays a visual check per master spec §13.

## 11. Risks

| Risk | Mitigation |
|---|---|
| SwiftUI doesn't honour intra-array polyline order | Same geometry re-emitted as `polygons`, which are builder-ordered after polylines (§5). Two-line adapter change. |
| expo-maps alpha churn | Version pinned; port boundary; react-native-maps pre-approved with ADR 0010 §3 triggers. |
| `zoom` semantics wrong despite the source read | Isolated in one function; the bbox, padding and aspect maths stay valid regardless. |
| Prop commits re-converting 1800 coordinates | Memoised props; DP keeps vertices ~100 (§6). |
| iOS 26 MapKit churn (the package carries a documented iOS 26 tap workaround) | Read-only surface uses no tap handling; sim-verified per release. |
| Walk-pace distance error (§6) | Stage 3 / Milestone-0 follow-up; does not affect rendering. |

## 12. Out of scope

Live map during a run · History row thumbnails (ADR 0005 forbids RN per
SwiftUI row; `summary_polyline` keeps the v2 options open) · map snapshots
(no expo-maps API) · elevation profile (ADR 0015, separate) · route sharing
or export · Android adapter (`adapter.android.tsx` joins later under the same
`moduleSuffixes` mechanism).
