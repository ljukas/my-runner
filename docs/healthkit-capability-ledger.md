# HealthKit Capability Ledger

**Library:** `@kingstinct/react-native-healthkit`, pinned **14.0.2** (`package.json:7`)
**Verified:** 2026-08-02, against the installed tarball at
`node_modules/@kingstinct/react-native-healthkit/` and the iOS SDK headers in
`/Applications/Xcode.app/…/iPhoneOS.sdk/System/Library/Frameworks/HealthKit.framework/Headers/`
**Governing ADR:** [0011](adr/0011-apple-health-kingstinct-healthkit.md) · **Design spec:**
[2026-07-31-stage-5-apple-health-design.md](superpowers/specs/2026-07-31-stage-5-apple-health-design.md)

> **The tarball is the only ground truth. Never Context7, never the published docs.**
> The library's pages are generated `_autodocs` describing an API present in neither the
> release nor `master` — an options-object `saveWorkoutSample({ startDate, endDate, events,
> activities })` and `requestAuthorization({ toRead, toWrite })`, both fabrications.
> AGENTS.md carries this as a standing exception to the Context7-first rule. Re-check any
> claim below by reading `ios/*.swift` and `src/specs/*.nitro.ts` in the installed package.

**How to read the citations.** Bare paths (`ios/WorkoutsModule.swift:156`) are relative to the
library root. `HK*.h` paths are Apple's SDK headers — the authority on what HealthKit itself
permits. `src/generated/*` is generated from Apple's schema and describes **HealthKit**, not the
bridge: it is an upper bound on what is possible, never evidence the library implements it.

Why this file exists: to make the "cannot do" column evidence-backed and re-checkable, so a later
decision about writing a tightly-scoped in-house connector rests on verified line references rather
than recollection.

---

## 1. In use today

Six library entry points, all reached from one adapter file. `src/services/health/adapter.ios.ts`
is the only file in `src/` that imports the library — verified by grep across `src/` and `plugins/`.

| Capability | Library API | Our call site | Library implementation |
|---|---|---|---|
| HealthKit presence | `isHealthDataAvailable()` | `adapter.ios.ts:27,42` | `src/specs/CoreModule.nitro.ts:66` → `ios/CoreModule.swift` |
| Share-status read | `authorizationStatusFor(type)` | `adapter.ios.ts:28` | `src/specs/CoreModule.nitro.ts:103`; enum `src/types/Auth.ts:13-17` |
| Write-permission prompt | `requestAuthorization({ toShare })` | `adapter.ios.ts:45` | `src/specs/CoreModule.nitro.ts:113`; shape at `:19-22` |
| Running-workout write | `saveWorkoutSample(type, quantities, start, end, totals?, metadata?)` | `adapter.ios.ts:63-84` | `src/specs/WorkoutsModule.nitro.ts:14-21` → `ios/WorkoutsModule.swift:80-220` |
| GPS route write | `WorkoutProxy.saveWorkoutRoute(locations)` | `adapter.ios.ts:87-98` | `src/specs/WorkoutProxy.nitro.ts:13` → `ios/WorkoutProxy.swift:401-405` → `:154-177` |
| Activity type | `WorkoutActivityType.running` (numeric enum) | `adapter.ios.ts:64` | `ios/Helpers.swift:184-191` |

Written per completed or partial run: `HKWorkoutActivityTypeRunning`, true wall-clock start/end,
`totals.distance`, one whole-session `HKQuantityTypeIdentifierDistanceWalkingRunning` sample, the
full `CLLocation` route, and two metadata keys.

**Authorization set** (`adapter.ios.ts:14-16,45`): `HKWorkoutTypeIdentifier`,
`HKWorkoutRouteTypeIdentifier`, `HKQuantityTypeIdentifierDistanceWalkingRunning` — `toShare` only,
never `toRead`.

