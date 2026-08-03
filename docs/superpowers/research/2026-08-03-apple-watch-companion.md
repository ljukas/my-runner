# Apple Watch companion for RunBro — research

Date: 2026-08-03
Status: **research / Researched** — not a decision to build.

**The question as asked:** *"Would `expo-sensors` work then when the app is active
on the watch but the screen on the phone is turned off (in pocket)?"*

**The question behind it:** what is the real architecture for an Apple Watch
companion on Expo SDK 57 + CNG, and what does it mean for sensor capture
(barometer/altimeter, GPS, heart rate) while the phone is pocketed and locked?

---

## The literal question, answered first

**No — and the premise doesn't hold.** `expo-sensors` cannot run on the watch at
all. It is a React Native module whose iOS podspec declares
`s.platforms = { :ios => '16.4' }` and nothing else; React Native itself has no
watchOS support and Hermes has no watchOS build. There is no state in which "the
app is active on the watch" means "`expo-sensors` is running there" — a Watch
companion is a **separate native watchOS target written in Swift/SwiftUI**, and
no JavaScript of any kind executes on it.

But the question was aimed at the right problem, and the answer to *that* is
better than expected: **the barometer very likely already works on the pocketed,
locked phone, with no Watch involved** — because `expo-sensors`' `BarometerModule`
does **not** stop updates on background. See Finding C1, which corrects
[ADR 0015](../../adr/0015-run-elevation-on-device-barometer.md) open item 7.

## TL;DR

