# Share your run — research

Date: 2026-07-29
Status: **research / Researched** — not a decision to build.

**Question:** Can the app let a user share a finished run outward (Messages,
Instagram, Photos) as an image carrying the route and headline stats, built
entirely on-device with a mandatory privacy trim on the shared rendering, on
our Expo SDK 57 / CNG stack and the official-tooling preference?

## TL;DR

- **Feasibility:** `Feasible-with-caveats` — the recommended approach (render
  a route card with the `@shopify/react-native-skia` the app already ships,
  write it to disk with `expo-file-system`, hand it to `expo-sharing`) needs
  **no alpha library and no custom native code**. The caveats sit entirely on
  the *not-recommended* alternatives: capturing the live `expo-maps` view is an
  unverified capture technique against a Metal-backed SwiftUI island, and
  getting a literal map-imagery snapshot at all means invoking the exact
  fallback trigger [ADR 0010](../../adr/0010-maps-expo-maps-ios18-floor.md) §3
  pre-registered for this ("a v2 feature demands what only the fallback has:
  snapshots").
- **Local-first fit:** `Fully local` — the artifact is rendered on-device from
  data already in `run_points` (no fetch of any kind, not even an optional
  one). The only outward step is the user manually invoking the iOS system
  share sheet — Apple's own OS primitive, not a service of ours — exactly the
  line [ADR 0017](../../adr/0017-in-app-donations-tip-jar.md) already drew for
  StoreKit ("no backend of *ours*"). Nothing here is a backend; a hypothetical
  web share-link with a server-rendered preview image would be, and is
  rejected below.
- **Recommended approach:** **Option A** — an on-device Skia-rendered route
  card (no live map mounted, no map imagery at all) over the **privacy-trimmed**
  route, shared via `expo-sharing`. This is an assessment, not a commitment to
  build.

## Context

Stage 4 (maps) just shipped a run summary and full-screen viewer that render
the recorded GPS route on Apple Maps. During its adversarial review, a
reviewer connected two sentences already sitting side by side in
[the Stage-4 design spec](../specs/2026-07-28-stage-4-maps-design.md): a real
loop or out-and-back — which that spec itself calls **"the canonical beginner
route"** (§5, line 429) — starts and ends at the user's front door, and the
summary draws a marker on that exact coordinate, on what the same spec calls
**"a screen people screenshot and share"** (§8, line 790, in the context of a
different bug — the treadmill-run degenerate-map case — but the phrase applies
verbatim here). Stage 4 ships the **whole** route, home included, with no
trim — a decision the owner has made and this doc does not revisit. The
owner's separate, settled decision is that **if and when a share feature is
built, it must carry a privacy trim**: drop roughly the first and last
75–100 m of the *shared* rendering and move the start/finish markers to where
the trim begins. That requirement is treated as fixed throughout this doc;
the open work is how it behaves, not whether it exists.

Stage 4 itself already fenced this off: its own out-of-scope list (§12) names
both **"map snapshots (no expo-maps API)"** and **"route sharing or export"**
explicitly — this feature was foreseen and deliberately deferred, not missed.

**ADRs / subsystems touched:**

- [ADR 0010 — maps](../../adr/0010-maps-expo-maps-ios18-floor.md): established
  that expo-maps has **no snapshot API** ("No snapshot API" is a direct
  finding, §Context) and pre-registered react-native-maps as the fallback
  specifically for when *"a v2 feature demands what only the fallback has
  (snapshots, sub-iOS-18 support)"* (Decision §3) — this is precisely that v2
  feature. It also already rejected a hand-written `MKMapSnapshotter` wrapper
  as an alternative ("no official Expo wrapper... needs custom native code
  against CNG") — the same shape any custom native snapshot route would take
  here.
- [ADR 0021 — GPS smoothing](../../adr/0021-on-device-gps-track-smoothing.md)
  item 6: rendering is **presentation-only** — *"distance is NEVER derived
  from `summary_polyline` or the simplified line — only from `run_points`."*
  The privacy trim inherits this exactly: it must cut only what gets *drawn*,
  never touch a stored distance/pace figure.
- [ADR 0004 — schema](../../adr/0004-local-storage-expo-sqlite-drizzle.md):
  `runs.summary_polyline` (an encoded, smoothed track — `encodePolyline` in
  `src/domain/geo.ts:84`) is written by `save-run.ts:109` on every run with
  fixes but **read by nothing today** beyond a null-check
  (`route-map-card.tsx:35`, `run.summaryPolyline !== null`) — kept exactly to
  "keep every thumbnail option open for v2" (ADR 0010 §6). `run_points`
  (`src/db/schema.ts:43`) is the actual source of truth Stage 4 reads via
  `loadRunPoints`.
- [ADR 0003 — ports and adapters](../../adr/0003-platform-ports-and-adapters.md):
  a share/render mechanism belongs behind a port, the same shape as
  `RouteMap` (ADR 0010) and `location-tracker`.
- [ADR 0005 — SwiftUI islands](../../adr/0005-system-native-ui-expo-ui.md):
  `AppleMaps.View` is confirmed (Stage-4 spec §3) to be *"itself a SwiftUI
  island"* — a `UIHostingController`-backed `ExpoSwiftUI.View`, the same
  conformance as `@expo/ui`'s `Host`. This is exactly the class of view this
  project's own history (PR #33, per ADR 0005's amended rule) already found
  can misbehave when RN tooling reaches into or over it — directly relevant to
  the live-view-capture options below.
- [ADR 0020 — iOS-only](../../adr/0020-ios-only-android-deferred.md): no
  Android obligation.
- [ADR 0017 — tip jar](../../adr/0017-in-app-donations-tip-jar.md): the
  precedent for "talks to an external system but isn't our backend" — StoreKit
  is Apple's system, not "a backend" in the `AGENTS.md` sense. The system share
  sheet is the same shape: a user-initiated hand-off to on-device or
  Apple-run infrastructure, not a server of ours.

**Inherited `AGENTS.md` hard constraints:** no backend, no accounts, no
analytics; on-device data with iCloud the only sync; iOS-only.

## Findings

Verified 2026-07-29 against Context7-fetched docs, the packages' own GitHub
sources, and this repo's code.

### The data and math to build the shared route from already exist

- **`run_points` is the read source; `summary_polyline` is write-only today.**
  `src/db/schema.ts:43-58` (`runId, seq, lat, lng, ...`) is what Stage 4's
  `loadRunPoints` reads (`docs/superpowers/specs/2026-07-28-stage-4-maps-design.md`
  §4.3); `summary_polyline` is written by `save-run.ts:109` via
  `encodePolyline` but has **no decoder anywhere in `src/`** — nothing reads it
  back today (grep-verified, 2026-07-29). Either a share feature adds a
  decoder to consume the stored polyline, or — more simply, since Stage 4
  already re-derives the route from `run_points` on every screen open — it
  reuses the same `loadRunPoints` → `smoothTrackForRender` → segment path and
  never touches `summary_polyline` at all.
- **The needed geometry primitives already exist in `domain/geo.ts`**:
  `haversineMeters`, `boundingBox`, `boundingBoxDiagonalM`,
  `cameraForBoundingBox` (all exported, `src/domain/geo.ts`). A privacy trim
  needs two new, small, pure functions in the same module — walk cumulative
  `haversineMeters` from each end until a target distance is reached (yields
  the trim cutoff points), and recompute `boundingBox`/`cameraForBoundingBox`
  over the **trimmed** sub-range, not the full track. Both are the same shape
  and risk class as the existing helpers (unit-testable, no library
  dependency) — this is genuinely small, low-risk new code, not a new
  subsystem.
- **The trim must be geometric, done before rendering — cropping a rendered
  image after the fact does not achieve it.** Whatever mechanism paints the
  route (map tiles or a bare canvas), the camera/frame is fitted to a bounding
  box. If that box is still the *full* route's, a home-centered map or a home
  centered canvas frame is what gets rendered regardless of which pixels are
  later cropped — the basemap/backdrop itself, not just the drawn line, must
  be centered on the **trimmed** extent. This applies identically to every
  option below; it is the one piece of work none of them can skip.

### expo-maps genuinely has no way to produce an image, confirmed fresh

- **No rasterization method exists on `AppleMaps.View`.** Re-fetched against
  the current SDK 57 docs (2026-07-29): the full prop and ref surface is
  `annotations, cameraPosition, circles, colorScheme, markers, polygons,
  polylines, properties, uiSettings` plus `openLookAroundAsync,
  selectAnnotation, selectMarker, setCameraPosition` — nothing for exporting
  rendered content to an image, confirming ADR 0010's original finding still
  holds on the installed version. ([Expo SDK 57 Maps docs](https://docs.expo.dev/versions/v57.0.0/sdk/maps/),
  verified 2026-07-29)

### A community view-capture library exists, is healthy, but faces a real, unverified Metal risk

- **`react-native-view-shot` is actively maintained and CNG-clean.**
  Latest `5.1.1` (2026-06-20 on npm), repository last pushed **2026-07-27**,
  not archived, 13 open issues. It ships only a podspec + Android
  module — **no config plugin, no `app.plugin.js`** (GitHub repo listing,
  verified 2026-07-29) — so it autolinks under CNG with a native rebuild and
  no entitlement/provisioning ceremony, unlike Live Activities' App Group.
  ([gre/react-native-view-shot](https://github.com/gre/react-native-view-shot),
  [npm](https://www.npmjs.com/package/react-native-view-shot), verified 2026-07-29)
- **`captureRef(view, options)` is the API**: returns a URI (or `base64` /
  `data-uri`), with `format`, `quality`, `width`/`height`. iOS offers a
  `useRenderInContext` switch between `drawViewHierarchyInRect` (default) and
  `renderInContext` snapshot strategies. ([react-native-view-shot README via
  Context7](https://github.com/gre/react-native-view-shot/blob/master/README.md),
  verified 2026-07-29)
- **Both iOS snapshot strategies have a documented failure mode against
  Metal-backed content: a correctly-sized but fully transparent image.**
  Apple's own developer forums record exactly this for `drawViewHierarchyInRect`
  against GPU/Metal-rendered views. Modern `MKMapView` (which `AppleMaps.View`
  wraps) is Metal-rendered, and — per the Stage-4 spec's own re-derivation —
  `AppleMaps.View` is a `UIHostingController`-backed SwiftUI island, not a
  plain `RCTViewComponentView`, the exact class of view this project's history
  already flagged as capable of surprising RN tooling (ADR 0005 / PR #33).
  Whether `captureRef` against the live map produces a real image or a blank
  frame is genuinely unverified on this stack and would need a device spike
  before being relied on — the same posture this project already takes for
  other young-library or cross-boundary risks (the `expo-widgets` device spike
  in the Live Activity research; the Hermes-compat spike in the free-run
  research). ([Apple Developer Forums — snapshot views](https://developer.apple.com/forums/thread/108278);
  Stage-4 spec §3 "AppleMaps.View is itself a SwiftUI island", verified 2026-07-29)

### react-native-maps has a purpose-built snapshot API — and adopting it is literally ADR 0010's pre-agreed trigger

- **`MapView.takeSnapshot(options)` exists and is documented**: `width`,
  `height`, `region` (iOS-only), `format` (`png`/`jpg`), `quality`, `result`
  (`file`/`base64`), resolving to a URI. react-native-maps `1.29.0` (npm,
  released 2026-06-28) matches ADR 0010's cited version. Because this is a
  dedicated snapshot renderer rather than a live-view capture, it is the
  library's documented answer to exactly the class of Metal-capture risk
  named above. ([react-native-maps README via Context7](https://github.com/react-native-maps/react-native-maps/blob/master/README.md);
  [npm](https://www.npmjs.com/package/react-native-maps), verified 2026-07-29)
- **Adopting it for this feature is not a new policy exception — it is the
  exact scenario ADR 0010 §3 named in advance**: *"a v2 feature demands what
  only the fallback has (snapshots...)"*. The open question this research
  cannot settle is scope: whether that means running react-native-maps
  **alongside** expo-maps solely to snapshot for sharing (two map stacks,
  more native surface, no change to the live screens), or **flipping** ADR
  0010's primary choice entirely (a much bigger call the maps ADR itself does
  not ask this feature to make). Either is heavier than Option A below.

### `@shopify/react-native-skia` — already in the app, and its snapshot path is first-class, not a workaround

- **Already a dependency (`2.6.2`) with a shipped, proven use** —
  `src/components/skia-countdown.tsx` renders the run screen's countdown on a
  `Canvas`. No new native dependency is needed to reach for it again.
- **`useCanvasRef().current.makeImageSnapshot()` → `image.encodeToBytes()`**
  is a synchronous, first-party Skia API returning real image bytes — not a
  UIView-snapshot technique, so it carries none of the Metal-capture
  uncertainty above (Skia owns and rasterizes its own GPU surface directly).
  An **offscreen** variant, `Skia.Surface.MakeOffscreen(w, h)` +
  `surface.getCanvas()` + `surface.makeImageSnapshot()`, can render a route
  card with **no visible on-screen `Canvas` at all** — no flash, no mounting
  a component just to immediately hide it. ([React Native Skia docs via
  Context7](https://github.com/shopify/react-native-skia/blob/main/apps/docs/docs/canvas/canvas.md),
  verified 2026-07-29)
- **No existing lat/lng → screen-space projection helper exists in this
  codebase** (that math currently lives inside MapKit / `ios/MapUtils.swift`,
  outside JS reach). A Skia-only route card needs one small new pure function
  — an equirectangular (`cos(latitude)`-scaled) local projection — genuinely
  new work, but the same size and risk class as the trim-geometry helpers
  above, and a place this project has already been burned by an uncorrected
  `cos(0)` term (Stage-4 spec §3) — worth being deliberate about, not a
  feasibility blocker.

### Getting the image out of the app is a solved, zero-config path on this SDK

- **`expo-file-system`'s `File.write(content)` accepts a `Uint8Array`
  directly** — `new File(Paths.cache, 'route.png').write(bytes)` — no
  base64 round-trip needed to get Skia's `encodeToBytes()` output onto disk.
  (Expo SDK docs via Context7, verified 2026-07-29)
- **`expo-sharing`'s outbound `shareAsync(url, options)` needs no config
  plugin.** Its package does ship a config plugin (`plugin/src/withShareExtension.ts`,
  confirmed via the package's GitHub source tree, 2026-07-29) — but that
  builds an **inbound** iOS Share Extension (receiving shares *into* the app),
  an unrelated capability. The outbound call we need is zero-config: the
  README states plainly it needs no additional native setup for a managed/CNG
  project. (`expo-sharing` `57.0.7` on npm, matching the SDK-57 line;
  [expo-sharing README](https://github.com/expo/expo/blob/main/packages/expo-sharing/README.md),
  verified 2026-07-29)
- **`shareAsync` presents a plain, unrestricted `UIActivityViewController`.**
  Confirmed from the native Swift source (`SharingModule.swift`):
  `UIActivityViewController(activityItems: [url], applicationActivities: nil)`
  with no `excludedActivityTypes` — every standard system activity is
  available: Messages, Mail, AirDrop, **Save Image** (Photos), Print, and any
  third-party share extension the user has installed. (verified 2026-07-29)
- **"Share to Instagram Stories" as a dedicated one-tap action is a distinct,
  Instagram-specific mechanism, not something the generic share sheet
  guarantees.** Meta's own documented pattern for third-party apps posting
  directly to Stories is putting image data on `UIPasteboard` under a specific
  key and opening the `instagram-stories://share` URL scheme — separate
  integration work from `expo-sharing`. The task's "Messages, Instagram
  stories, or a photo library" framing is reachable generically (share sheet
  + Save Image) but a *dedicated* Stories button is a named, separate,
  smaller follow-on, not part of this recommendation's v1.
- **`expo-media-library` is likely unnecessary for v1.** The share sheet's own
  **Save Image** activity already saves an image file to Photos without any
  extra permission or dependency. A distinct **in-app** "Save" button
  (bypassing the share sheet) would need `expo-media-library`
  (`57.0.3` matches the SDK-57 line; add-only permission via
  `NSPhotoLibraryAddUsageDescription`, narrower than full library read access)
  — worth keeping as an explicit v2 addition, not a v1 requirement.
- **No GPS EXIF risk from the pipeline itself.** The shared file is a freshly
  rendered PNG (Skia bytes, or a view-shot capture) — not a camera photo — so
  neither pipeline embeds location EXIF by default. The privacy exposure here
  lives entirely in the **pixels** (what the route/map drawing shows), which
  is exactly what the trim addresses; the only residual discipline needed is
  not *adding* metadata (no lat/lng in a filename, no coordinates composed
  into share text).

## Options

### Option A — On-device Skia route card, no live map, no map imagery at all (recommended)

Render the privacy-trimmed route as line art on an offscreen Skia surface —
route line + start/finish markers at the trim boundary + a stats overlay
(distance, duration, pace) composited in the same draw pass, no basemap tiles
at all. Encode to bytes, write via `expo-file-system`, hand the file URI to
`expo-sharing`.

*Trade-offs:* zero new alpha/community-maintenance risk (Skia is already a
dependency; `expo-file-system`/`expo-sharing` are first-party and
version-matched); no live map ever mounts, so the Metal-capture question
never arises; strictly **more** private than a real-map rendering, since there
is no street layout, POI label, or basemap imagery at all near the trimmed
edge — only the line and the numbers. Costs a new small equirectangular
projection helper and the arc-length trim/camera-refit helpers (all pure,
testable `domain/` code, no library risk) plus giving up the "looks like the
map I saw on the summary" visual fidelity — the shared card looks more like a
Strava/Nike-Run-Club "route shape" card than a screenshot of Apple Maps.

### Option B — Capture the live `expo-maps` view with `react-native-view-shot`

Recompute the trimmed route + camera, mount (or reuse) an `AppleMaps.View`
sized for the share card at the trimmed camera fit, and `captureRef` it.

*Trade-offs:* would produce the literal "screenshot of the map I saw"
fidelity the task's framing implies real map imagery might want. But it
carries a genuinely unverified risk — the documented Metal/`drawViewHierarchyInRect`
blank-capture failure mode against a `UIHostingController`-backed island — that
needs a device spike before it can be trusted, exactly the posture this
project takes for other young-boundary risks. It also needs a hidden/offscreen
map mount purely for the capture (a second render pass beyond what the
summary/viewer screens already do), and inherits `react-native-view-shot` as
a priced community-tooling exception (healthy today, but a community
dependency nonetheless).

### Option C — Add `react-native-maps` for its native `takeSnapshot()`

Use react-native-maps' purpose-built, non-live-view snapshot API instead of
capturing expo-maps at all — either as a second map stack used only for
sharing, or as a full flip of ADR 0010's primary choice.

*Trade-offs:* sidesteps the Metal-capture uncertainty entirely (a dedicated
snapshot renderer, not a live-view technique) and is, notably, **not a new
policy exception** — it is the exact scenario ADR 0010 §3 pre-registered
("a v2 feature demands what only the fallback has: snapshots"). But it is the
heaviest option: running two map libraries side by side for one feature, or
reopening ADR 0010's primary-library decision for the whole app on the
strength of one feature — a much bigger call than "share" warrants on its
own.

**Rejected alternatives (not live options):**
- **A hand-written `MKMapSnapshotter` native module.** Already rejected in
  ADR 0010's own alternatives list for the identical reason it would fail
  here: no official Expo wrapper, custom native code against CNG.
- **A web share-link with a server-rendered preview image** (the common
  "shareable URL with an Open Graph image" consumer-app pattern). This is the
  one direction that *would* cross the `AGENTS.md` line: it requires a server
  of ours to render and host the image/page. Documented here so it is not
  proposed later as an "obvious" option — it fails the local-first lens
  outright, not feasibility.

## Comparison

| | A — Skia route card | B — `react-native-view-shot` on live map | C — `react-native-maps` snapshot |
|---|---|---|---|
| Feasibility | `Feasible` (no alpha lib, no custom native, small new pure-TS math) | `Feasible-with-caveats` (unverified Metal-capture risk; needs device spike) | `Feasible-with-caveats` (mature API, but scope call: dual map stack vs. ADR flip) |
| Local-first | `Fully local` | `Fully local` | `Fully local` |
| Battery / power | Negligible — one-shot synchronous render, no GPS/timers involved | Negligible, plus a momentary extra map render pass | Negligible, plus a momentary extra map render pass |
| Platform reach | iOS now; libraries are cross-platform if Android ever returns | Same | Same |
| Cost | $0; native rebuild only (no entitlement/provisioning ceremony) | $0; native rebuild only | $0; native rebuild, more native surface if run alongside expo-maps |
| Maintenance / tooling | First-party (`expo-file-system`, `expo-sharing`) + already-adopted Skia | Community, healthy today (priced exception, ADR-0010-style) | Community, but the *already pre-approved* ADR 0010 fallback — not a new exception |

## Feasibility assessment

**`Feasible-with-caveats`**, driven entirely by which option is chosen. The
recommended path (Option A) is squarely `Feasible`: every library involved is
either already a dependency (Skia) or a first-party, SDK-57-version-matched
package (`expo-file-system`, `expo-sharing`) requiring no config plugin, no
new entitlement, and no custom native code — only new pure-TS geometry helpers
in the same shape and risk class as ones already in `domain/geo.ts`. The
caveats belong to the *non-recommended* alternatives: Option B rests on an
unverified capture technique against a Metal-backed SwiftUI island (a real,
named risk, not a guess — the same failure class Apple's own forums document
for `drawViewHierarchyInRect`), and Option C is feasible on its own terms but
forces a scope decision (dual map stack, or reopening ADR 0010's primary
choice) that is bigger than this feature alone should decide. Effort for
Option A is modest: two-to-three small `domain/` functions (trim, projection,
camera refit on a sub-range), a new port/adapter shape mirroring `RouteMap`,
and a rendering component — no engine, schema, or run-recording changes of any
kind (the trim never touches distance/pace, per ADR 0021).

## Local-first assessment

**`Fully local`** — and more cleanly so than most roadmap candidates, because
this feature needs **zero network calls of any kind**, not even an optional
one (contrast the free-run route-generation research, which still needs a
keyless area fetch). The entire artifact — geometry, trim, rendering — is
computed from `run_points` already on the device. The only step that leaves
the app's own process is the user manually invoking the iOS system share
sheet, which then hands a file to whatever app or system service the user
personally picks (Messages, AirDrop, Photos, a third-party app). That is not
a backend of ours, exactly the reasoning ADR 0017 already applied to StoreKit:
Apple's own OS/system infrastructure is not "a backend" in the `AGENTS.md`
sense; what would cross the line is a server *we* run or a service *we* call
on the user's behalf without their explicit, per-action hand-off — which is
precisely why the rejected "web share-link with a server-rendered preview"
alternative above is named and set aside rather than left implicit. No
accounts, no analytics, and iCloud remains the only sync surface (the shared
image itself is never synced by the app — it leaves via the user's own share
choice, same as any photo they took).

## Recommendation

**Option A**: an on-device Skia-rendered route card (no live map, no map
imagery) over the privacy-trimmed route, written to disk via
`expo-file-system` and handed to `expo-sharing`. It is the only option with
no unresolved technical risk, needs no device spike to trust, and is — by
construction — the *most* private of the three, since there is no basemap
imagery anywhere near the trimmed edges to begin with. Keep Option C
(`react-native-maps` snapshot) named as the deliberate upgrade path if a
literal map-imagery look is ever wanted for a v2 — it is not a new policy
exception, since ADR 0010 already pre-agreed to it for exactly this trigger.
Keep Option B only as a fallback-to-the-fallback, gated on a device spike that
may simply come back negative.

> This is an assessment, not a decision to build. A build commitment belongs
> in an ADR (next free number: **0024**).

## Open questions / next steps

- **Pin the trim distance and the empty-remainder floor.** The owner's
  "roughly 75–100 m" needs a single named constant (mirroring
  `MIN_ROUTE_EXTENT_M`/`CHEVRON_*`'s naming convention in `domain/geo.ts`), and
  a decision on the minimum remaining route length below which the share
  feature shows a stats-only or "can't share a map for this run" state instead
  of a degenerate line — the same honest-degradation posture Stage 4 §8
  already established for the treadmill case, reused rather than reinvented.
- **Marker treatment at the trim boundary.** The owner's instruction ("move
  the start marker to where the trim begins") settles *that* a marker appears
  there; it leaves open whether that marker reads as an obvious "cut here"
  seam that itself hints a real address lies just beyond it — an inherent,
  disclosed limitation of distance-based trimming (the same class of
  residual honesty this project already accepts elsewhere, e.g. ADR 0021's "no
  map-matching" jaggedness), not something to solve away.
- **Both ends trimmed unconditionally, regardless of route shape.**
  Recommended for simplicity and safety: detecting loop vs. out-and-back vs.
  point-to-point to trim asymmetrically would be new, error-prone
  classification logic whose only failure mode is leaving the one case that
  matters (home) exposed. A staged plan should confirm this rather than
  reopen it.
- **Whether a dedicated "Save to Photos" button (vs. relying on the share
  sheet's own Save Image activity) is wanted** — if so, adds
  `expo-media-library` as a v2 dependency.
- **Whether a dedicated "Share to Instagram Stories" one-tap action is
  wanted** — a distinct, Instagram-specific integration (pasteboard + URL
  scheme), not delivered by the generic share sheet used here.
- **An ADR would decide:** the new port's exact surface (a `RunShareImage` or
  similarly-named port alongside `RouteMap`, per ADR 0003); the pinned
  constants; where the entry point lives (run-summary footer vs. the
  full-screen route viewer's toolbar, or both — an ADR 0013/0006 placement
  call, not a research question); and, if Option C is ever pursued, an
  explicit cross-reference back to ADR 0010 §3 recording that its
  pre-agreed trigger fired.
- **A staged plan would resolve:** which stats appear on the card (distance,
  duration, pace; elevation only once ADR 0015 lands); copy for the
  trimmed-to-nothing fallback state; and E2E coverage — the system share
  sheet is native OS chrome outside the app's own process, so Maestro can
  likely assert the sheet *appeared* but not exercise choosing an app inside
  it, which points to a manual device-checklist item alongside the existing
  Milestone-0 gate rather than a Maestro flow.
