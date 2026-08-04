# Stage 5 — Apple Health: Design Spec

**Date:** 2026-07-31
**Status:** Approved pending final user review
**Stage:** 5 of 5, **Health slice only** (master spec [§13](2026-07-11-c25k-app-design.md)) — the rest of Stage 5 (glass/animation polish, empty states, week-9 graduation, icon/splash, App Review notes) is deliberately deferred to a later slice.
**Governing ADRs:** 0003 (ports), 0004 (storage/reactivity), 0005 (native UI), 0011 (HealthKit), 0013 (components), 0016 (Maestro selectors), 0019 (app variants), 0021 (GPS smoothing)

## 1. Goal

*Your runs appear in Apple Health, with their route.* A finished run is written
to HealthKit as a running workout carrying its duration, distance, GPS route,
and a single whole-session distance sample. Saving is automatic when the user
has authorized it, never blocks completion, and never loses data — the run is
already in SQLite before any Health call happens.

This slice is **write-only** and adds **no schema change**: `runs.healthkit_saved`
has existed since `0000_init.sql` and has been unused until now.

## 2. Decisions

| Topic | Decision |
|---|---|
| Energy burned | **Not written.** Amends ADR 0011 §2, which listed `activeEnergyBurned` in the write set. The app has no heart rate and, being write-only, cannot read body mass — any kcal figure would be fabricated, which App Review 5.1.3 forbids. Duration + distance + route only. |
| Interval structure | **Corrected 2026-08-01 (ADR 0011 amendment item 7): a single whole-session `DistanceWalkingRunning` sample, not one per segment.** The design originally attached one sample per segment (ADR 0011 §5) to approximate Apple's recommended `HKWorkoutActivity`/`HKWorkoutEvent(.segment)`, which the library supports on neither the released version nor `master` (§3). In the Health app those samples did not read as structure — HealthKit has no way to label a sample walk-vs-run — they only fragmented the user's distance history into N permanent rows. One sample, spanning the run's own start→end with the run's total distance, is kept so the run still counts toward the user's Health distance totals; the app's own DB remains the source of truth for intervals. |
| Which runs | **`completed` and `partial` alike** — both are real measured activity. Includes runs finalized by crash recovery. |
| Backfill | **None.** Auto-save fires on *finish*, never on revisit. A pre-opt-in run is pushed to Health only when the user taps the button on its summary. |
| Save trigger | A **persistence decorator at the composition root** (§4.4). The run engine is not modified. |
| Control model | **A reporting row, not a toggle.** Supersedes master spec §8's "Apple Health toggle (triggers authorization)": iOS never lets an app revoke its own HealthKit grant, so a switch the user can turn off but not back on would be a lie. HealthKit's own authorization status is the single source of truth. |
| Deep link | Each permission row carries a button that takes the user *to* the relevant settings surface rather than asking them to navigate. **Resolved (2026-08-01):** the Health destination is `x-apple-health://`, with `openSettings()` kept as fallback (§7.2). |
| Onboarding | One appended step, `health-primer-v1`. **No just-in-time prompt** — the summary's own button is the second chance, and it is user-initiated rather than a system prompt interrupting a celebration. |
| Workout time range | **True wall clock**, so a paused run reads longer in Health than in the app (§5.4). The alternative puts route points outside the workout's own window. |
| Privacy policy | **Placeholder only.** HealthKit obliges one for App Review; the app is not being submitted in this slice. |

## 3. Verified platform facts

ADR 0011's findings were recorded on 2026-07-11. Everything load-bearing below
was **re-verified on 2026-07-31 against the published `14.0.2` tarball** — not
against documentation — and cross-checked against the repository's `master`
branch (pushed 2026-07-27). Line references are into the tarball unless stated.

> **Do not trust Context7 for this library.** Its pages are generated
> `_autodocs`, and they describe an API that exists in neither the release nor
> `master`: an options-object `saveWorkoutSample({ startDate, endDate, events,
> activities })` and `requestAuthorization({ toRead, toWrite })`. Both are
> fabrications. The tarball is the only ground truth here; `npm pack` it and
> read the Swift.

**Version.** `14.0.2`, published 2026-06-05, is still `latest`. Peers
(`react >= 19`, `react-native >= 0.79`, `react-native-nitro-modules >= 0.35`)
are satisfied by React 19.2 / RN 0.86.