- **Feasibility of a Watch companion:** `Feasible-with-caveats`, but the caveats
  are structural rather than incidental. A watchOS app is a native Swift/SwiftUI
  target embedded in the iOS app bundle. Under CNG the only path that respects
  "never hand-edit `ios/`" is the **community** `@bacons/apple-targets` plugin
  (`type: "watch"`), whose watch wiring needed four prebuild-correctness fixes in
  Feb 2026 and which declares no SDK 57 support. Watch↔phone talk goes over
  `WatchConnectivity` (community `react-native-watch-connectivity@2.0.0`, or
  HealthKit's own mirroring channel). **This is the largest single scope increase
  the roadmap has ever considered** — a second app, a second language, a second
  UI framework, none of it shared with the existing codebase.
- **Local-first fit:** `Fully local` — WatchConnectivity is a peer-to-peer link
  between two devices the user owns; HealthKit mirroring is likewise on-device.
  No backend, no account, no analytics. This is the one lens the feature passes
  cleanly.
- **The finding that most likely changes the plan:** the *reason* to want a Watch
  (background sensors) is largely already available on the phone. ADR 0015's open
  item 7 rests on a factual error, `HKWorkoutSession` on iPhone (new in iOS 26)
  does **not** grant background execution, and ADR 0008's location heartbeat
  remains the only aliveness mechanism — which is exactly what it already is.
- **Recommended status:** `Researched`. **No ADR yet.** The de-risking step is not
  a Watch spike; it is the ~1-hour barometer device spike ADR 0015 already
  demands, which either removes the main motivation for a Watch or sharpens it.

## Context

The idea: add an Apple Watch companion so runs can be driven from the wrist.
Framed by the owner as a sensor question — if the watch is doing the work, does
the pocketed phone still need to?

**ADRs / subsystems touched (linked):**

- [ADR 0008 — background execution](../../adr/0008-background-execution-location-heartbeat.md):
  the whole premise. Locked-phone operation rides on When-In-Use background
  location; each ~1 Hz delivery runs the `runbro-location-updates` TaskManager
  task headlessly, which is what keeps JS alive. Its *Alternatives considered*
  already rejects "HKWorkoutSession-style workout keep-alive" as watchOS-only —
  **that judgement survives iOS 26 intact** (Finding D2), though the API surface
  it describes has changed.
- [ADR 0015 — on-device barometer elevation](../../adr/0015-run-elevation-on-device-barometer.md):
  open item 7 gates the whole barometer path on an unverified claim that "the
  expo-sensors iOS module stops updates on background per its source". **That
  claim is wrong** (Finding C1).
- [2026-08-02 run elevation & pace design](../specs/2026-08-02-run-elevation-and-pace-chart-design.md)
  §3.5/§3.6: GPS altitude was measured and found unusable for both totals and the
  drawn line; elevation was deferred whole, to arrive "with the barometer, on a
  source that can carry both honestly". The barometer is therefore the *next*
  slice, and its background behaviour is the open question this doc addresses.
- [ADR 0011 — Apple Health](../../adr/0011-apple-health-kingstinct-healthkit.md) +
  [the capability ledger](../../healthkit-capability-ledger.md): write-only, no
  background delivery, no heart rate. Amendment 1 dropped `activeEnergyBurned`
  precisely because "the app has no heart rate… any kcal figure would be
  fabricated". A Watch is the only thing that changes that.
- [ADR 0003 — ports & adapters](../../adr/0003-platform-ports-and-adapters.md):
  a Watch is not a new adapter behind an existing port. It is a second host.
- [ADR 0007 — event-log run engine](../../adr/0007-run-engine-event-log.md): more
  relevant than it looks. A wall-clock-derived engine is *replicable* — see
  Finding E3.
- [ADR 0020 — iOS-only](../../adr/0020-ios-only-android-deferred.md) and
  [ADR 0022 — Live Activity via expo-widgets](../../adr/0022-active-run-live-activity-expo-widgets.md):
  the Live Activity decision is a near neighbour and a cheaper substitute for
  some of what a Watch would deliver.

**Inherited `AGENTS.md` hard constraints:** no backend, no accounts, no analytics;
on-device data with iCloud the only sync; iOS-only. `ios/` is generated by
`expo prebuild` and never hand-edited. App `ios.deploymentTarget` is **17.0**
(`app.json`, verified) — relevant because two APIs below are iOS 26+.

**Verification convention.** Every finding is marked `[VERIFIED]` (read from
installed source, the local Xcode SDK, or a primary Apple/vendor document),
`[INFERRED]` (reasoned from verified primitives), or `[UNDETERMINED]`.

---

## Findings

### A. React Native / Expo on watchOS

**A1. React Native cannot run on watchOS. `[VERIFIED]`**
React Native's out-of-tree platform list covers macOS, Windows, visionOS, tvOS,
Web and Skia/Linux — **watchOS is absent**
([reactnative.dev/docs/out-of-tree-platforms](https://reactnative.dev/docs/out-of-tree-platforms),
checked 2026-08-03). Decisively, the JS engine has no watchOS slice: RN 0.86.2's
`hermes-engine.podspec` declares
`spec.platforms = { :osx => "10.13", :ios => "15.1", :visionos => "1.0", :tvos => "15.1" }`
— no `:watchos`, and the vendored frameworks exist for ios/tvos/xros only
([hermes-engine.podspec @ v0.86.2](https://raw.githubusercontent.com/facebook/react-native/v0.86.2/packages/react-native/sdks/hermes-engine/hermes-engine.podspec)).
`React-Core.podspec` likewise maps only `:ios`.

**A2. Expo has no watchOS story. `[VERIFIED, with one gap]`**
There is no Apple Watch or watchOS guide page in the Expo docs; watchOS appears
only incidentally (App Attest extensions, Sign in with Apple, `ios-capabilities`
listing scheme kinds, and expo-widgets' Live Activity `bannerSmall` fallback
"displayed in CarPlay and WatchOS"). Confirmed locally too: **no installed
`expo-module.config.json` in this repo declares `watchos`**, `@expo/ui`'s podspec
is `{ :ios => '16.4', :tvos => '16.4' }`, and `expo-location`'s is `:ios` only.
`[UNDETERMINED]`: what Expo maintainers have *said* about watchOS — GitHub code
and issue search were non-functional during this research, so read this as "not
established", never as "maintainers said nothing".

**A3. A watchOS target is Xcode project structure — exactly what CNG owns and
regenerates. `[VERIFIED]`**
A watch app is embedded inside the iOS app bundle (moved to `PlugIns/` as of
Xcode 26), requires an embed build phase on the iOS target, and carries
`WKCompanionAppBundleIdentifier` pointing at the iOS bundle id — Apple's own
multidevice sample instructs exactly that step. All of it lives in the `.xcodeproj`
that `expo prebuild` throws away and rebuilds. **A hand-added watch target does
not survive prebuild.** One widely-circulated 2026 tutorial proposes tracking git
diffs of `ios/` and manually restoring them; that is a direct violation of this
repo's CNG rule and should be treated as a worked example of the wrong answer.

**A4. The one CNG-respecting path is `@bacons/apple-targets`, and it is community
tooling. `[VERIFIED]`**
`watch` and `watch-widget` are both supported target types — verified in the
published tarball, not just the README: `build/target.d.ts` carries
`watch: { productType: "com.apple.product-type.application", needsEmbeddedSwift: true }`
and `"watch-widget"` for complications; `build/configuration-list.js` sets
`SDKROOT: "watchos"` and `WATCHOS_DEPLOYMENT_TARGET`. The mechanism is the whole
point: source lives in a root `/targets/<name>/` directory **outside `ios/`**, and
prebuild re-links it every time, so `ios/` stays disposable. It also ships
`withAutoEasExtensionCredentials`, writing targets into
`extra.eas.build.experimental.ios.appExtensions` so EAS provisions them.

Priced honestly: **`5.0.0`, published 2026-07-17, `peerDependencies: { expo: ">=52" }`**,
README says "Expo SDK +53"; the newest SDK-specific commits reference SDK 55 and
56. **No source states SDK 57 support** `[INFERRED, leaning yes]`. It is published
under the personal `@bacons` npm scope — Evan Bacon works at Expo, but this is
**not** an `expo`-scoped package and carries no Expo support guarantee. Watch
support specifically was patched four times in Feb 2026
([#168](https://github.com/EvanBacon/expo-apple-targets/issues/168),
[#175](https://github.com/EvanBacon/expo-apple-targets/issues/175),
#178, #179) for embed/dependency wiring that prebuild got wrong.

**A5. `expo-widgets` — the first-party neighbour — cannot make a watch target.
`[VERIFIED]`** Its podspec is `{ :ios => '16.4' }`. It builds Home Screen widgets,
Lock Screen accessories and Live Activities. No watch complications, no watchOS
target generation.

**A6. Watch UI is hand-written SwiftUI; nothing renders React on the watch.
`[VERIFIED]`** `@expo/ui` is iOS+tvOS only (A2). `react-native-watch-connectivity`'s
own README is explicit: *"This library does not allow you to write your Apple Watch
apps in React Native but rather allows your RN iOS app to communicate with a watch
app written in Obj-C/Swift."* Every real-world precedent found — an EAS
widget/watch example repo, a 2024 bidirectional-communication writeup on RN
0.76/SDK 52, a 2026 Medium tutorial — follows the identical shape: **hand-written
SwiftUI watch target + a WatchConnectivity bridge.**

**A7. The bridge is maintained but community. `[VERIFIED]`**
`react-native-watch-connectivity@2.0.0`, published 2026-03-20 after a ~3.5-year
dormancy (previous release 1.1.0, 2022-09-29). It is a proper Turbo Module
(`codegenConfig` present, `ios/WatchConnectivity.mm`), devDeps pinned to RN 0.84 /
React 19.2.3, README floor "React Native 0.76+". **It ships no Expo config plugin**
— fine under CNG autolinking, but nothing Expo-specific. RN 0.86 / SDK 57
compatibility is `[INFERRED]`, not stated anywhere. The alternative,
`@plevo/expo-watch-connectivity`, is a real Expo module but has two published
versions ever (latest 2025-12-21) and is near-dormant. **No first-party Expo
WatchConnectivity package exists.**

### B. `expo-sensors`' watchOS story

**B1. There is none. `[VERIFIED]`** `expo-sensors@57.0.2`'s
`expo-module.config.json` declares `"platforms": ["apple", "android"]`, and its
podspec pins `s.platforms = { :ios => '16.4' }` — no watchOS. The package is not
currently installed in this repo (`node_modules/expo-sensors` absent; it is not in
`package.json`), so everything here was read from the published `57.0.2` tarball.

**B2. So the literal question has a one-sentence answer.** `expo-sensors` never
runs on the watch, so nothing about a Watch companion makes `expo-sensors` work or
not work — the barometer question is, and remains, a question about the **iPhone**.

### C. The real question: background sensor capture on a pocketed, locked iPhone

**C1. ADR 0015 open item 7 rests on a factual error. `[VERIFIED]`**
The ADR says implementation must verify background barometer delivery because
"the expo-sensors iOS module stops updates on background per its source". Read
against `expo-sensors@57.0.2`'s actual iOS source, that is not what the Barometer
does. `ios/BarometerModule.swift` defines exactly four blocks — `OnStartObserving`
(calls `altimeter.startRelativeAltitudeUpdates`), `OnStopObserving`, `OnDestroy`,
and the availability/interval functions. **There is no `OnAppEntersBackground`.**
A repo-wide grep for background/foreground lifecycle handling across
`expo-sensors`' entire `ios/` directory returns matches in exactly one file:

```
ios/PedometerModule.swift:94:    OnAppEntersBackground {
ios/PedometerModule.swift:98:    OnAppEntersForeground {
```

The **Pedometer** stops and restarts on background. The Barometer, Accelerometer,
Gyroscope, Magnetometer and DeviceMotion modules do not. The JS layer adds nothing
— `src/DeviceSensor.ts` is a thin `addListener`/`listenerCount` wrapper with **no
`AppState` handling anywhere in `src/`**, so `OnStartObserving` fires when the
listener count goes 0→1 and native updates continue until the last listener is
removed. Nothing in the module pauses the altimeter when the app backgrounds.

**C2. Apple documents the gate as *suspension*, not backgrounding — and documents
it for CoreMotion's siblings but not for the altimeter. `[VERIFIED]`**
Read from the local Xcode SDK headers (iPhoneOS26.5.sdk), the same method the
HealthKit capability ledger uses:

- `CMMotionActivityManager.h:94-97` — *"Updates are **not delivered while the
  application is suspended**, the application may use
  `queryActivityStartingFromDate:toDate:toQueue:withHandler:` to get activities
  from the time when the application was suspended."*
- `CMPedometer.h:291-294` — *"If the app is **backgrounded and resumed** at a later
  time, the app will receive all of the pedestrian activity accumulated during the
  background period in the very next update."*
- `CMAltimeter.h` — **no statement about background or suspension at all.** Its
  only relevant note is cadence: relative altitude arrives *"every few seconds"*,
  not at 1 Hz.

Apple's web documentation for `CMAltimeter` and
`startRelativeAltitudeUpdates(to:withHandler:)` is equally silent on background
behaviour; it documents only the `NSMotionUsageDescription` requirement (which
`expo-sensors`' config plugin supplies) and availability (iOS 8.0+, watchOS 2.0+).

**C3. Therefore: under ADR 0008's heartbeat the barometer should keep delivering —
and this is now a narrow device question, not an architectural one. `[INFERRED]`**
The consistent framing across CoreMotion is that delivery stops when the *process
is suspended*. ADR 0008 exists precisely to prevent suspension: the location
stream keeps the process running, which is why cues fire while locked. A running
process with a live `CMAltimeter` handler and no lifecycle pause in the module is
the configuration in which CoreMotion delivers. I could not find an Apple document
that says this in so many words, so it stays `[INFERRED]` — but the blocker ADR
0015 named (module-level background pause) **provably does not exist**, which
changes the spike from "find out whether this approach is viable" to "confirm the
expected behaviour on a device".

**C4. A hard constraint the elevation design has not yet accounted for: altimeter
data cannot be backfilled. `[VERIFIED]`**
`CMPedometer` and `CMMotionActivityManager` both expose historical queries and
explicitly replay what accumulated while the app was away (C2). `CMAltimeter`
exposes **no history API whatsoever** — there is no `queryAltitude…` equivalent in
the header. `CMSensorRecorder` records **accelerometer only**
(`recordAccelerometerForDuration:` / `accelerometerDataFromDate:toDate:`), and
while a `CMRecordedPressureData` *type* exists (iOS 12+), a grep across every
CoreMotion header finds **no public API that returns one**.

The consequence is asymmetric and worth designing around: if the process is ever
suspended mid-run, GPS distance survives (points are already persisted) but the
altitude gained during that window is **gone permanently and unrecoverably**. Any
barometer implementation needs an explicit story for gaps — most honestly,
detecting the gap and declining to report a total, rather than silently
under-reporting.

**C5. What actually keeps working on a locked, pocketed phone, summarised.**

| Capability | Locked + pocketed, location running | Locked + pocketed, no location |
|---|---|---|
| CoreLocation / GPS track | ✅ works — ADR 0008's verified mechanism | ❌ nothing wakes JS |
| JS run engine + cues | ✅ heartbeat-driven (ADR 0008 §4) | ❌ stops when display sleeps |
| `CMAltimeter` relative altitude | ✅ expected `[INFERRED, C3]`, ~"every few seconds" | ❌ and unrecoverable (C4) |
| HealthKit **writes** | ✅ deferred to run end anyway (ADR 0011 §4) | ✅ same |
| Heart rate | ❌ no sensor on iPhone, at all | ❌ |

### D. `HKWorkoutSession` — the mechanism this app is not using

**D1. On watchOS it is the extended-runtime contract. `[VERIFIED]`**
Apple: *"When your app has an active workout session, it continues to run in the
background… even when the user lowers their wrist or interacts with a different
app… Your app continues to receive data from HealthKit and Apple Watch's sensors
in the background… Your app can alert the user using audio or haptic feedback
while running in the background."* This is gated by a background mode —
and the key is *which* key it lives under: **`WKBackgroundModes`, documented as
watchOS 3.0+ only**, whose `workout-processing` value "Allows an active workout
session to run in the background."

**D2. On iPhone it grants no such thing — and ADR 0008 was right. `[VERIFIED for
the primitives, INFERRED for the conclusion]`**
`UIBackgroundModes` has thirteen documented values — `audio`,
`bluetooth-central`, `bluetooth-peripheral`, `external-accessory`, `fetch`,
`location`, `nearby-interaction`, `network-authentication`, `newsstand-content`,
`processing`, `push-to-talk`, `remote-notification`, `voip` — and **none of them
is a workout mode**. `workout-processing` exists only under `WKBackgroundModes`,
which is watchOS-only. There is no iOS equivalent of the watchOS contract.

What iOS 26 *does* give a workout session, per WWDC25 session 322's transcript, is
a different thing entirely — **data access while locked, not process aliveness**:
*"unlike Apple Watch, your iPhone will most likely lock while a workout is running.
For privacy reasons, health data is not normally available while a device is
locked, but never fear. The first time a workout session is started, the system
will show a prompt indicating that workout data will be available to your app,
even while the device is locked."* Apple's recommended way to *show* anything in
that state is a Live Activity plus Siri intents, not a running app. And the session
ships with **crash recovery** (`recoverActiveWorkoutSession`, iOS 26.0+, and a
`shouldHandleActiveWorkoutRecovery` scene-connection option) — an API that only
makes sense if your process is not guaranteed to survive the workout.

So ADR 0008's *Alternatives considered* line — *"`HKWorkoutSession` background
execution is watchOS; iPhone apps get no equivalent process guarantee from
HealthKit"* — **is still correct after iOS 26.** Worth an amendment note only
because the API surface it describes has changed underneath it.

**D3. The iPhone-side API is newer than "iOS 17", and above this app's floor.
`[VERIFIED]`** The `HKWorkoutSession` *class* is iOS 17.0+, but in iOS 17–18 an
iPhone could only ever hold a session **mirrored from a Watch**. The initializer
that lets an iPhone start its own — `init(healthStore:configuration:)` — is
**iOS 26.0+** (watchOS 5.0+). `recoverActiveWorkoutSession` is likewise iOS 26.0+.
This app's `ios.deploymentTarget` is **17.0**, so any use would need runtime
gating and would benefit only iOS 26+ users.

**D4. What it would nonetheless buy RunBro on the phone, if adopted. `[INFERRED]`**
Not aliveness — ADR 0008 already owns that, and better. But three real things:
(a) HealthKit data readable while locked, which matters only if the app ever reads;
(b) `HKLiveWorkoutBuilder` auto-collecting system-generated distance and energy,
which would let the app write an honest `activeEnergyBurned` that ADR 0011
amendment 1 had to drop — *system-generated*, therefore not fabricated;
(c) a first-class recovery path after a crash mid-run. Against that: it is iOS
26+, it adds a second source of truth for distance alongside the app's own GPS
track, and none of it is reachable through the current HealthKit library (the
capability ledger records no `HKWorkoutSession`/`HKWorkoutBuilder` bridging at all
— `HKWorkoutRouteBuilder` is the only builder present). **It is a separate
research question, not a Watch question.**

**D5. The genuinely interesting Watch-specific mechanism: mirroring.
`[VERIFIED]`** `startMirroringToCompanionDevice` (watchOS 10.0+) starts a mirrored
session on the companion iPhone, and `HKHealthStore.workoutSessionMirroringStartHandler`
(iOS 17.0+) documents the payoff plainly: *"The system calls this block on the
companion iPhone when someone starts a mirrored workout on Apple Watch. **If your
iOS app isn't active, the system launches it in the background.**"* Paired with
`sendToRemoteWorkoutSession(data:)` (iOS 17 / watchOS 10), that is a documented
background-launch **and** a HealthKit-native bidirectional message channel that
bypasses WatchConnectivity entirely for in-workout data. It is the strongest
aliveness story available to this app — but it only exists when the **watch owns
the session**, which inverts the current architecture (Finding E).

### E. Phone↔Watch division of labour

**E1. WatchConnectivity guarantees, read from the SDK header. `[VERIFIED]`**
(`WatchConnectivity.framework/Headers/WCSession.h`, iPhoneOS26.5.sdk.) There are
two tiers and the header is blunt about both:

- **Interactive — `sendMessage:` / `sendMessageData:`.** *"Interactive messages can
  only be sent between two actively running apps. They require the counterpart app
  to be reachable."* And: *"Messages can only be sent while the sending app is
  running. If the sending app exits before the message is dispatched the send will
  fail. If the counterpart app is not running the counterpart app will be launched
  upon receiving the message (**iOS counterpart app only**)."* Note the asymmetry —
  the watch can launch the phone app; the phone cannot launch the watch app.
- **Background — `updateApplicationContext:`, `transferUserInfo:`,
  `transferFile:`.** *"Background transfers continue transferring when the sending
  app exits… **The system will transfer content at opportune times.**"* Delivery is
  reliable; **timing is explicitly not guaranteed**, and the counterpart "will
  receive a delegate callback on next launch". `updateApplicationContext:` is
  latest-state-only (a later update overwrites an undelivered earlier one);
  `transferUserInfo:` is a queue you can inspect via `outstandingUserInfoTransfers`.

There is **no latency bound anywhere in the API**. A design that needs
sub-second cross-device agreement cannot be built on WatchConnectivity. One more
trap: `iOSDeviceNeedsUnlockAfterRebootForReachability` — reachability from the
watch requires the iPhone to have been unlocked at least once since reboot.

**E2. What the Watch actually owns that the phone cannot. `[VERIFIED]`**
This is the honest case for the feature, and it is not "background sensors":

- **Heart rate.** The iPhone has no heart-rate sensor — Apple states it outright,
  and WWDC25 322 confirms the workaround is a Bluetooth strap. A Watch is the only
  way RunBro ever gets HR, and therefore the only way it ever writes an honest
  `activeEnergyBurned` (ADR 0011 amendment 1).
- **Extended runtime that is actually guaranteed** (D1), rather than inferred from
  a location stream.
- **Haptics on the wrist** — for a walk↔run coach, arguably a better cue channel
  than audio, and one ADR 0009 cannot reach.
- **A barometric altimeter** (Apple Watch Series 3 and later; always-on from
  Series 6 / SE 2), and `CMBatchedSensorManager` — **watchOS 10.0+ only**,
  verified in the watchOS SDK header — for high-frequency batched motion during
  workouts.

**E3. Who should own what — and why this codebase is unusually well-placed.
`[INFERRED]`**

- **The run engine: replicate, don't stream.** ADR 0007's engine is a wall-clock,
  event-log state machine. Two devices given the same `startedAt` and the same
  (small, append-only) event log derive **identical** segment state without any
  continuous sync — the only messages that need crossing are start/pause/resume/
  skip/end, which are rare, small, and property-list-shaped. That is a natural fit
  for `transferUserInfo:`'s reliable-but-untimed queue, with `sendMessage:` as the
  low-latency path when both apps happen to be running. Drift is bounded by clock
  skew, not by message latency. **Do not stream `RunSnapshot` at 1 Hz across the
  link** — it is the one design that WatchConnectivity's guarantees cannot support.
- **The GPS track: exactly one owner, and it should be the watch if the watch
  exists.** Dual recording produces two routes, two distances, and two HealthKit
  workouts. If the watch owns the session, D5's mirroring gives the phone a
  documented background launch and a native channel, and the phone becomes the
  history/UI device. If the phone owns it, the watch is a remote control and the
  whole heart-rate argument weakens.
- **Cues: split by channel.** Audio stays on the phone (that is where headphones
  pair, and where ADR 0009's TTS lives); haptics move to the wrist. They fire from
  the same derived-segment-change seam on each device.
- **When they drift:** the phone's SQLite (ADR 0004) stays the single source of
  truth for *saved* runs, and reconciliation happens once at run end rather than
  continuously. `HKSyncIdentifier` (ADR 0011 amendment 6) already gives a
  dedupe key for the Health write, which is the one place a double-save would be
  user-visible.

### F. Local-first fit

**F1. Nothing here requires a backend, an account, or cloud sync. `[VERIFIED]`**
WatchConnectivity is a direct peer link between two devices the same person owns;
HealthKit mirroring is on-device; the watch app's own storage is on the watch.
No token, no server, no analytics. This is the one lens the feature passes without
qualification.

**F2. Two constraint-adjacent notes.** `@bacons/apple-targets` and
`react-native-watch-connectivity` are both **community** packages, so adopting
them would be the *third* and *fourth* standing exceptions to the official-tooling
preference (after ADR 0010's react-native-maps fallback and ADR 0011's HealthKit
library) — and unlike those two, the first exception in the *build system* rather
than in a leaf adapter. And a Watch app is a second App Store artifact: review
notes, screenshots, and a second surface for every future change.

---

## Options

### Option A — Do nothing about the Watch; run the barometer spike (recommended)

Spend ~1 hour proving Finding C3 on a physical device: add `expo-sensors`,
subscribe `Barometer`, start a run, lock the phone, pocket it, walk a known
elevation change, and confirm samples keep arriving with the location heartbeat
running. Then ship ADR 0015's barometer slice, with C4's gap-detection story.

*Trade-offs:* costs almost nothing and directly answers the question that
motivated the Watch idea. If it passes, the strongest sensor argument for a Watch
evaporates and the remaining case is heart rate + haptics — a real case, but a
much smaller one, and one that can be made later on better information.

### Option B — Watch companion, watch-owned run (the "real" version)

A SwiftUI watch app via `@bacons/apple-targets` (`type: "watch"`) that owns the
`HKWorkoutSession`, the GPS track, heart rate and haptic cues, mirroring to the
iPhone (D5) so the phone app is background-launched and keeps the history, the
plan UI and Apple Health writes. Sync via the mirroring channel plus
WatchConnectivity for out-of-workout state.

*Trade-offs:* this is the version that delivers what people actually want from a
running-watch app, and it is the only one that unlocks heart rate. It is also a
second application in a second language with a second UI framework, sharing
**zero** code with `src/` — `domain/` included, since it is TypeScript. The engine
would have to be reimplemented in Swift, or the watch reduced to a dumb sensor
head. Add: a community build plugin with no stated SDK 57 support and a recent
history of watch-wiring bugs, EAS provisioning for a second target, a native
fingerprint change on every build, and E2E coverage that neither Maestro nor
argent can reach (per ADR 0001's device-gate pattern, it would be checklist-only).

### Option C — Watch companion as a remote control (phone-owned run)

The phone keeps everything exactly as ADR 0008 has it. The watch shows the current
segment, the countdown and total elapsed, taps haptically on transitions, and
offers pause/resume/end — driven by sparse `transferUserInfo:`/`sendMessage:`
updates off the existing `RunEngine.announceProgress` seam.

*Trade-offs:* far smaller than B, reuses the whole existing architecture, and the
event-log engine makes the sync tractable (E3). But it keeps the phone as the
sensor device, so it buys **no** heart rate and no guaranteed runtime — and it
still costs the entire watch-target + bridge apparatus. Worse, its user-visible
value overlaps heavily with ADR 0022's Live Activity, which is first-party, needs
no second app, and is already decided. **Hard to justify on its own merits.**

### Option D — Skip the Watch; take the cheap adjacent wins

Ship ADR 0022's Live Activity (glanceable active run, already decided, first-party
tooling), and revisit `HKWorkoutSession` on iPhone separately when the deployment
floor reaches iOS 26 — for `activeEnergyBurned` and crash recovery (D4), not for
background execution.

*Trade-offs:* delivers most of Option C's glanceability at a fraction of the cost
and none of the tooling risk. Does not deliver heart rate or wrist haptics —
those genuinely require a Watch.

---

## Comparison

| | A — barometer spike | B — watch-owned run | C — watch as remote | D — Live Activity + iOS workout session |
|---|---|---|---|---|
| Feasibility | Feasible (blocker disproven) | Feasible-with-caveats (community build plugin, no SDK 57 statement) | Feasible-with-caveats (same tooling, less payoff) | Feasible (ADR 0022 decided; iOS 26 floor for the session part) |
| Local-first | Fully local | Fully local | Fully local | Fully local |
| Answers the owner's question | ✅ directly | ✅ but by replacing the premise | ❌ phone still does the sensing | ✅ partly (D4) |
| Unlocks heart rate | ❌ | ✅ only option that does | ❌ | ❌ |
| New languages / frameworks | none | Swift + SwiftUI + watchOS | Swift + SwiftUI + watchOS | none |
| Code shared with `src/` | all | none | none | all |
| Official tooling | ✅ first-party `expo-sensors` | ❌ two community deps | ❌ two community deps | ✅ first-party |
| Native fingerprint / build cost | JS-only if sensors already present; otherwise one rebuild | new target every build | new target every build | one rebuild (ADR 0022) |
| Testability | `bun test` + device spike | device checklist only | device checklist only | device checklist (ADR 0022) |
| Rough effort | ~1 hour | weeks | week+ | days (ADR 0022) |

---

## Feasibility assessment

**A Watch companion is `Feasible-with-caveats`, where the caveats are larger than
in any prior roadmap item.** The capability is real and the CNG problem is
genuinely solved — `@bacons/apple-targets` keeps watch sources outside `ios/` and
re-links them on every prebuild, which is the correct shape and the only one that
respects this repo's rules. But three things separate this from, say, ADR 0022's
Live Activity:

1. **No first-party path exists, at any layer.** The target plugin is community
   (`@bacons` personal scope, `expo >=52`, no SDK 57 statement, four watch-wiring
   fixes in Feb 2026). The connectivity bridge is community
   (`react-native-watch-connectivity@2.0.0`, no Expo plugin, RN 0.86 compatibility
   inferred). Compare `expo-widgets`, which is first-party and version-matched.
2. **Zero code reuse.** Not "some native glue" — the watch app is SwiftUI top to
   bottom, and even `domain/` (pure TypeScript, the most portable thing in the
   repo) cannot cross. The run engine either gets reimplemented in Swift or the
   watch stays dumb.
3. **It is untestable by this repo's machinery.** Maestro drives iOS simulators;
   argent drives iOS simulators. A watch app lands entirely in
   [the device checklist](../../milestone-0-device-checklist.md) — the same
   category ADR 0001 assigns to GPS motion and cue audibility, which is where
   regressions historically go unnoticed.

**By contrast, the barometer question that prompted all this is `Feasible`, now
more clearly than before.** The named blocker does not exist in the source, the
config plugin already supplies `NSMotionUsageDescription`, the module needs no
Expo-side change, and adding `expo-sensors` is a first-party dependency at the
SDK-matched version.

## Local-first assessment

**`Fully local`, for every option above.** No option introduces a backend, an
account, a token, or analytics. WatchConnectivity and HealthKit mirroring are
device-to-device links between two devices the same user owns; the watch app's
storage is on the watch; iCloud remains the only sync. The `AGENTS.md` hard
constraints are held without qualification.

The only ethos-adjacent costs are the two community dependencies (F2) — a
policy question about the official-tooling preference, not a local-first one — and
the fact that both would sit in the *build system* rather than behind a port,
which is a place ADR 0003's containment strategy cannot reach.

## Recommendation

**Option A now; keep the Watch on the roadmap as an `Idea`, not a plan.**

The owner's question was aimed at a real problem — can the pocketed phone keep
sensing? — and reached for the Watch as the answer. The research says the phone
can very probably already do it, and that the blocker recorded in ADR 0015 was a
misreading of which `expo-sensors` module pauses on background. **Run the
barometer spike before spending anything on watchOS.** It is roughly an hour, it
unblocks the elevation slice that the 2026-08-02 design deferred, and it removes
the sensor argument from the Watch's case.

What survives that spike, and is genuinely Watch-only, is **heart rate and wrist
haptics** — a legitimate feature, worth wanting, and worth deciding on its own
merits rather than as a workaround for a background-sensor problem that turns out
not to exist. When that decision comes, Option B (watch-owned run, mirroring to
the phone) is the shape to price, not Option C — a watch that only mirrors the
phone costs nearly as much and delivers what ADR 0022's Live Activity already will.

> This is an assessment, not a decision to build. **No ADR is warranted yet** —
> there is nothing to decide until the barometer spike lands and the heart-rate
> question is asked deliberately. Two *amendments* to existing ADRs are warranted
> now, though; see next steps.

## What would have to be true

For a Watch companion to be worth building, all of these:

1. **The heart-rate / haptics case is wanted for its own sake** — not as a proxy
   for background sensing (disproven, C1–C3) or glanceability (ADR 0022 covers it).
2. **Owning Swift/SwiftUI is acceptable.** A second app in a second language,
   permanently, with no code shared with `src/`. This is the real price.
3. **`@bacons/apple-targets` builds a watch target on SDK 57.** Currently
   `[INFERRED]` only — `expo >=52` / "SDK +53", with SDK 55/56 the newest commits
   referenced, and a Feb-2026 history of watch embed/dependency bugs.
4. **Two more community dependencies are acceptable in the build system**, where
   ADR 0003's port containment does not apply.
5. **Checklist-only testing is acceptable** for a whole second app.
6. **The run engine's replication story holds** — that two devices deriving from
   one event log stay in agreement over a 30-minute run without a latency
   guarantee (E3). Plausible given ADR 0007's wall-clock design, `[UNDETERMINED]`
   in practice.

## Open questions / next steps

- **Do this first (~1 hour, physical device):** the ADR 0015 open-item-7 spike.
  Subscribe `Barometer`, start a run, lock and pocket the phone, walk a known
  climb, confirm samples keep arriving alongside the location heartbeat and that
  summed relative altitude matches reality. Also measure the actual delivery
  cadence — the header says "every few seconds", which is far sparser than the
  1 Hz the elevation reducer's tuning was measured against
  ([design spec §3.5](../specs/2026-08-02-run-elevation-and-pace-chart-design.md)),
  and the smoothing window may need re-deriving for a barometer source.
- **Amend ADR 0015 open item 7** with C1's source reading — the premise is wrong
  and should not be inherited by whoever implements the barometer slice. Replace
  "the module stops updates on background" with the Pedometer/Barometer
  distinction and the real open question (device confirmation + cadence).
- **Add C4 to the elevation design as a named risk:** relative altitude has no
  backfill API on any iOS version, so a suspension gap is permanent data loss and
  needs explicit gap handling rather than a silently low total.
- **Add a note to ADR 0008's *Alternatives considered*:** its HKWorkoutSession
  bullet is still correct after iOS 26, but the API it describes moved — the class
  reached iPhone in iOS 17 (mirrored only) and got a native initializer in iOS 26,
  and `workout-processing` remains a `WKBackgroundModes` (watchOS) value with no
  `UIBackgroundModes` counterpart. Recording that prevents someone re-opening the
  question from the changelog alone.
- **Separately researchable, not Watch-related:** `HKWorkoutSession` on iPhone for
  `activeEnergyBurned` and crash recovery (D4). Gated on an iOS 26 floor (current
  target is 17.0) and on HealthKit bridging that the current library does not have
  — the capability ledger records no `HKWorkoutBuilder`/`HKWorkoutSession` surface
  at all.
- **`[UNDETERMINED]`, worth resolving before any Watch commitment:** whether Expo
  maintainers have taken a public position on watchOS (GitHub search was
  non-functional during this research); whether `@bacons/apple-targets@5.0.0`
  actually produces a working watch target under SDK 57 / RN 0.86; whether
  `react-native-watch-connectivity@2.0.0` runs on RN 0.86; and whether an iPhone
  `HKWorkoutSession` grants *any* incremental background runtime — Apple documents
  no mechanism and the crash-recovery API implies not, but no Apple statement
  denies it explicitly.

## Roadmap entry

Suggested row for [`docs/roadmap/README.md`](../../roadmap/README.md) (not added by
this doc):

| Feature | Status | Feasibility | Local-first | Research | ADR |
|---|---|---|---|---|---|
| Apple Watch companion | Researched | Feasible-with-caveats (native SwiftUI target; community build plugin + bridge; no code reuse) | Fully local (WatchConnectivity / HealthKit mirroring, both device-to-device) | [2026-08-03](../superpowers/research/2026-08-03-apple-watch-companion.md) | — |

---

## Sources

Apple (fetched via `developer.apple.com/tutorials/data/…json`, 2026-08-03):
[HKWorkoutSession](https://developer.apple.com/documentation/healthkit/hkworkoutsession) ·
[init(healthStore:configuration:)](https://developer.apple.com/documentation/healthkit/hkworkoutsession/init(healthstore:configuration:)) ·
[startMirroringToCompanionDevice](https://developer.apple.com/documentation/healthkit/hkworkoutsession/startmirroringtocompaniondevice(completion:)) ·
[sendToRemoteWorkoutSession](https://developer.apple.com/documentation/healthkit/hkworkoutsession/sendtoremoteworkoutsession(data:completion:)) ·
[workoutSessionMirroringStartHandler](https://developer.apple.com/documentation/healthkit/hkhealthstore/workoutsessionmirroringstarthandler) ·
[recoverActiveWorkoutSession](https://developer.apple.com/documentation/healthkit/hkhealthstore/recoveractiveworkoutsession(completion:)) ·
[Running workout sessions](https://developer.apple.com/documentation/healthkit/running-workout-sessions) ·
[Building a workout app for iPhone and iPad](https://developer.apple.com/documentation/healthkit/building-a-workout-app-for-iphone-and-ipad) ·
[CMAltimeter](https://developer.apple.com/documentation/coremotion/cmaltimeter) ·
[startRelativeAltitudeUpdates](https://developer.apple.com/documentation/coremotion/cmaltimeter/startrelativealtitudeupdates(to:withhandler:)) ·
[UIBackgroundModes](https://developer.apple.com/documentation/bundleresources/information-property-list/uibackgroundmodes) ·
[WKBackgroundModes](https://developer.apple.com/documentation/bundleresources/information-property-list/wkbackgroundmodes) ·
[Configuring background execution modes](https://developer.apple.com/documentation/Xcode/configuring-background-execution-modes) ·
[WWDC25 322 — Track workouts with HealthKit on iOS and iPadOS](https://developer.apple.com/videos/play/wwdc2025/322/) (transcript)

Local SDK headers (`iPhoneOS26.5.sdk` / `WatchOS26.5.sdk`, read 2026-08-03):
`CoreMotion/CMAltimeter.h`, `CMMotionActivityManager.h`, `CMPedometer.h`,
`CMSensorRecorder.h`, `CMRecordedPressureData.h`, `CMBatchedSensorManager.h`;
`WatchConnectivity/WCSession.h`; `WatchKit/WKExtendedRuntimeSession.h`

Packages (published tarballs / registry, 2026-08-03): `expo-sensors@57.0.2`
(`ios/BarometerModule.swift`, `ios/PedometerModule.swift`, `ios/ExpoSensors.podspec`,
`src/DeviceSensor.ts`, `expo-module.config.json`, `plugin/build/withSensors.js`) ·
[`@bacons/apple-targets@5.0.0`](https://github.com/EvanBacon/expo-apple-targets) ·
[`react-native-watch-connectivity@2.0.0`](https://github.com/watch-connectivity/react-native-watch-connectivity) ·
[`expo-widgets` podspec (sdk-57)](https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo-widgets/ios/ExpoWidgets.podspec) ·
[`@expo/ui` podspec (sdk-57)](https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo-ui/ios/ExpoUI.podspec) ·
[`hermes-engine.podspec` @ RN v0.86.2](https://raw.githubusercontent.com/facebook/react-native/v0.86.2/packages/react-native/sdks/hermes-engine/hermes-engine.podspec) ·
[React Native out-of-tree platforms](https://reactnative.dev/docs/out-of-tree-platforms)

Secondary (corroborating only, never load-bearing):
[HealthKit workout lifecycle & the iOS 26 cross-platform surface](https://blakecrosley.com/blog/watchos-workout-lifecycle) (2026-05-03) ·
[Tracking workouts with HealthKit in iOS apps](https://www.createwithswift.com/tracking-workouts-with-healthkit-in-ios-apps/) (2025-11-11)
