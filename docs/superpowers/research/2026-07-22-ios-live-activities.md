# iOS Live Activity for the active run — research

Date: 2026-07-22
Status: **research / Researched** — not a decision to build.

**Question:** Can we surface the currently-active run as an iOS Live Activity
(Lock Screen + Dynamic Island) on our Expo SDK 57 / CNG stack, using official
tooling, without adding a backend or push server?

## TL;DR

- **Feasibility:** `Feasible-with-caveats` — the first-party **`expo-widgets`**
  library is **stable** (SDK 56+, not alpha/experimental; `57.0.5` on our SDK
  line) and builds Live Activities from `@expo/ui/swift-ui` (already a dep), via
  config plugin under CNG, no hand-written native. The caveats are operational,
  not library-maturity: a new widget-extension target + App Group entitlement
  (native rebuild, fingerprint change, some provisioning), a device spike to
  confirm on our SDK line, and live-while-locked segment updates depending on the
  Stage-3 Wave-C background wiring — sidesteppable with a self-rendering timer.
- **Local-first fit:** `Fully local` — updates are driven by the app itself
  (`instance.update()`), APNs left off (`enablePushNotifications: false`). No
  backend, no accounts, no analytics; App Group storage is on-device. Degrades
  gracefully exactly as [ADR 0008](../../adr/0008-background-execution-location-heartbeat.md)
  already prescribes.
- **Recommended approach:** first-party `expo-widgets`, run modeled behind a new
  `LiveActivity` port ([ADR 0003](../../adr/0003-platform-ports-and-adapters.md)),
  the countdown rendered natively with `Text(timerInterval:)` seeded from
  `RunSnapshot.segmentEndsAt` (ticks with **no JS**), and discrete `update()`
  calls on segment transitions piggybacking the engine's existing cue-firing
  seam. This is an assessment, not a commitment to build — that belongs in an ADR.

## Context

The idea: once Stage 3 gives us locked-phone GPS tracking and background audio
cues, put the active run on the Lock Screen and Dynamic Island so it's obvious a
run is in progress and one tap away — no hunting for the app. This is the
scenario ADR 0008 was built for (phone locked, in a pocket).

The C25K design spec already anticipated this and deferred it to v2, naming the
path: *"Live Activity → Deferred to v2 (official expo-widgets identified as the
path)"* and *"engine already event-driven so `update()` on segment change is a
bolt-on"*
([spec §deferred / §12](2026-07-11-c25k-app-design.md), lines 42 and 345). This
doc turns that pointer into a decidable assessment.

**ADRs / subsystems touched (linked):**
- [ADR 0007 — run engine event log](../../adr/0007-run-engine-event-log.md): the
  data source. `src/services/run-engine/` exposes a subscribable `RunSnapshot`
  (`runEngine.subscribe` / `getSnapshot`) with `segmentKind`, `segmentIndex`,
  `segmentSecondsRemaining`, `segmentEndsAt` (epoch-ms), `nextSegment`,
  `activeElapsedSeconds`, `totalSeconds`.
- [ADR 0008 — background execution](../../adr/0008-background-execution-location-heartbeat.md):
  the *only* legitimate way to run code while locked (the ~1 Hz location
  heartbeat) — and the update mechanism for segment transitions.
- [ADR 0009 — cue audio](../../adr/0009-cue-audio-tts-prerecorded-fallback.md):
  the sibling event-driven seam. `RunEngine.announceProgress` fires a cue on
  derived-segment change; a Live Activity `update()` hangs off the same point.
- [ADR 0003 — ports & adapters](../../adr/0003-platform-ports-and-adapters.md):
  a new `LiveActivity` port follows the `location-tracker` / `cue-service`
  shape (`port.ts` types-only + `adapter.ios.ts` + `index.ts`).
- [ADR 0005 — @expo/ui SwiftUI islands](../../adr/0005-system-native-ui-expo-ui.md):
  `expo-widgets` authors widget UI in `@expo/ui/swift-ui`, the same primitives
  the app already uses (`@expo/ui ~57.0.7`).
- [ADR 0019 — dynamic app.config.ts](../../adr/0019-app-variants-dynamic-config.md):
  the `plugins` spread is where a widget plugin wires in; adding a native target
  changes the fingerprint/runtimeVersion.
- [ADR 0020 — iOS-only](../../adr/0020-ios-only-android-deferred.md): Live
  Activities are iOS-only, no Android obligation.

**Inherited `AGENTS.md` hard constraints:** no backend, no accounts, no
analytics; on-device data with iCloud the only sync; iOS-only.

## Findings