**Save surface** — positional, *not* an options object
(`src/specs/WorkoutsModule.nitro.ts:14-21`, identical on `master`):

```ts
saveWorkoutSample(
  workoutActivityType: WorkoutActivityType,
  quantities: readonly QuantitySampleForSaving[],
  startDate: Date,
  endDate: Date,
  totals?: WorkoutTotals,          // { distance?: number; energyBurned?: number }
  metadata?: AnyMap,
): Promise<WorkoutProxy>
```

**Authorization** (`src/specs/CoreModule.nitro.ts:19-22,103,113`):

- `requestAuthorization(toRequest: AuthDataTypes): Promise<boolean>` where
  `AuthDataTypes = { toShare?, toRead? }`. ADR 0011's `toShare` naming is
  correct. The resolved boolean means *the request completed*, **not** *the
  user granted* — it must not be treated as consent.
- `authorizationStatusFor(type): AuthorizationStatus` is **synchronous** and,
  for share types, genuinely reports the answer:
  `{ notDetermined = 0, sharingDenied = 1, sharingAuthorized = 2 }`
  (`src/types/Auth.ts`). This is what makes an honest Settings row possible;
  read permissions deliberately have no such visibility.

**Route** (`ios/WorkoutProxy.swift:401-405` → `:154-177`):
`proxy.saveWorkoutRoute(locations)` builds an `HKWorkoutRouteBuilder`, calls
`insertRouteData` then `finishRoute(with: workout)`. The full route lands in
Apple Health, exactly as ADR 0011 claimed.

### 3.1 Five limitations, all confirmed in the Swift

1. **Workout events are unwritable.** `workoutEvents: nil` is hardcoded at all
   three `HKWorkout.init` sites (`ios/WorkoutsModule.swift:156,169,184`) — and
   **still is on `master`**, at the same three lines. `activities` exists only
   as a read accessor on the proxy (`ios/WorkoutProxy.swift:368`). Apple's
   recommended representation of interval training is therefore not reachable
   through this library at any version available to us.
2. **One distance type covers both walking and running.** HealthKit has only
   `HKQuantityTypeIdentifierDistanceWalkingRunning`, so per-segment samples
   cannot *label* a segment as walk or run. The interval structure surfaces
   only implicitly, as a change of rate in Health's distance chart.
3. **Per-sample metadata is silently dropped.** Every `HKQuantitySample` is
   constructed with the *workout-level* metadata map
   (`ios/WorkoutsModule.swift:133`), ignoring
   `QuantitySampleForSaving.metadata`. Tagging samples with our own segment-kind
   key is not possible.
4. **`totalDistance` is overwritten by the last distance sample.** The loop over
   `quantities` assigns `totalDistance = quantity` for *every* metre-compatible
   sample (`ios/WorkoutsModule.swift:116-117`), so N per-segment samples leave
   the workout total equal to the **last segment**. An explicit `totals.distance`
   overrides it afterwards (`:137-141`). See §5.3 — this is the one failure in
   this design that would be both silent and wrong.
5. **Quantity-valued workout metadata cannot be written.** The bridge from our
   metadata map to HealthKit's is `saveWorkoutSample(..., metadata?: AnyMap)` →
   `anyMapToDictionary` (`ios/Helpers.swift:428`) → `getAnyMapValue`
   (`ios/QuantityTypeModule.swift:263`), which for an object-valued key returns
   `anyMap.getObject(key:)` — a raw nested map, never an `HKQuantity`.
   HealthKit's metadata dictionary accepts only NSString / NSNumber / NSDate /
   HKQuantity values, so any metadata key whose value should be a quantity (for
   example `HKMetadataKeyElevationAscended`) is unwritable through this
   library at any version available to us. This is a class, not one key — 23
   of 71 metadata keys are quantity-valued, 12 of them workout-applicable.
   Full evidence, and the deprecated-API root cause it shares with limitation
   1's unwritable workout events, is in
   [`docs/healthkit-capability-ledger.md`](../../healthkit-capability-ledger.md)
   §2.2 and §2.8.