**Metadata written** (`adapter.ios.ts:23-24,58-61`): `HKSyncIdentifier` (the run id) and
`HKSyncVersion` (`Date.now()`). The raw string keys, not the `HKMetadataKey…` Swift constant names
— confirmed against the schema, which records `HKMetadataKeySyncIdentifier -> HKSyncIdentifier`
and `HKMetadataKeySyncVersion -> HKSyncVersion`. Both are `objectTypes: ["common"]`, so they are
legal on the workout and on its quantity sample alike. The version must increase per save:
`HKMetadata.h:142-145` replaces a stored object under a repeated sync identifier only when the new
save's version is **greater**, and requires the version whenever the identifier is present.

**Consumers of the port**, none of which see a HealthKit type:

| Surface | File |
|---|---|
| Auto-save after the local write commits | `src/services/run-engine/index.ts:23` → `src/services/health/with-health-sync.ts:39-48` |
| Sync policy, `healthkit_saved` flip | `src/services/health/sync.ts:30-55` |
| Payload mapping (pure) | `src/domain/health.ts:24-98` |
| Manual retry on a run summary | `src/components/health-status-row.tsx:47-51` |
| Onboarding primer | `src/app/onboarding/health.tsx:19` |
| Settings row + Health deep link | `src/app/(tabs)/settings/index.tsx:99,102` |
| Status hook | `src/services/health/use-health-authorization.ts:25-45` |

---

## 2. Wanted but blocked

Severity is scored for *this app*: a C25K interval trainer that records duration, distance and a
GPS route, writes only what it measured, and reads nothing.

### 2.1 Interval structure cannot be written — **high**

**Wanted:** the walk/run structure visible in Apple Health, not just a continuous 30-minute run.
**Apple's mechanism:** `HKWorkoutBuilder.addWorkoutEvents:` (`HKWorkoutBuilder.h:140`) or
`addWorkoutActivity:` (`:169`, iOS 16+).
**Blocked at:** `workoutEvents: nil` is hardcoded at all three `HKWorkout.init` sites —
`ios/WorkoutsModule.swift:156`, `:169`, `:184`. There is no events or activities parameter anywhere
in the write path: `src/specs/WorkoutsModule.nitro.ts:14-21` has six parameters and none of them is
events. `HKWorkoutBuilder` is **not bridged at all** — the only `HKWorkout…Builder` reference in the
whole package is `HKWorkoutRouteBuilder` (`ios/WorkoutProxy.swift:163`). `activities` exists solely
as a read accessor on the proxy (`ios/WorkoutProxy.swift:368-381`), as does `events` (`:346-367`).
**`master`:** not determinable from the tarball — a published tarball carries no VCS history.
The last recorded cross-check is the design spec's, 2026-07-31, against `master` as pushed
2026-07-27: still `nil`, at the same three lines. Re-checking means fetching the repo, not
reading `node_modules`.

### 2.2 Quantity-valued workout metadata cannot be written — **high** (a class, not one key)

**Wanted (concretely):** elevation ascended/descended on the workout, once ADR 0015's Elevation port
lands. There is no elevation column in `src/db/schema.ts` today, so this blocks a planned capability
rather than a shipped one.
**Apple's mechanism:** `HKMetadataKeyElevationAscended` / `…Descended`, whose expected value type is
"an HKQuantity object compatible with length unit… may be set on a workout" (`HKMetadata.h:379-384`
and the entry following it). `HKObject.h:45-46` is categorical: metadata **values must be NSString,
NSNumber, NSDate, or HKQuantity**.

**Blocked along the whole path, in four steps:**

1. The keys are typed and reachable in the generated surface —
   `WorkoutTypedMetadata.HKElevationAscended?: Quantity` /
   `HKElevationDescended?: Quantity` (`src/generated/healthkit.generated.ts:1071-1072`,
   interface at `:1063`), `Quantity = { unit: string; quantity: number }`
   (`src/types/QuantityType.ts:58-61`), schema `"valueKind": "quantity"`.
   **This is the trap:** the generated types describe HealthKit, so the key *looks* writable.