- **`expo-widgets` is first-party and stable on our SDK line.** Expo announced
  *"iOS widgets and Live Activities are **stable in Expo SDK 56**"*, and the
  package tracks the SDK (`expo-widgets` `57.0.5` on the SDK-57 line). It is
  documented at the versioned SDK-57 docs and is `platforms: ['ios']`, dev-build
  only (not Expo Go — we already use expo-dev-client).
  ([Expo blog — stable in SDK 56](https://expo.dev/blog/ios-widgets-and-live-activities-in-expo);
  [expo-widgets on npm](https://www.npmjs.com/package/expo-widgets);
  [SDK 57 Widgets docs](https://docs.expo.dev/versions/latest/sdk/widgets/),
  verified 2026-07-22)
- **Live Activities API is `createLiveActivity` + `start` / `update` / `end`,
  local by default.** `createLiveActivity(name, component)` registers the layout
  at runtime; the instance API is `start(props, url?)` → `instance.update(props)`
  → `instance.end(dismissalPolicy, props, contentDate)`, with UI authored in
  `@expo/ui/swift-ui` (a `'widget'` directive, compiles to SwiftUI), no
  hand-written native. Data shares via App Groups (`groupIdentifier`). Remote
  updates are **opt-in** behind `enablePushNotifications: true` (`getPushToken()`
  / `addPushTokenListener()`); leaving it off keeps updates purely in-app.
  ([SDK 57 Widgets docs](https://docs.expo.dev/versions/latest/sdk/widgets/),
  verified 2026-07-22)
- **Live Activities do *not* use timelines — that's the home-screen-widget
  path.** `expo-widgets` spans two distinct surfaces: home-screen **Widget
  timelines** (`updateSnapshot` / `updateTimeline` / `getTimeline` — WidgetKit's
  TimelineProvider, scheduling future entries) and **Live Activities**
  (`createLiveActivity` + immediate ActivityKit `update()` calls). We build a
  Live Activity, so timelines are irrelevant here; the run's per-second tick is
  the self-rendering timer text, not a scheduled timeline entry.
  ([SDK 57 Widgets docs](https://docs.expo.dev/versions/latest/sdk/widgets/),
  verified 2026-07-22)
- **A Live Activity can self-render a countdown with no code running.**
  `Text(timerInterval:)` / `ProgressView(timerInterval:)` tick in the OS without
  push or background execution — Apple's own guidance for timer/progress
  displays. Only *discrete* changes (our walk↔run segment label) need an
  `update()`. ([Apple forums — changing a Live Activity without push](https://developer.apple.com/forums/thread/715138);
  [Apple — starting/updating with ActivityKit push](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications),
  verified 2026-07-22)
- **Programmatic (non-push) updates require the app to be running** — and we
  have a legitimate window. Apple limits background execution, but our run
  already keeps JS alive ~1 Hz via the location heartbeat (ADR 0008), the same
  window in which cues fire (ADR 0009). A segment-transition `update()` rides
  that existing, justified mechanism — it is **not** the disallowed
  "fake 1-second refresh" trick reviewers reject, because our updates are
  event-sparse (segment boundaries, ~every 60–90 s) and the timer itself
  self-renders. ([Apple forums — update without push, app backgrounded](https://developer.apple.com/forums/thread/717544);
  [Medium — background refresh caveats](https://medium.com/@pietromessineo/refresh-live-activities-in-background-every-second-is-possible-a9fecf34783a),
  verified 2026-07-22)
- **iOS floor is a non-issue for our users.** Live Activities require iOS 16.1+
  (Lock Screen on every iPhone ≥16.1; Dynamic Island only on iPhone 14 Pro and
  newer). Our effective floor is far higher — ADR 0010 sets an iOS 18.0 map
  floor and we target iOS 26 — so availability is runtime-gated and universally
  present for the real user base; older/non-Pro hardware simply gets the Lock
  Screen or nothing, gracefully.
  ([Apple Support — Live Activities in the Dynamic Island](https://support.apple.com/guide/iphone/view-live-activities-in-the-dynamic-island-iph28f50d10d/ios);
  [LogRocket — Live Activities API](https://blog.logrocket.com/exploring-ios-live-activities-api/),
  verified 2026-07-22)
- **`NSSupportsLiveActivities = YES` in the *app's* Info.plist is required** (not
  the extension's) or activities fail silently — a known gotcha. Our generated
  `Info.plist` does not have it today, and the app entitlements file is empty
  (no App Group yet). ([expo-apple-targets widget skill — Gotchas](https://github.com/evanbacon/expo-apple-targets),
  via Context7, verified 2026-07-22; codebase scan 2026-07-22)
- **Maturity — stable, not alpha; one SDK-55-era bundling bug to verify past.**
  `expo-widgets` carries no alpha/beta/experimental banner and has been stable
  since SDK 56. The one notable reported failure (widgets/Live Activities render
  blank when the JS runtime bundle isn't copied into the widget extension —
  [expo/expo#43646](https://github.com/expo/expo/issues/43646)) was filed
  2026-03-04 against **SDK 55** (`expo-widgets` 55.0.0–55.0.2) and closed
  *incomplete* — an early-version build-config bug, not an SDK-57 blocker. A
  device spike confirms it's past; that's standard diligence for any new
  widget-extension target, not a sign of library instability. (verified 2026-07-22)
- **The clean bolt-on already exists in our code.** `RunSnapshot.segmentEndsAt`
  (epoch-ms) is exactly the value a native `Text(timerInterval:)` needs, and
  `RunEngine.announceProgress` (fires cues on derived-segment change) is the
  precise seam to also call `update()`. Zero existing ActivityKit / `expo-widgets`
  / `@bacons/apple-targets` code in the repo. (codebase map, verified 2026-07-22)
- **Dependency: the background heartbeat is built-but-unwired.** `locationTracker`
  (the `runbro-location-updates` task), `run-store`, and the point-batch
  scheduler exist and are tested but not yet driving `runEngine.heartbeat()` —
  that's Stage-3 "Wave C". Until it lands, JS advances the engine only in
  foreground; a Live Activity that depends on background segment updates depends
  on Wave C — **unless** it leans on `Text(timerInterval:)` (needs no JS).
  (codebase map, verified 2026-07-22)

## Options

### Option A — First-party `expo-widgets`, local updates (recommended)

Add `expo-widgets` and its config plugin; author the Lock Screen + Dynamic Island
presentation in `@expo/ui/swift-ui`. Model the run as one Live Activity:
`start()` on run start (foreground), the segment/total countdown as a native
`Text(timerInterval:)` seeded from `segmentEndsAt` (self-ticks, no JS while
locked), and `update()` on each segment transition — called from the existing
`RunEngine.announceProgress` cue seam (ADR 0009), behind a new `LiveActivity`
port (ADR 0003). `enablePushNotifications` stays **false**. `end()` on
finish/abandon.

*Trade-offs:* first-party (aligns with the official-tooling preference); reuses
`@expo/ui` we already ship; engine already exposes the perfect data. Costs a
widget-extension target + App Group + `NSSupportsLiveActivities` (native rebuild,
fingerprint bump, some EAS provisioning); inherits the young-library risk
(#43646 class) needing a device spike; background segment freshness depends on
Wave C (mitigated by the self-rendering timer).

### Option B — Community `@bacons/apple-targets` + hand-written SwiftUI widget

Use Evan Bacon's `@bacons/apple-targets` config plugin to add the widget target,
write the `ActivityAttributes` + SwiftUI widget by hand, and bridge start/update/
end through a local native module; share state via `ExtensionStorage`
(App Group) + `reloadWidget()`.

*Trade-offs:* the mature, pre-`expo-widgets` route with the most control over the
SwiftUI. But it's **community tooling** (a `@bacons/*` namespace, not `expo-*`) —
allowed only as an explicit, priced exception under the official-tooling
preference (the way ADR 0010 treats react-native-maps) — and it adds real
hand-written Swift + a bespoke native module to maintain. Best kept as the
**fallback** if an `expo-widgets` spike proves too rough on SDK 57.

### Option C — Timer-only Live Activity (MVP scope of A)

Same as A, but ship **only** the self-rendering `Text(timerInterval:)` countdown
+ static run label, and refresh the segment label only when the app returns to
foreground (no background `update()`).

*Trade-offs:* lowest effort and complexity, and it **doesn't depend on Wave C**
at all (no JS runs while locked). It's fully local and still delivers the core
value (an obvious, glanceable, tappable active-run surface with a live ticking
timer). The cost is that the walk↔run label can be stale while locked until
foreground. Natural **phase 1** of Option A rather than a permanent end state.

**Rejected alternative (not a live option): ActivityKit push updates.** Turning
on `enablePushNotifications: true` and pushing `update()`s via APNs would need a
push server / backend to hold tokens and send updates — a direct violation of the
`AGENTS.md` no-backend constraint. Documented here so it isn't rediscovered as an
"option"; it fails the local-first lens, not feasibility.

## Comparison

| | A — first-party `expo-widgets` | B — `@bacons/apple-targets` | C — timer-only MVP |
|---|---|---|---|
| Feasibility | Feasible-with-caveats (young lib; native target) | Feasible (mature; more hand-written native) | Feasible (least surface; no Wave-C dep) |
| Local-first | Fully local (`update()`, push off) | Fully local (`ExtensionStorage`) | Fully local (self-rendering only) |
| Battery / power | Negligible — OS renders timer; sparse `update()` piggybacks existing heartbeat, no new wakeups | Same | Best — zero incremental (no background work) |
| Platform reach | iOS 16.1+ (Lock Screen all; DI iPhone 14 Pro+) — below our effective floor | Same | Same |
| Cost | $0 recurring (paid dev acct already in place; no push server) | $0 recurring | $0 recurring |
| Maintenance / tooling | First-party — matches official-tooling preference | Community — priced exception only | First-party (subset of A) |

## Feasibility assessment

**`Feasible-with-caveats`.** The capability is real and buildable on Expo SDK 57
+ CNG with official tooling: `expo-widgets` is first-party, stable since SDK 56,
version-matched to our SDK, config-plugin-driven (no hand-written native), and
authors UI in the `@expo/ui/swift-ui` primitives we already depend on. The run
engine already exposes an ideal, subscribable data source, and the cue-firing
seam gives a one-line hook for `update()`. The caveats are what make it
"with-caveats," not "feasible":

1. **A new native target + entitlements.** A widget extension, an App Group, and
   `NSSupportsLiveActivities` in the app Info.plist are required. All go through
   config plugins (never hand-edited `ios/`), but they change the
   `@expo/fingerprint` hash → a native rebuild (not OTA) and some EAS
   provisioning ceremony (App Group id, signing).
2. **Young-library risk.** The blank-widget bundling class (#43646, SDK 55)
   shows the tooling is still settling. A device spike on the SDK-57 line — build,
   start/update/end a trivial activity, confirm it renders locked — must gate any
   ADR.
3. **Wave-C coupling for background freshness.** Live segment-label updates while
   locked need the location heartbeat driving the engine (built-but-unwired). The
   `Text(timerInterval:)` self-render removes this from the critical path for the
   timer; only the label freshness depends on it (Option C ships without it).

Effort is moderate: one port + adapter, one widget UI, plugin + entitlement
wiring, and a device spike. No `bun test`-level engine changes (the data already
exists).

## Local-first assessment

**`Fully local`.** Every update path is in-app: `instance.update()` runs in our
own process, `enablePushNotifications` stays off, so there is no APNs token, no
push server, no backend, no account, no analytics. App Group shared storage is
on-device. The feature holds every `AGENTS.md` hard constraint.

Graceful degradation matches ADR 0008 exactly: the OS-rendered
`Text(timerInterval:)` countdown *always* ticks (even with location denied and
the phone locked); segment-label `update()`s ride the same background window as
cues, so when location is denied they simply catch up on foreground — the same
honest degradation ("cues stop while locked") ADR 0008 already documents, with no
new coupling and no offline penalty. iCloud remains the only sync; a Live
Activity introduces no network surface.

## Recommendation

**Option A**, phased so that **Option C is phase 1**: ship the self-rendering
timer Live Activity first (fully local, no Wave-C dependency, immediate glanceable
value), then add background segment-label `update()`s once Stage-3 Wave C wires
the heartbeat into the engine. Build it behind a `LiveActivity` port so the
engine and screens stay ignorant of ActivityKit (ADR 0003), and hook `update()`
onto the existing `RunEngine.announceProgress` seam so segment cues and Live
Activity updates fire from one derived-segment-change point. Keep `@bacons/apple-targets`
(Option B) as the named fallback if an `expo-widgets` device spike proves too
rough on SDK 57.

> This is an assessment, not a decision to build. A build commitment belongs in
> an ADR.

## Open questions / next steps

- **Device spike first.** Before any ADR: on a release-config SDK-57 dev build,
  add `expo-widgets`, start/update/end a trivial Live Activity, and confirm it
  renders on a locked device (guards against the #43646 bundling class). This is
  the go/no-go, analogous to the ADR 0008 Milestone-0 gate.
- **An ADR would decide:** the App Group identifier and entitlement/plugin wiring
  (app.json vs the app.config.ts `plugins` spread, ADR 0019); the exact
  `LiveActivity` port surface (`start(session)` / `update(snapshot)` / `end()`);
  where the port is composed and how it subscribes to `runEngine`; and the
  fingerprint/runtimeVersion implication of the new native target (native build,
  not OTA — coordinate with ADR 0012).
- **A staged plan would resolve:** the phase-1 (timer-only) vs phase-2
  (background segment updates) split and its dependency on Stage-3 Wave C; the
  Lock Screen + Dynamic Island (compact/expanded/minimal) layouts in
  `@expo/ui/swift-ui`; pause/resume/skip/end reflected in the activity; the
  end-of-run dismissal policy; and E2E/QA coverage (Live Activities are not
  Maestro-testable — a manual device checklist, per the ADR 0008 pattern).