Together, (1)–(3) meant the original per-segment samples were a weak
consolation prize, not a representation of intervals: (2) in particular means
a sample can never be *labelled* walk-vs-run, so it conveys no interval
information on its own — writing N of them multiplied row count without
adding structure. **Corrected 2026-08-01 (ADR 0011 amendment item 7): one
whole-session sample replaces the per-segment ones.** The workout now carries
a single `DistanceWalkingRunning` sample spanning the run's own start→end
with the run's total distance — real measured data, kept because it is what
makes the run appear in the user's distance history and count toward their
totals, just not fragmented across N rows. Apple Health shows one continuous
running workout with one distance entry, and the app's own history stays the
richer record — precisely ADR 0011's stated consequence.

**What the per-segment verification actually showed (2026-08-01).** §11 Risk
1's fix tags the workout and every quantity sample with the *same*
`HKSyncIdentifier` for retry-idempotency, which raised the question of
whether HealthKit would then treat same-identifier samples as duplicates and
merge them. It does not: a real multi-segment run under the *original*
per-segment design produced all 17 of its samples individually in Health's
own "Show All Data" list, and the workout's own total distance matched the
app's summary. That was read at the time as confirmation the mechanism
worked. Inspecting the *result* in the Health app showed what it actually
cost: those 17 samples appeared as 17 separate rows in Walking + Running
Distance → All Recorded Data, each a one-second, ~5.6 m entry (confirmed in
Health's sample detail: start 12:47:08, end 12:47:09, 5,6 m) — permanent,
user-visible clutter, not structure. That observation is what drove the
correction above; the sync-identifier mechanics themselves are unaffected by
moving to one sample — a single sample tagged with the run id behaves exactly
as N did.

**Samples are attached, not duplicated.** `store.add(initializedSamples, to:
workout)` (`ios/WorkoutsModule.swift:201`) runs after `store.save(workout)`, so
the distance sample belongs to the workout and is not double-counted against
daily totals.

### 3.2 Payload shapes

`LocationForSaving` (`src/types/Workouts.ts:107-116`) requires **eight non-null
numbers**: `latitude`, `longitude`, `altitude`, `course`, `speed`,
`horizontalAccuracy`, `verticalAccuracy`, `date`. Our `run_points` stores
nullable `altitude`/`accuracy`/`speed` and has **no** `course` or
`verticalAccuracy` at all. §5.1 defines the fill.

`QuantitySampleForSaving` (`src/types/QuantitySample.ts:28-36`) is
`{ startDate, endDate, quantityType, quantity, unit }` — hence §5.2's need for
a real *time window* for the sample.

### 3.3 Config plugin

Read from `app.plugin.ts`:

- `com.apple.developer.healthkit` entitlement is always added (`:27`).
- **`background` defaults to `true`**, adding the
  `com.apple.developer.healthkit.background-delivery` entitlement (`:31-33`)
  *and* an AppDelegate modification. `background: false` suppresses both. This
  confirms ADR 0011 §3 and remains load-bearing.
- **`NSHealthShareUsageDescription` is written unconditionally** (`:44-50`).
  There is no opt-out: omit it and the plugin injects
  `"RunBro wants to read your health data"` into Info.plist. Only the *Update*
  description can be suppressed (with `false`). For an app that never reads,
  that default is a false statement shipping in the binary. §8 removes it.

### 3.4 Simulator reality

- **HealthKit works on the simulator.** `Health.app` and
  `HealthKit.framework` both ship in the iOS 26.5 runtime, so the full
  save path — including inspecting the result in the Health app — is
  verifiable without a device.
- **`xcrun simctl privacy` has no `health` service.** Unlike location, the
  Health grant cannot be pre-seeded, and the authorization sheet is presented
  by `HealthPrivacyService.app` (a remote view controller) rather than by our
  process. This shapes the E2E scope in §9.

## 4. Architecture

```
src/domain/health.ts                  # PURE mapping: run + fixes → HealthWorkoutInput
src/services/health/
├── port.ts                           # HealthAdapter + neutral payload types
├── adapter.ios.ts                    # the ONLY file importing @kingstinct/react-native-healthkit
├── index.ts                          # composition seam: syncRunToHealth policy
├── sync.ts                           # DB read → map → save → flip healthkit_saved
├── with-health-sync.ts               # persistence decorator: fires sync after the local write commits
├── open-health-app.ts                # Settings deep link: x-apple-health://, openSettings() fallback
└── use-health-authorization.ts       # AppState-refreshing status hook
src/components/health-status-row.tsx  # summary surface
src/app/onboarding/health.tsx         # primer step
```

### 4.1 The port

```ts
export type HealthAuthorization = 'authorized' | 'denied' | 'notDetermined' | 'unavailable';

export interface HealthAdapter {
  /** Share status for the workout type; `'unavailable'` on a device without HealthKit — device
   *  availability folds into this return rather than a separate isAvailable() (dropped
   *  2026-08-01: no caller ever needed it apart from what this already reports). Synchronous —
   *  the underlying API is. */
  getAuthorization(): HealthAuthorization;
  /** Prompts if still undetermined, then re-reads the real status. */
  requestWriteAccess(): Promise<HealthAuthorization>;
  saveRun(input: HealthWorkoutInput): Promise<void>;
}
```

`requestWriteAccess` must **not** return the library's boolean. That boolean
only says the prompt completed; the adapter re-reads
`authorizationStatusFor(WorkoutTypeIdentifier)` and returns that (§3).

Write set: `toShare: ['HKWorkoutTypeIdentifier', 'HKWorkoutRouteTypeIdentifier',
'HKQuantityTypeIdentifierDistanceWalkingRunning']`, `toRead` never passed.

The payload crossing the port is platform-neutral — callers never see HealthKit
types (ADR 0011 §1):

```ts
export interface HealthWorkoutInput {
  startedAt: number;                                // epoch ms, as everywhere else in domain/
  endedAt: number;
  totalDistanceM: number | null;
  distanceSample: HealthDistanceSample | null;      // { startedAt, endedAt, meters } spanning the whole run — corrected 2026-08-01, was one per segment
  route: readonly HealthRoutePoint[];               // all eight fields populated
  syncIdentifier: string;                           // the run's own id — HealthKit's retry-idempotency key (§11)
}
```

Times cross the port as epoch milliseconds, matching `LocationFix.timestamp` and
`BufferedRunPoint.timestamp`; the adapter is the only place that constructs the
`Date` objects the library wants.

### 4.2 The pure mapper

`src/domain/health.ts` is pure TypeScript covered by `bun test` — no React, no
Expo, no DB import (ADR 0003 §1). It owns the two genuinely tricky conversions
(§5.1, §5.2) and takes narrow structural inputs rather than Drizzle row types,
so `domain/` keeps its independence from `db/`.

### 4.3 The sync service

`syncRunToHealth(runId)` in `src/services/health/sync.ts`:

1. Return immediately unless `getAuthorization() === 'authorized'` — which
   already folds device unavailability into `'unavailable'`, so no separate
   check is needed. A denial is respected silently — no prompt, no error,
   flag untouched (ADR 0011 §4).
2. Read the run row and its fixes (`loadRunFixes`, imperative — never
   `useLiveQuery` on `run_points`, ADR 0004 §3).
3. Map via `domain/health.ts`, call `adapter.saveRun`, then set
   `healthkit_saved = true` and re-stamp `updated_at`.
4. Never throws. Resolves a `HealthSyncResult`: `'saved'` on a real write;
   `'skipped'` when not authorized, already saved, or the run isn't a
   finalized row yet; `'busy'` when another call for this run is already
   in flight; `'failed'` only when the write itself threw and left the flag
   false. Only `'failed'` names an actual problem — a caller must not treat a
   collapsed concurrent call or a deliberate no-op as a failure, which is
   exactly why the summary's retry state reacts to `'failed'` alone.

A module-level in-flight set keyed by `runId` makes concurrent calls (auto-save
racing a button tap) idempotent: the losing call resolves `'busy'` rather than
retrying, erroring, or writing a second workout.

### 4.4 The trigger: a persistence decorator

The engine is **not** modified. `src/services/run-engine/index.ts` already
composes the engine's ports; the Health save is layered there:

```ts
export const runEngine = new RunEngine({
  persistence: withHealthSync(dbRunPersistence, syncRunToHealth),
  …
});
```

`withHealthSync` wraps `saveRun` and `finalizeRun`, calling `syncRunToHealth`
after the local write resolves. `syncRunToHealth` is passed as a bare function
reference, not wrapped as `(runId) => void syncRunToHealth(runId)`: that
wrapping form discards the promise before it reaches `withHealthSync`'s own
`fireSync`, so a rejection becomes an unhandled rejection instead of the
logged warning `fireSync`'s `.catch` is there to produce — a regression this
slice found and fixed, with a test in `with-health-sync.test.ts` guarding it.
Consequences:

- The local save always precedes the Health call, structurally rather than by
  convention (ADR 0011 §4).
- It fires exactly once per run *finish*, so `abandon()` and the
  crash-recovery re-finalize are covered, while a Log revisit is not — which is
  what keeps "no backfill" true.
- `run-engine`'s test suites are untouched. The engine is the most delicate code
  in the app; this slice does not go near it.

## 5. Data mapping

### 5.1 Route points

`run_points` → `LocationForSaving`, using CoreLocation's own invalid-value
convention so Health reads missing data as unknown rather than as a real zero:

| Field | Source | Missing → |
|---|---|---|
| `latitude` / `longitude` | `lat` / `lng` | n/a (non-null) |
| `date` | `timestamp` | n/a |
| `altitude` | `altitude` | `0` |
| `verticalAccuracy` | *not stored* | `-1` (invalid) |
| `horizontalAccuracy` | `accuracy` | `-1` |
| `speed` | `speed` | `-1` |
| `course` | *not stored* | `-1` |

Raw persisted fixes are used — the same stream the route map draws from,
before simplification — but sorted chronologically by each fix's own
`timestamp` rather than `seq`: HealthKit consumes the route as a path, and
`seq` is only arrival order at the engine, which can disagree with the fix's
own clock. Smoothing is presentation and distance math (ADR 0021); the route
handed to Health is the recorded track.

### 5.2 The distance sample: one whole-session window, now — not per-segment

**Corrected 2026-08-01 (ADR 0011 amendment item 7).** The original design
derived each segment's window from its own points — the first and last
`timestamp` among fixes carrying that `segment_seq` — because `run_segments`
stores `actual_duration_s` but **no timestamps**, and those durations exclude
paused time, so prefix-summing them from `started_at` would have placed every
sample after a pause at the wrong wall-clock time. That derivation, and the
`Math.min`/`Math.max` window-tracking it needed, is gone along with the
per-segment samples themselves: the workout now carries a single sample whose
window is just the run's own `started_at`/`ended_at` — the same window the
workout itself uses — so it is exact by construction, with no pause problem
to solve. It degrades correctly too: a GPS-denied (or otherwise
unmeasured-distance) run produces no sample at all, reusing the same
`hasMeasurableDistance` predicate as before.

### 5.3 The `totals` invariant

Per §3.1(4), the library assigns the workout's `totalDistance` from whatever
metre-compatible quantity sample it is given. With a single whole-session
sample built directly from `totalDistanceM` (`toHealthDistanceSample` in
`domain/health.ts`), that assignment already agrees with the total — the
overwrite this invariant originally guarded against is harmless now that
there is only one sample, and it can never diverge from the total it was
built from. `totals: { distance: totalDistanceM }` is still passed
regardless, as the explicit source of truth rather than relying on that
agreement incidentally holding — documented with a `// why:` at the call
site. The adapter's own code remains a plain conditional —
`input.totalDistanceM != null ? { distance: input.totalDistanceM } : undefined`
— which only guarantees `totals` travels alongside whatever `totalDistanceM`
it was handed. Automated coverage is a unit test on the pure mapper
`toHealthWorkout` asserting the sample and the total agree; the adapter
itself has no test, since it imports the native HealthKit module and cannot
load under `bun test`.

### 5.4 Duration and pauses — an accepted discrepancy

The workout is saved with the run's true `started_at` / `ended_at`. For a paused
run, Health's duration (`end − start`) therefore exceeds the app's
`active_duration_s`.

The correct fix is `HKWorkoutEvent(.pause/.resume)`, which §3.1(1) rules out.
The alternative — shrinking the window to `startedAt + activeDurationS` — would
place route points outside the workout's own time range, which is worse and
semantically false. The app has no auto-pause and pausing mid-session is rare,
so honest timestamps win. Documented, not hidden.

### 5.5 Runs without GPS

A location-denied run has no points: no route, no distance sample, `distanceM`
null, no `totals`. It is still written as a real running workout with its
duration. This matters — timer-only sessions are a supported first-class path
(ADR 0008 §5), and they belong in Health too.

## 6. Failure and degradation

| Situation | Behaviour |
|---|---|
| HealthKit unavailable | Port reports `unavailable`; Settings row says so; no onboarding prompt fires. |
| Authorization not determined | Nothing is written. Summary offers the button, which prompts. |
| Authorization denied | Respected silently and permanently — iOS never re-prompts. Settings offers the route to change it. |
| Save throws | Logged; `healthkit_saved` stays false; summary shows the retry button. The local run is already safe. |
| Route save fails after workout save | The workout remains in Health without its route, and the flag stays false. A retry writes a **second** workout — see §11. |
| App killed mid-save | Flag stays false; the run is retryable from its summary forever. |

## 7. UI surfaces

### 7.1 Run summary — `HealthStatusRow`

A domain component (ADR 0013) composed into `runs/[runId]/index.tsx`, which
already live-queries `runs` — a top-level table with a fixed id, the approved
live-query case (ADR 0004 §3) — so the row flips reactively the moment
`healthkit_saved` is set, with no extra plumbing.

States: **saved** → a confirmation row; **not saved** → a "Save to Apple Health"
button; **unavailable/denied** → nothing, since there is no action to offer on
this screen. The same button serves the fresh-finish retry and the deliberate
push of an older run — one code path, which is what makes "no backfill, but
pushable by choice" cheap.

### 7.2 Settings — an "Apple Health" section

Shaped exactly like the existing Location section, whose pattern already solves
this problem: `LabeledContent "Access"` reporting
Authorized / Denied / Not Set / Unavailable, plus a conditional button —
*Enable Apple Health* when undetermined, or a button that takes the user
straight to where they can change it when denied.

Status is read through `useHealthAuthorization()`, mirroring
`useLocationPermission`: re-read on `AppState → 'active'`, because the user
changes this in another app and returns rather than remounting the screen.

**Resolved (2026-08-01).** There is still no public deep link to Health's
per-app data-access page, so both candidates were tried on the simulator as
planned. `Linking.openSettings()` reaches only this app's own Settings pane,
which does not list HealthKit, confirming the doubt. The undocumented
`x-apple-health://` **works**: it opens Health.app at its root. That is what
ships, with `openSettings()` kept as the safety-net fallback if the
undocumented scheme is ever rejected by `Linking.openURL` — a working link to
the app's root beats none, so the plain-instructions fallback is unneeded.

Two rows now share the label "Access". That is safe for ADR 0016 selectors
because `LabeledContent` merges to a single element (`"Access, Never"`), so
flows match the *value* suffix, and the two rows' value vocabularies do not
overlap.

### 7.3 Onboarding — `health-primer-v1`

Appended to `ONBOARDING_STEPS`, which is versioned by id: existing users see
only this one new step on update ("One more thing…"), exactly as spec §13
designed. Built on `OnboardingStepScreen` like the location primer — primary
*Connect Apple Health* → `requestWriteAccess()` → advance; secondary *Not Now* →
advance unchanged. A denial advances identically to a skip; Health is optional.

## 8. Build config

```jsonc
"./plugins/with-healthkit-write-only",
["@kingstinct/react-native-healthkit", {
  "NSHealthUpdateUsageDescription": "Save your completed runs (duration, distance, route) to Apple Health.",
  "background": false          // load-bearing: no background-delivery entitlement, no AppDelegate mod
}]
```

Plus a small **local config plugin**, registered *before* the library plugin
above, that deletes `NSHealthShareUsageDescription` from Info.plist (§3.3) —
the library writes a read-access purpose string unconditionally, and this app
never reads. `@expo/config-plugins` mods chain so each plugin's own mutation
runs before it delegates to the mod registered before it in the array — the
earlier-registered plugin's effect is therefore the one that lands last, which
is why the local plugin has to be listed *first* to win. Ten lines of
`withInfoPlist`, and it keeps the binary's claims true and the App Privacy
label at "data not collected".

New dependencies: `@kingstinct/react-native-healthkit` (pinned `14.0.2`) and
`react-native-nitro-modules` — the app's first Nitro dependency, invisible
outside the adapter (ADR 0011).

This is a **native change**: new entitlement and Info.plist keys. The
fingerprint changes, so the first `e2e-refresh` after it must be a full rebuild,
not a repack — a JS-only repack into a pre-HealthKit `.app` would die at import,
the same failure mode `expo-maps` produced (AGENTS.md).

## 9. Testing

**Unit (`bun test`)** — `domain/health.ts` carries the risk and takes the
coverage: null-filling per §5.1; the §5.2 whole-session distance sample,
including a GPS-less run and a zero/negative/non-finite distance producing
none; empty-route runs; and the §5.3 invariant that the sample and the run
total always agree.

**E2E (Maestro).** Bounded by §3.4: the Health grant cannot be pre-seeded by
`simctl`, and the authorization sheet belongs to another process. Flows
therefore cover what is deterministic — the primer renders and *Not Now*
advances into the app; the Settings section reports a not-authorized state; a
summary for an unsaved run shows its button. **No flow drives the system
authorization sheet.** This is the same reasoning ADR 0001 used when it dropped
the GPS-motion flow: no flow for what the harness cannot reach.

**Manual, on the simulator** (possible because Health.app ships in the runtime):
grant the permission, complete a compressed session, confirm the workout appears
in Health with its route and distance, then confirm a denied run stays out and
its summary offers the button.

**Device checklist** gains: a real outdoor run appearing in Health with a
correct route, and the deny → later-enable path.

## 10. Documentation impact

- **ADR 0011** — amended 2026-08-01: drop `activeEnergyBurned` with its
  rationale; record that Apple's segmentation is blocked on `master` too, so
  "own a small native module" stays the documented escape hatch rather than a
  rejected option; add the `totals` overwrite, dropped per-sample metadata, and
  unconditional Share-description traps; replace the Settings *toggle* with the
  reporting row; note the retry lives on `runs/[runId]`.
- **Master spec** — §9 (retry location, energy, control model) and §13
  (Stage 5 split into a Health slice and a deferred polish slice).
- **AGENTS.md** — the HealthKit entry in the ADR list already exists; add the
  Context7-is-unreliable-for-this-library warning where it will be found.
- **Privacy policy** — placeholder document plus the URL field, explicitly not
  submission-ready.

## 11. Risks

1. **A retry after a partial failure duplicating a workout — fixed, one half
   unverified.** If `saveWorkoutSample` succeeds and `saveWorkoutRoute` fails,
   the flag stays false and the run is retryable. This is **no longer an
   accepted risk**: `saveRun` tags the workout and its quantity sample (one
   whole-session sample as of the §2 correction, originally one per segment)
   with `HKSyncIdentifier` / `HKSyncVersion` metadata keyed on the run id —
   the version stamped fresh via `Date.now()` on every call, since
   `HKMetadata.h` only replaces a stored object under a repeated sync
   identifier when the new save's version is strictly *greater* than what's
   stored (a fixed version, as this originally shipped, can never clear that
   bar on a same-release retry) — so a retry replaces the workout instead of
   duplicating it. (The keys are the library's actual serialized string
   names, not the `HKMetadataKeySyncIdentifier` Swift constant this risk
   originally named — see AGENTS.md's Context7 warning.)

   **Verified on the simulator (2026-08-01):** tagging every per-segment
   sample with the same identifier as the workout does not collapse them —
   all 17 samples from a real multi-segment run survived individually in
   Health's "Show All Data" list (§3.1). That observation, read at the time as
   confirming the mechanism, is also what exposed the §2 defect: 17 surviving
   rows is 17 rows of clutter, not structure. The mechanism itself is
   unaffected by moving to a single sample.

   **Not yet verified:** that a genuine retry actually replaces the workout
   rather than duplicating it. The summary's button hides once
   `healthkit_saved` is set, so there is currently no UI path to a second
   save attempt on the same run — confirming this needs either a debug
   affordance to force a retry, or a direct DB flip plus a device-side Health
   comparison before/after. Recorded honestly as open, not assumed to work
   because the identifier mechanism is standard.
2. **Library staleness in the write path.** Pinned, boxed behind one adapter
   file, and non-blocking; ADR 0011 already prices this. The confirmed
   `master`-level stagnation of workout events is a mild negative signal worth
   revisiting at the next SDK bump.
3. **Nitro modules enter the tree.** First use in this app; the `e2e-simulator`
   build must be rebuilt from scratch to prove it links.

## 12. Out of scope

Reading any Health data · heart rate · energy burned · workout events and
`HKWorkoutActivity` (upstream-blocked) · Android Health Connect (ADR 0011 §7) ·
automatic backfill · background delivery · App Store submission and a real
privacy policy · every non-Health part of Stage 5.