2. The bridge parameter is untyped: `metadata?: AnyMap`
   (`src/specs/WorkoutsModule.nitro.ts:20`). `WorkoutTypedMetadata` never applies to the save —
   the JS layer retypes only the **return** value (`src/healthkit.ios.ts:226-230`, a
   `bindRetypedMethod` whose `BoundMethod<TMethod, TReturn>` at `:114-124` preserves the spec's
   argument types verbatim). No serialization happens on the JS side.
3. Swift flattens it: `anyMapToDictionary` (`ios/Helpers.swift:428-434`) → `getAnyMapValue`
   (`ios/QuantityTypeModule.swift:263-286`), which for an object-valued key returns
   `anyMap.getObject(key:)` — a raw nested map, never an `HKQuantity`. No `{unit, quantity}` →
   `HKQuantity` conversion exists anywhere in the path.
4. The transport cannot carry one anyway: Nitro's `ValueType` is
   `string | number | boolean | Int64 | null | ValueType[] | Record<string, ValueType>`
   (`react-native-nitro-modules/src/AnyMap.ts:6-13`). Of the four value types `HKObject.h:45-46`
   permits, `AnyMap` can express two.

**The class.** 23 of the schema's 71 metadata keys are `valueKind: "quantity"`; **12 apply to
`workout`** — `HKElevationAscended`, `HKElevationDescended`, `HKAverageSpeed`, `HKMaximumSpeed`,
`HKAverageMETs`, `HKAlpineSlopeGrade`, `HKCrossTrainerDistance`, `HKFitnessMachineDuration`,
`HKIndoorBikeDistance`, `HKLapLength`, `HKWeatherHumidity`, `HKWeatherTemperature`. Every one fails
identically; do not investigate them individually. The remaining 48 keys (`string`, `number`,
`boolean`, `enum`) cross the bridge fine — see §3.4. The same `anyMapToDictionary` call sits on
the standalone sample path too (`ios/QuantityTypeModule.swift:491`), so this is the library's
metadata handling in general, not a workout-specific bug.
**Status:** source-read only. See §7.
**`master`:** not determinable from the tarball.

### 2.3 Walk-vs-run cannot be labelled on a sample — **medium, and not the library's fault**

**A HealthKit limitation, not a bridge one.** HealthKit has exactly one type,
`HKQuantityTypeIdentifierDistanceWalkingRunning`, so no sample can carry "this stretch was a walk".
Writing one sample per segment was tried and reverted (ADR 0011 amendment 7): it produced 17
one-second ~5.6 m rows in the user's Health distance history and conveyed no structure. There is
no library change that would fix this — only §2.1's workout activities represent intervals.
Nothing to re-check; this does not move when the library moves.

### 2.4 Per-sample metadata and `sourceRevision` are silently dropped — **low**

**Wanted:** tag a quantity sample with its own segment kind or provenance.
**Blocked at:** `ios/WorkoutsModule.swift:128-134` constructs every `HKQuantitySample` with the
**workout-level** `metadataDeserialized`, and passes only `type`/`quantity`/`start`/`end`/`metadata`.
`QuantitySampleForSaving` declares both `metadata?: AnyMap` and `sourceRevision?: SourceRevision`
(`src/types/QuantitySample.ts:28-36`); neither is read. Declared in the type, ignored in the Swift.
**Severity is low only because §2.3 makes per-sample tagging pointless for this app** — with one
whole-session sample there is nothing to tag. It would become load-bearing the moment per-sample
data returns.

### 2.5 `totalDistance` is overwritten by the last metre-compatible sample — **low, mitigated**

Not "cannot do" but "does the wrong thing silently". The loop assigns `totalDistance = quantity` for
**every** sample compatible with `HKUnit.meter()` (`ios/WorkoutsModule.swift:116-118`), so N samples
leave the workout total equal to the last one. An explicit `totals.distance` overrides it afterwards
(`:141-143`). The adapter passes `totals` unconditionally (`adapter.ios.ts:82`) precisely for this
reason. Keep that line; it is the mitigation, not redundancy.

### 2.6 Workout-route metadata is unwritable — **medium** *(not previously recorded)*

**Wanted:** the same `HKSyncIdentifier` / `HKSyncVersion` on the `HKWorkoutRoute` series object that
the workout and its sample carry, so a retry replaces the route rather than orphaning or
duplicating it.
**Apple's mechanism:** `HKWorkoutRouteBuilder.addMetadata:` (`HKWorkoutRouteBuilder.h:76`) and the
`metadata:` argument of `finishRouteWithWorkout:` (`:96`) — both exist.
**Blocked at:** `try await routeBuilder.finishRoute(with: workout, metadata: nil)`, hardcoded
`nil` at `ios/WorkoutProxy.swift:168`; and `saveWorkoutRoute(locations:)` exposes no metadata
parameter at all (`src/specs/WorkoutProxy.nitro.ts:13`, `ios/WorkoutProxy.swift:401`). The library
*reads* route sync metadata (`ios/WorkoutProxy.swift:340-348`) but never writes it.
**Why it matters here:** ADR 0011 amendment 6 leaves "does a genuine retry replace rather than
duplicate the workout?" unverified. This finding narrows the question — whatever happens to the
workout, the route provably cannot participate in the sync-identifier mechanism, because it carries
no identifier to match on.
**`master`:** not determinable from the tarball.

### 2.7 `HKDevice` cannot be attributed — **low** *(not previously recorded)*

`device: nil` is hardcoded at both `HKWorkout.init` sites that take one
(`ios/WorkoutsModule.swift:160`, `:173`); the fallback initializer at `:180-188` has no device
parameter at all, and it is the one this app's saves reach (neither swimming strokes nor flights
climbed are ever set). `HKWorkoutRouteBuilder` is likewise constructed with `device: nil`
(`ios/WorkoutProxy.swift:163-166`). Health attributes the data to the app, never to a device.
No product impact today.

### 2.8 The write path uses an API Apple deprecated in iOS 17 — **medium, as durable risk** *(not previously recorded)*

Every `HKWorkout` factory the library calls is marked
`API_DEPRECATED("Use HKWorkoutBuilder", ios(8.0, 17.0), …)` — `HKWorkout.h:270`, `:291`, `:314`,
`:335`, `:358` (read from the local iOS SDK header, not from documentation). The app's deployment
target is iOS 17.0 (`app.json`), i.e. the exact release in which these were deprecated.

This is the **common root cause of §2.1 and §2.2**, and the single most useful line in this ledger:
the deprecated one-shot initializers are the only ones that accept `workoutEvents:` and `metadata:`
up front, and they take metadata as an already-built `NSDictionary` — which is why the bridge has to
flatten an `AnyMap` and why nothing can construct an `HKQuantity` on the way in. `HKWorkoutBuilder`,
where `addWorkoutEvents:` (`:140`), `addWorkoutActivity:` (`:169`) and `addMetadata:` (`:155`) all
live, is not bridged. Adopting the builder is not an incremental patch to this library's save path;
it is a different save path. That is what makes §2.1 and §2.2 unlikely to be fixed upstream by
accident, and it is what an in-house connector would be built on from the start.

---

## 3. Supported but deliberately unused

Do not "fix" these. Each is a decision.

### 3.1 Energy burned — deliberately not written

The library supports it: `totals.energyBurned` (`src/types/Workouts.ts:123-126`), applied at
`ios/WorkoutsModule.swift:139,144-146`, plus any kilocalorie-compatible sample at `:112-114`.
**Not written because the app has no heart rate and, being write-only, can never read body mass** —
any kcal figure would be fabricated, which App Review 5.1.3 forbids. ADR 0011 amendment 1 dropped
`activeEnergyBurned` from the write set for this reason. This is a correctness and review-risk
decision, not an oversight. It does not become available by adopting a different library or writing
our own connector: the missing input is the measurement, not the API.

### 3.2 Everything read-related — out of scope by design

`toRead` is never passed (`adapter.ios.ts:45`). Unused read surface includes
`queryWorkoutSamples` / `…WithAnchor` (`src/specs/WorkoutsModule.nitro.ts:23-27`),
`queryQuantitySamples` (`ios/QuantityTypeModule.swift:507`), the characteristics module
(`ios/CharacteristicTypeModule.swift`), statistics (`ios/WorkoutProxy.swift:379-410`,
`WorkoutProxy.saveWorkoutRoute`'s siblings `getWorkoutRoutes` / `getStatistic` /
`getAllStatistics` — `src/specs/WorkoutProxy.nitro.ts:15-21`), change subscriptions
(`src/utils/subscribeToChanges.ts`), and the whole `src/hooks/` directory.
**Write-only keeps the App Privacy label at "data not collected", keeps 5.1.3's mirroring
constraints trivially satisfied, and keeps the app's "no backend, no accounts, no analytics"
constraint honest.** Reading multiplies the privacy surface for features the product does not need.

### 3.3 Background delivery — actively suppressed

`enableBackgroundDelivery` / `configureBackgroundTypes` (`src/specs/CoreModule.nitro.ts:60-70`) and
`ios/BackgroundDeliveryManager.swift` exist and are reachable. The app passes `background: false`
in `app.json` to suppress both the entitlement and the AppDelegate hook. A write-only integration
has nothing to observe; see §4.

### 3.4 Non-quantity workout metadata — writable today, simply not written

The 48 `string` / `number` / `boolean` / `enum` metadata keys pass through `getAnyMapValue`
intact. Nine apply to workouts, of which one is genuinely applicable here: `HKIndoorWorkout`
(boolean) — an outdoor GPS run could legitimately write `false`. `HKWorkoutBrandName` (string) is
also available. Unwritten because neither adds user-visible value in the Health app for this app's
runs; recorded so the omission reads as a choice, and so nobody concludes from §2.2 that *all*
workout metadata is blocked. It is not — only the quantity-valued keys are.

### 3.5 Other unused write surface

`deleteObjects` (`src/specs/CoreModule.nitro.ts:119`, `ios/CoreModule.swift:353-360`) — the app
never removes what it wrote; the user owns their Health data and deletes from Health.
`startWatchAppWithWorkoutConfiguration` (`ios/WorkoutsModule.swift:38-58`) — no watch app.
`totalSwimmingStrokeCount` / `totalFlightsClimbed` (`ios/WorkoutsModule.swift:120-126`) — not this
sport.

---

## 4. Config-plugin behaviour

`app.plugin.ts` composes three mods (`:105-111`): entitlements, Info.plist, AppDelegate.

| What it does | Where | Suppressible? |
|---|---|---|
| `com.apple.developer.healthkit` entitlement | `app.plugin.ts:27` | **No.** Unconditional. |
| `com.apple.developer.healthkit.background-delivery` entitlement | `:31-35` | Yes — `background: false` |
| `BackgroundDeliveryManager.shared.setupBackgroundObservers()` + `import HealthKit` into AppDelegate | `:67-103`, early-returns at `:70-72` | Yes — same `background: false` |
| `NSHealthShareUsageDescription` | `:44-50` | **No.** Defaults to `"<app name> wants to read your health data"`. |
| `NSHealthUpdateUsageDescription` | `:52-61` | Yes — pass `false` to omit entirely |

**Our configuration** (`app.json`): `background: false`, plus the real
`NSHealthUpdateUsageDescription` purpose string.

**`plugins/with-healthkit-write-only.js` exists because the fourth row has no opt-out.** A
write-only app would otherwise ship a read-access purpose string it never uses — a false claim
visible to App Review in the binary. The local plugin deletes the key
(`plugins/with-healthkit-write-only.js:24`) and **must be listed before** the library's plugin in
`app.json`'s array: `@expo/config-plugins` mods chain in registration order, so the earlier entry's
action runs last. A reversed order would make it a silent no-op, which is why it throws instead
(`:16-23`).

**Verified in the generated project** (`ios/`, gitignored, regenerated by prebuild): the
entitlements file contains `com.apple.developer.healthkit` and nothing else — no background-delivery
key; `Info.plist` carries `NSHealthUpdateUsageDescription` and **no** `NSHealthShareUsageDescription`;
`AppDelegate.swift` has no HealthKit or `BackgroundDeliveryManager` reference. All three suppressions
land as intended.

---

## 5. What an own connector would have to cover

Scope: replace the library for **this app's** needs (§1) and unblock §2.1 and §2.2. Not a general
HealthKit binding.

**Method surface: 5 methods.** One-to-one with §1, minus `WorkoutActivityType`, which becomes a
constant.

| Method | HealthKit surface |
|---|---|
| `isAvailable(): Bool` | `HKHealthStore.isHealthDataAvailable()` |
| `authorizationStatus(): Int` | `HKHealthStore.authorizationStatus(for:)` over `HKObjectType.workoutType()` |
| `requestWriteAuthorization(): Promise<Void>` | `requestAuthorization(toShare:read:)` over three types: workout, `HKSeriesType.workoutRoute()`, `HKQuantityType(.distanceWalkingRunning)` |
| `saveRun(payload): Promise<Void>` | `HKWorkoutBuilder` — `beginCollection(at:)`, `addSamples(_:)`, `addWorkoutActivity(_:)` per segment, `addMetadata(_:)`, `endCollection(at:)`, `finishWorkout()` (`HKWorkoutBuilder.h:110,126,155,169,215,226`) |
| *(folded into `saveRun`)* route | `HKWorkoutRouteBuilder` — `insertRouteData(_:)`, `finishRoute(with:metadata:)` (`HKWorkoutRouteBuilder.h:59,96`) |

**Classes involved:** `HKHealthStore`, `HKWorkoutBuilder`, `HKWorkoutConfiguration`,
`HKWorkoutActivity`, `HKWorkoutRouteBuilder`, `HKQuantitySample`, `HKQuantityType`, `HKQuantity`,
`HKUnit`, `HKObjectType`/`HKSeriesType`, `CLLocation`. Eleven, all first-party, all stable.

**The two things the connector must do that the library cannot.** Both are trivial once
`HKWorkoutBuilder` is the write path: build `HKWorkoutActivity` per segment from the run's own
segment rows, and convert `{ unit, quantity }` into `HKQuantity(unit:doubleValue:)` before it
enters the metadata dictionary — the ~5-line conversion whose absence is §2.2 in its entirety.
Building on the builder also retires §2.6, §2.7 and §2.8 as a side effect.

**Size.** Roughly one Swift file plus a thin TS surface: a single `expo-modules-core` module
definition with 4 async functions and 1 sync one, one payload struct mirroring
`HealthWorkoutInput` (`src/domain/health.ts:60-68`), and the builder choreography. The mapping
layer, the port, the sync policy, the retry, the status hook and the tests already exist and are
platform-neutral (`src/services/health/`, `src/domain/health.ts`) — **none of them change.** The
port was designed for exactly this substitution (ADR 0003); the swap is `adapter.ios.ts` and
nothing else. Order of a few hundred lines of Swift, not a subsystem.

**What we would lose.**

- **The generated type surface.** `src/generated/healthkit.generated.ts` is ~1,200 lines derived
  from Apple's schema — every identifier, unit, and metadata key, typed. We use a handful of it
  today, but it is what makes "which unit does this identifier take" a compile-time question.
- **Upstream fixes and iOS churn absorption.** HealthKit gains identifiers and keys yearly; someone
  else currently tracks that. Note honestly that this cuts both ways: the two limitations that
  actually block us have not moved upstream, and §2.8 explains why they are structurally unlikely to.
- **A New-Architecture-native, Nitro-based, actively maintained dependency**, replaced by native
  code we own — the exact maintenance tax ADR 0011's "Alternatives considered" priced and rejected
  for v1, before amendment 2 reclassified the custom module as the documented escape hatch.
- **`react-native-nitro-modules` would leave the tree** — the app's only Nitro dependency, pulled
  in solely by this library. A small simplification, not a reason on its own.

---

## 6. Decision triggers

Any one of these makes the in-house connector the better trade. None is true today.

1. **Intervals in Health become a product requirement.** §2.1 has no workaround at any library
   version available to us, and §2.3 forecloses the sample-based approximation permanently. This is
   the strongest trigger: it is the one thing users of paid C25K apps can see in Health that this
   app cannot show them.
2. **Elevation ships (ADR 0015) and should appear in Health.** §2.2 blocks the only mechanism
   Apple provides. Writing elevation to the app's own DB but not to Health is a defensible interim
   state; wanting it in Health means owning the write path.
3. **The library stops receiving fixes.** Track: `14.0.2` published 2026-06-05; `master` last
   confirmed moving 2026-07-27. A year of silence, or a React Native / Nitro major that it does not
   follow, flips the maintenance-tax calculation — this is precisely the "revisit if the library
   dies" clause ADR 0011 wrote.
4. **Apple removes the deprecated `HKWorkout` factories** (§2.8, deprecated since iOS 17.0). This
   converts from a quality argument into a build break, and the fix upstream is the same rewrite we
   would be doing ourselves. Watch each SDK release's `HKWorkout.h`.
5. **A retry is proven to duplicate rather than replace** (§7 item 1). If the sync-identifier
   mechanism does not work through this library's save path, the workaround likely needs
   `HKWorkoutBuilder` control we do not have.
6. **The write set needs anything quantity-valued at all** — average/max speed, METs, weather. Same
   blocked path as §2.2; the class-level fix is the connector.

**Explicitly not a trigger:** energy burned (§3.1 — we lack the measurement, not the API), or
anything read-related (§3.2 — a scope decision, unaffected by which library writes).

---

## 7. Needs a device test

Asserted from source reading, not observed. Each names what would settle it.

1. **A retry genuinely replaces rather than duplicates a workout.** ADR 0011 amendment 6 flags this;
   it stays open because the summary's button hides once `healthkit_saved` is set, leaving no UI
   path to a second save of the same run. *Test:* clear `healthkit_saved` in SQLite for a saved run,
   tap the summary button, then check Health for one workout or two.
2. **§2.2 — quantity-valued metadata actually fails at runtime, and how.** Source says an object
   value reaches `HKWorkout.init(metadata:)` as a nested map, which `HKObject.h:45-46` does not
   permit. What is *not* established is the failure mode: a thrown `NSError` the adapter's catch
   absorbs, an `NSException` that crashes, or a silent drop of the key. *Test:* add
   `{ HKElevationAscended: { unit: 'm', quantity: 12 } }` to the adapter's metadata map on a scratch
   branch, save a run, and read the log plus Health's workout detail. Until then §2.2 is a source
   read, not an observed failure — a distinction worth keeping.
3. **§2.6 — the route's fate across a replacing save.** Unverifiable by reading: whether the
   replaced workout's route is carried over, orphaned, or duplicated is HealthKit behaviour.
   Depends on item 1 being reachable first.
4. **The 12-key class of §2.2 is uniform.** The path is shared and the argument is structural, but
   only `HKElevationAscended` would have been exercised by item 2. Low value to test the other
   eleven individually; noted so the ledger does not overclaim.
5. **§2.7 — that `device: nil` is user-visible.** Whether Health surfaces a missing device
   attribution anywhere in its UI was not checked; the source fact is certain, the consequence is not.
