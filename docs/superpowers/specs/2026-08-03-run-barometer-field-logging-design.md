# Barometer capture and full-run field export — design

Date: 2026-08-03
Status: **design — awaiting approval**
Revision: **3**. Revision 2 rewrote revision 1 after three independent
adversarial reviews found a fatal flaw in its central claim (§15 records what
changed and why). Revision 3 adds §8.0: the owner pointed out that none of the
captures fits the app's session model, and that borrowing a plan day for a
stairwell capture would corrupt the training record irreversibly.

Implements the capture half of [ADR 0015](../../adr/0015-run-elevation-on-device-barometer.md)
and discharges its open item 7 with field data instead of a spike. Follows the
[run elevation & pace chart slice](2026-08-02-run-elevation-and-pace-chart-design.md),
which deferred elevation whole (§3.6 there) after measuring GPS altitude unusable
for both totals and a drawn line.

---

## 1. What this slice is, and what it deliberately is not

**It is:** barometer capture during real runs, raw storage of everything a run
emits, a full-run export to a text file, and **a capture protocol that can
actually decide the tuning** (§8).

**It is not:** any elevation UI. No gain/loss totals, no elevation line, no live
climbing/descending readout. `src/domain/elevation.ts` ships **still unconsumed**
at the end of this slice.

The reducer's tuning — `ElevationConfig`'s `medianWindow` / `hysteresisM` —
cannot be chosen honestly today:

- The shipped `GPS_ELEVATION_CONFIG` is `{ medianWindow: 31, hysteresisM: 10 }`,
  measured against **1 Hz** GPS fixes.
- `CMAltimeter.h` documents relative-altitude delivery as *"every few seconds"*
  (verified in the iPhoneOS26.5 SDK header). At one sample per 4 s, a 31-sample
  median window spans **124 s** — 229 m of ground at 1.85 m/s, longer than a
  typical urban hill, so it would smear real terrain rather than reject noise.
  The window counts *samples*, and nothing in the code notices that a sample now
  means something different.
- **The cadence is not tunable.** `expo-sensors`' `BarometerModule.swift`
  implements `setUpdateInterval` as `{ (_: Double) in // Nothing we can do }`, and
  `CMAltimeter` exposes no interval control. Whatever cadence iOS chooses is a
  **hard constraint**, not a knob — which is why §8.6 admits changing the window
  *primitive* as a legitimate outcome.
- The true cadence, the flat-ground jitter, and the drift magnitude are
  **unmeasured**.

Rendering from guessed tuning is the exact failure the previous slice cut
elevation to avoid. This slice buys the measurement;
[the render slice](#13-deferred-to-the-render-slice) spends it.

## 2. Why logging in the real app, and what ground truth is actually available

ADR 0015 item 7 asks for a "Milestone-style spike". A throwaway spike screen was
the plan; it was replaced with logging in the app the owner actually runs with —
an EAS `preview` build on a real iPhone, pocketed, screen off, for 30+ minutes.
A spike screen held in the hand measures none of the conditions that matter.

The export exists because that build has no Metro, no dev client, and no console
(`eas.json`: `preview` is `distribution: internal`, `channel: preview`, no
`developmentClient` — verified). There is no other way to get data out of it.
**The export is permanent, second-class:** once built, every future feature
needing field data has it, and past runs can be re-exported.

### 2.1 The closed loop measures drift, not tuning — corrected

Revision 1 claimed that because every run starts and ends at the owner's house,
`gain == loss` and `net == 0` are exact invariants that **score the tuning**.
That was wrong twice, and it was the design's load-bearing claim.

**Wrong the first way — it is a structural identity, not a signal.** In
`elevationStep`, every banked move sets `anchorM = smoothed`, so for *any* config
and *any* input, `gain − loss = anchor_final − anchor_first`, and a sample only
fails to bank when `|smoothed − anchor| < hysteresisM`. Therefore:

> `|gain − loss| ≤ hysteresisM + (vertical closure error of the smoothed series)`

`|gain − loss|` measures **the parameter being chosen**, plus nuisance drift. It
carries no accuracy information. Measured against the real reducer (30 seeds,
450 samples = 30 min at 4 s cadence, a real 30 m hill up and down, ±0.3 m noise,
+2 m drift):

| config | gain | loss | **`\|gain−loss\|`** | flat phantom gain | error vs 30 m truth |
|---|---|---|---|---|---|
| w5 h1 | 30.86 | 28.92 | 1.94 | 1.79 | +0.86 |
| **w5 h2** | 30.39 | 27.91 | 2.48 | 1.70 | **+0.39** |
| w15 h3 | 29.27 | 26.11 | 3.16 | 0.00 | −0.73 |
| w31 h10 (shipped GPS) | 30.50 | 20.38 | 10.12 | 0.00 | +0.50 |
| w61 h30 | 30.24 | 0.00 | 30.24 | 0.00 | +0.24 |
| **w121 h60** | **0.00** | **0.00** | **0.00** | **0.00** | **−30.00** |

`|gain−loss| ≈ hysteresisM` down the column — the identity, visible. And the last
row is the fatal case: a config reporting **zero elevation on a run containing a
real 30 m hill** satisfies both invariants *exactly* and beats the most accurate
config on revision 1's own score. Running that sweep as written selects
`{ medianWindow: 121, hysteresisM: 60 }` with a perfect 0.00, and the render
slice ships a feature that reads 0 m forever — worse than the GPS slice's
fabricated 9.5 m, because it is silent. Revision 1's third score, flat-section
phantom gain, is minimised in the **same** direction, so all three scores shared
one global minimum: report nothing. **There was no term punishing
over-smoothing.**

**Wrong the second way — a loop closed horizontally is not closed
barometrically.** The doorstep has a fixed geodetic altitude; the barometer
measures *pressure*. At sea level `dP/dh = −12 Pa/m`, so:

| source | magnitude over a 30 min run |
|---|---|
| Synoptic weather drift | 0.4–2.1 m calm, 4.2–8.3 m active, ~12.5 m frontal |
| MEMS thermal drift (warm house → cold street → pocket rewarming) | 1.0–2.5 m, and **monotone during warm-up**, mimicking a slow climb exactly where the median window is still filling |
| Indoor↔outdoor envelope ΔP (HVAC, wind stack effect) | 0.4–2.1 m |
| Vertical position at the doorstep (a flight up/down before starting) | ~3 m per storey |

Realistic closure error: **1–3 m calm, 5–15 m active**, against a candidate
`hysteresisM` of 1–3 m. The "exact invariant" is violated by 1–5× the parameter
being tuned.

### 2.2 What replaces it

Three things, none of which need code:

1. **An exactly-known nonzero vertical magnitude** — the term that punishes
   over-smoothing. A stairwell: measure one riser with a tape, count the steps,
   `N × riser` is exact to a centimetre.
2. **A certain zero** — the phone stationary on a table with a run active. Not
   "a flat section" (which requires ground truth we do not have), but *certain*
   zero gain, zero loss, and a long pure-noise record that can be resampled to
   the 50 seeds `src/domain/elevation.test.ts` already established as necessary
   (its own comment records that 5 seeds "passed on seed luck").
3. **Measured drift instead of assumed closure** — 90 s standing still at the
   doorstep at both ends of every logged run, *inside* the run. Two stationary
   anchors at a physically identical altitude make the run's drift a measured,
   subtractable covariate rather than an unmeasurable confound.

The scoring function is stated in §8.5. The closed loop survives only as a
**drift diagnostic**, never as a tuning score.

## 3. Architecture

```
src/services/elevation/port.ts          # the ADR 0015 port — source-agnostic
src/services/elevation/adapter.ios.ts   # expo-sensors Barometer, one permanent listener
src/services/elevation/index.ts
src/services/elevation/use-motion-permission.ts   # via Pedometer (§6.3)

src/services/run-engine/run-log.ts      # typed entry constructors + buffers + seq
src/services/run-engine/engine.ts       # wiring only
src/services/run-engine/index.ts        # composition root: onFix/AppState/battery -> engine.note

src/domain/run-export.ts                # PURE: rows -> the export string
src/services/run-export.ts              # write to cache + system share sheet
src/components/run-export-row.tsx       # the plain summary affordance

src/db/schema.ts                        # 2 new tables, 3 new columns (§5)
```

§12 lists **every** file this touches, including the fifteen revision 1 failed to
name.

### 3.1 The capture-ownership fork, and why the engine owns it

**A (chosen) — the engine owns the stream.** It subscribes at run start, buffers
readings as it already buffers GPS points, and hands them to `RunStore.flush` so
they land in the **same transaction** as `run_points` and the crash snapshot.

**B (rejected) — a recorder alongside the engine**, writing on its own cadence.
Rejected because it means a second writer and a second transaction per ~1 Hz
cadence — write amplification is what `point-batch-scheduler.ts` exists to
prevent — and it reopens the divergence the atomic flush closes
(`run-store/port.ts:55`: "a rejected flush commits neither, so points and
snapshot never diverge"). Also the barometer is not only an instrument: the
render slice needs these readings in the engine's hands, so B would be
re-plumbed the moment tuning finishes.

A third option — quarantining everything as a deletable instrument layer — was
killed by the decision to keep the export permanently.

A verified property of the existing code makes A work better than designed:
**`flushOnce`'s `finally` re-arms unconditionally** while running or paused, so
altitude samples land every 5 s even with **zero** GPS fixes. Without that, a GPS
dropout would have manufactured a fake altitude gap.

### 3.2 How A avoids growing `engine.ts`

`engine.ts` is 709 lines and the most safety-critical file in the repo. Two
existing patterns contain the additions:

- **Buffering and entry construction live in a sibling module.** `run-log.ts`
  owns the buffers, the `seq` counters, and typed constructors, so `engine.ts`
  calls `this.log.lifecycle(state)` rather than assembling JSON inline —
  mirroring `point-batch-scheduler.ts`, already a separate 56-line file.
- **Platform listeners live in the composition root.** `run-engine/index.ts`
  already starts the location tracker and owns the `onFix` callback; it
  subscribes `AppState` and `expo-battery` there and pipes everything into a
  single `engine.note(kind, detail)`. `engine.ts` gains no React Native or Expo
  imports.

## 4. The Elevation port

```ts
export interface AltitudeReading {
  /** Receipt wall clock, epoch ms. Not monotonic — see `sensorTimestampS`. */
  at: number;
  /** CoreMotion's boot-relative clock, seconds. Monotonic. */
  sensorTimestampS: number;
  pressureHpa: number;
  /** Null when the platform reported none; iOS-only in the source payload. */
  relativeAltitudeM: number | null;
  /** Constant within one healthy run; an increment marks an adapter-initiated restart. */
  epoch: number;
}

export type MotionPermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface ElevationSource {
  isAvailable(): Promise<boolean>;
  requestPermission(): Promise<MotionPermissionStatus>;
  getPermissionStatus(): Promise<MotionPermissionStatus>;
  /** Owns the single native subscription; idempotent. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Registers into a JS fan-out — never touches the native subscription (§4.2). */
  onReading(cb: (reading: AltitudeReading) => void): () => void;
}
```

Shaped to mirror `LocationTracker` method-for-method, plus `isAvailable`, which
ADR 0015 item 2 mandates because barometer hardware is not universal.

### 4.1 Both clocks, because neither alone answers the question

Revision 1 asserted `BarometerMeasurement` carries no timestamp, and argued
receipt time was *better*. **Both claims were false.** The shipped type is:

```ts
export type BarometerMeasurement = {
  pressure: number;            // hPa
  relativeAltitude?: number;   // m, iOS only, OPTIONAL
  timestamp: number;           // CMLogItem.timestamp — seconds since boot, monotonic
};
```

`BarometerModule.swift` forwards `"timestamp": data.timestamp`, and the SDK 57
docs list it. Receipt time **alone** cannot distinguish three different gaps:

| gap cause | sensor timestamps | receipt timestamps |
|---|---|---|
| Sensor did not sample | jump | jump |
| JS thread not scheduled (readings queued, delivered in a burst) | dense | clustered |
| Process frozen | jump, no intermediate samples | jump |

With one clock all three collapse into one indistinguishable "gap" — which is
precisely the discrimination this slice exists to make. Logging both costs one
`real` column. Additionally, `at` is `Date.now()` — **wall clock**, so an NTP
step mid-run would be indistinguishable from a sensor gap; the monotonic sensor
clock is immune.

`relativeAltitude` being **optional** is narrowed at the adapter boundary, not
left to §6.1's `Number.isFinite` sanitize.

### 4.2 The rebase detector is pressure continuity, not the epoch

`relativeAltitude` is relative to the start of the `CMAltimeter` session, and
rebases to 0 on restart — Apple's header confirms it: *"The first altitude update
will be established as the reference altitude and have relative altitude 0."*
Nothing in the payload announces this.

Revision 1 made `epoch` the detector, "incremented only when the adapter calls
`startRelativeAltitudeUpdates`". **The adapter never calls it.** `expo-sensors`
calls it inside `OnStartObserving`, which fires when the **first JS event
listener is added**, and `stopRelativeAltitudeUpdates` inside `OnStopObserving`,
when the **last is removed**. So `epoch` false-positives (adapter `start()` while
another listener already holds the subscription) and — far worse —
false-negatives: a restart the adapter did not initiate rebases altitude while
`epoch` stays put. Across process death it fails silently in exactly the crash
scenario it existed for: a new process gets a fresh altimeter *and* a fresh
counter, so the export reads `epoch = 1` across a cliff-shaped discontinuity.

**The primary detector is `pressureHpa` continuity.** A rebase is a
`relativeAltitudeM` discontinuity to ~0 across a *continuous* pressure reading —
observable, source-independent, and immune to process boundaries. This is why
logging pressure alongside altitude is the most valuable single decision in the
design.

`epoch` remains as a corroborating hint, with the invariant restated: **constant
within a run**, not equal to 1. It is seeded on `restore()` from
`max(epoch)` for that `run_id` and then incremented, and a `sensor` log entry
carries a per-process token so a process boundary is visible in the export.

Two mechanics follow directly:

- **The adapter holds one permanent module-scope listener** for the run's
  lifetime and fans out to `onReading` subscribers in JS — the precedent is
  `location-tracker/adapter.ios.ts`'s `listeners` Set. Without this, an ordinary
  React unmount that drops the last listener **stops the altimeter**, and the
  next subscribe rebases: the cliff, reachable from routine navigation.
- **`start()` and `onReading()` are not separable at the native layer.**
  `start()` owns the subscription; `onReading` never touches it.

### 4.3 Lifecycle — corrected against the actual engine

Revision 1 said the source "mirrors the tracker: started on `start()` and
`resume()`". Both halves were wrong. `tracker.start()` is called at
`engine.ts:245` (`start()`) and `engine.ts:303` (**`restore()`**) — never
`resume()`, which does not need it because `pause()` never stopped it (verified:
`pause()` at `engine.ts:250` appends the event, sets status, arms the flush, and
announces the cue; no `tracker.stop()`).

So revision 1 would have started elevation where the tracker isn't started and
omitted the one place it is — meaning **a crash-resumed run captures zero
samples**, which in the export is indistinguishable from the suspension gap that
is the primary research question.

Corrected:

- Start in `start()` **and `restore()`**.
- Stop in `finalize()` **and `reset()`** — `reset()` already stops the tracker
  (`engine.ts:338`), so stopping only at finalize would leave `CMAltimeter`
  running after any path to idle that skips finalize, and desync the adapter's
  idempotence flag from native listener state.
- Route start/stop through an **`elevationOps` chain** mirroring `queueTracker`
  (`engine.ts:205`), which exists because "unordered, the old `stop()` can land
  after the new `start()`". A fire-and-forget `void start()` inherits that race
  in the harmful direction: a finalize `stop()` landing before a `start()` leaves
  the barometer running with the app backgrounded, indefinitely.
- Add a Motion analogue of `retryTracking()` (`run-engine/index.ts:135`), so a
  grant made mid-run via Settings starts capture for that run.

## 5. Storage

One Drizzle migration, generated via `bun run db:generate` — never hand-written
(`src/db/migrations/` is guarded). Purely additive: all three new columns are
nullable with no default, so drizzle-kit emits plain `ALTER TABLE … ADD COLUMN`
with no SQLite table rebuild and no backfill.

### 5.1 Product data gets typed columns; instrumentation gets one log

- **`run_altitude_samples`** — typed. *Product* data: ADR 0015 item 5's promised
  home, consumed for real by the render slice.
- **`run_log`** — one generic append-only table for instrumentation. New signal =
  new `kind`, **no migration**. That extensibility is the point: the next feature
  needing field data should find the instrument already built.

```ts
export const runAltitudeSamples = sqliteTable('run_altitude_samples', {
  runId: text('run_id').notNull().references(() => runs.id),
  seq: integer('seq').notNull(),
  at: text('at').notNull(),
  sensorTimestampS: real('sensor_timestamp_s'),
  pressureHpa: real('pressure_hpa').notNull(),
  relativeAltitudeM: real('relative_altitude_m'),
  epoch: integer('epoch').notNull(),
  segmentSeq: integer('segment_seq').notNull(),
});

export const runLog = sqliteTable('run_log', {
  runId: text('run_id').notNull().references(() => runs.id),
  seq: integer('seq').notNull(),
  at: text('at').notNull(),
  kind: text('kind').notNull(),
  detailJson: text('detail_json'),
});
```

**Neither table has a composite primary key, and that is deliberate.** Revision 1
gave both `(run_id, seq)` PKs copied from `run_points`. But `restore()` rebuilds
`nextSeq` for **points only** (`engine.ts:500`), so a resumed run re-emits sample
`seq` 0, 1, 2… under a `run_id` that already holds them → `UNIQUE constraint
failed` → and because the insert is synchronous inside `db.transaction(…)`, the
throw rolls back **the whole flush, including the GPS points**. Every subsequent
flush fails identically, `finalizeRun` re-derives distance from `run_points`
only, and the run is short by its entire resumed portion. §6.1's sanitization
does not help: that is a *constraint* failure, not a bad *value*.

Nothing joins or upserts on these `seq`s, so they are plain ordering columns over
the implicit rowid. An instrumentation row then becomes structurally incapable of
aborting the GPS transaction — which is what §6.1 actually promises.

Dropping the PKs removes the *crash*, not the need to seed: `seq` must still be
monotonic per run, because §6.2's drop detection reads a gap in it as evidence.
So `restore()` seeds both the `seq` counters and `epoch` from the stored maxima
for that `run_id`, and `parseSnapshotState` must not default them to 0 for a
snapshot written by a pre-slice build — that would reintroduce duplicate `seq`s on
the upgrade run.

**`kind` is plain `text`, not a Drizzle enum:** an enum forces a migration per new
signal, defeating the table's purpose. Kinds are typed in `run-log.ts`.

Initial kinds: `tick`, `fix_batch`, `fix_rejected`, `lifecycle`, `battery`,
`cue`, `sensor`, `permission`, `pedometer`, `samples_dropped`.

**ADR 0004 §5 exemption, claimed explicitly.** That ADR requires TEXT UUID
primary keys plus `created_at`/`updated_at`/`deleted_at` on *every* table. Both
new tables carry none: they are append-only, immutable, ~1 Hz-rate rows whose own
`at` is their temporal record, and they are deleted with their parent run. This is
the same exemption `run_points` takes and documents in place
(`src/db/schema.ts:34-42`, "avoids write amplification on the ~1 Hz batch
inserts"); it is stated here and repeated as a schema comment rather than left
implicit.

### 5.2 New columns

| Column | Why |
|---|---|
| `run_points.altitude_accuracy` (real, null) | iOS reports GPS **vertical** accuracy per fix and the app discards it. This identifies which noise regime a run was in — the ±10 m vs ±25 m distinction ADR 0015's amendment could only simulate. **Semantics: it is CoreLocation's raw `verticalAccuracy`, and a negative value means the altitude is invalid** (the existing `accuracyFilter` already guards horizontal accuracy with `> 0`, `geo.ts:40`). Any analysis must treat `<= 0` as "altitude invalid", not as an accuracy figure. Added to `LocationFix` as **optional**, so the ~14 existing fix literals across the test suite do not all have to change. |
| `runs.event_log_json` (text, null) | The event log is **destroyed at finalize** — it lives only in `active_run_snapshot`, which is cleared (`engine.ts:682`), `snapshotState` strips `end` events (`engine.ts:637`), and `runs` has no column. So a finished run cannot say when the runner paused, and pause is where a rebase would hide. A real data-loss fix independent of elevation. Must be written on **both** finalize paths, including the `saveRun` fallback (`engine.ts:658`) taken when no `'active'` row ever opened. |
| `runs.motion_permission` (text, null) | Distinguishes "no samples because denied" from "because hardware or code failed" when reading an export weeks later. Only meaningful once §6.3's permission source is correct — backed by `Barometer` it would have recorded `granted` unconditionally, a lie in the field designed to explain its own emptiness. |

### 5.3 Rejected: rejected fixes in `run_points`

A `rejected_reason` column on `run_points` was considered and **rejected**:
`run_points` is documented as "the single source of truth for distance, pace,
splits, and the route polyline + HealthKit route" and every consumer folds it
whole (`save-run.ts:12-15`). Admitting rejected drift would make every consumer
responsible for filtering it, forever, with silent route corruption as the
failure mode.

### 5.4 Storage cost

Per 30-minute run, at ~1 Hz GPS: ~1800 accepted points (existing), ~450–1800
altitude samples, ~360 `tick`, ~30–1800 `fix_batch`, a near-zero number of
`fix_rejected` (the accuracy filter rejects few fixes on a good run — revision 1
wrongly estimated ~1800, which would have implied no route at all), and a handful
of other rows. Call it **250–400 KB of new data per run**; a full 9-week program
adds well under 30 MB.

## 6. Capture wiring

| Signal | Source | Cadence | Lands in |
|---|---|---|---|
| Altitude readings | `ElevationSource` | sensor-driven | `run_altitude_samples` |
| **Aliveness tick** | one row per flush (the self-re-arming 5 s cadence) | 5 s | `run_log` `tick` |
| **Delivered fix batches** | `locationTracker.onFix` in the composition root | per callback | `run_log` `fix_batch` |
| Accuracy-filter rejections | `engine.ingestFix` | rare | `run_log` `fix_rejected` |
| Foreground/background | `AppState` (composition root) | on change | `run_log` `lifecycle` |
| Low-power mode + battery | `expo-battery` (composition root) | start + on change | `run_log` `battery` |
| Spoken cues | engine's existing announce path | per cue | `run_log` `cue` |
| Availability, permission, process token | adapter, once at start | once | `run_log` `sensor` |
| Dropped-sample counters | `run-log.ts` | on drop | `run_log` `samples_dropped` |
| Step count | `Pedometer.getStepCountAsync(new Date(startedAt), new Date(endedAt))` | once at finalize | `run_log` `pedometer` |
| Event log | engine's existing `events` array | once at finalize | `runs.event_log_json` |

### 6.1 The aliveness trace, and why revision 1 had none

Revision 1 claimed a gap in delivered fixes proves the process was suspended.
It does not, for three independently fatal reasons:

1. **CoreLocation delivers batches.** The TaskManager payload is
   `{ locations: Location.LocationObject[] }` — plural — and the task loops over
   it. Sixty locations arriving in one callback after a 60-second freeze produce
   sixty `run_points` at 1 Hz spanning the freeze, **byte-identical to
   continuous operation**, because the stored timestamp is `CLLocation.timestamp`
   (when the fix was *determined*), never receipt time. The engine's own `now`
   (`run-engine/index.ts:34`) is never recorded.
2. **`fix_rejected` is near-empty on a good run** (§5.4), and `ingestFix` never
   sees a fix delivered while **paused** at all (`engine.ts:289` gates on
   `status === 'running'`) — the very window §5.2 argues matters most.
3. **A locked 30-minute run yields one `lifecycle` row.** Suspension is invisible
   to `AppState` by construction: no JS runs to observe it.

So two signals are added. **`fix_batch`** is the primary trace — one row per
`onFix` callback carrying `{ receivedAt, count, firstAt, lastAt }`, hooked in the
composition root, the only place every delivered fix is visible. It is the
strongest aliveness evidence available because the callback runs headlessly under
ADR 0008's heartbeat. **`tick`** rides the existing flush cadence — no new timer —
giving a 5 s heartbeat of `Date.now()` values.

Also corrected: revision 1 conflated two rejections. `accuracyFilter` rejection
*is* inside `ingestFix` (`engine.ts:463`), but `smoothFix`'s velocity-gate
(`smoothedPoint: null`, `geo.ts:247-270`) does **not** reject the point —
`pendingPoints.push(point)` runs unconditionally. `fix_rejected` therefore means
the accuracy filter alone.

One property that licenses reading a gap as evidence at all:
`startRelativeAltitudeUpdatesToQueue:` delivers *"every few seconds"* — it is
**time-driven**, not change-driven (contrast `startAbsoluteAltitudeUpdates`,
which fires *"whenever a change in elevation is detected"*). So on this API,
silence means something stopped, not that altitude was constant.

### 6.2 The instrument must be incapable of harming a run

This ships in the owner's real running app. Four mechanisms:

1. **Every capture call is individually wrapped and fire-and-forget** — a
   `console.warn` and nothing else, matching the `haptics` adapter's precedent.
2. **Readings are sanitized at buffer time, not write time.** Non-finite
   `pressure`, and `undefined` `relativeAltitude`, are handled where they are
   buffered. Because samples ride the *same* transaction as `run_points`, an
   unwritable row would otherwise fail a flush carrying the GPS track. (Necessary
   but not sufficient on its own — §5.1's dropped PKs close the constraint case.)
3. **`seq` is assigned at buffer time from a monotonic per-run counter, and every
   drop is logged.** Otherwise a dropped sample leaves a clean gap in the export
   that is indistinguishable from a suspension gap — the thing we are measuring.
   `samples_dropped` rows carry running counts, and the header repeats them.
4. **Buffers and batches are both capped.** A buffer cap bounds memory; a *batch*
   cap is what respects SQLite's 32,766 bind-parameter limit, which is why
   `MAX_FLUSH_POINTS = 500` exists (`engine.ts:52`). Per-table batch slices
   mirror it. Note `run_points` goes from 8 binds to 9 with
   `altitude_accuracy`, which stales that comment's arithmetic. Instrumentation
   is dropped first, GPS points never.

### 6.3 Permission — the source must be `Pedometer`, not `Barometer`

`BarometerModule.swift` defines **only** `isAvailableAsync`,
`setUpdateInterval`, `OnStartObserving`, `OnStopObserving`, `OnDestroy` —
**neither permission function**. So `DeviceSensor.ts` falls through to
`defaultPermissionsResponse = { granted: true, … }`: `requestPermissionsAsync()`
shows **no prompt** and always resolves granted. `PedometerModule.swift` *does*
implement both, via `EXMotionPermissionRequester`, and CoreMotion has a single
Motion & Fitness authorization shared by `CMAltimeter` and `CMPedometer`. So the
port is backed by `Pedometer.requestPermissionsAsync()` /
`getPermissionsAsync()` — a module already needed for step counts.

**The prompt cannot be placed before the run starts.** It is triggered implicitly
inside `OnStartObserving` (an iOS 17.4+ workaround running
`CMSensorRecorder().recordAccelerometer(forDuration: 0.1)` when authorization is
`.notDetermined`), i.e. when the altimeter actually starts. And the run screen
mounts only *after* `runEngine.start()` (`session/[key].tsx:62` → `:67`), so
revision 1's "at run-screen mount, before the run" was impossible. Honest
statement: **the Motion & Fitness prompt appears once, at the first run's start.**
Requesting explicitly via `Pedometer` on the session screen *before*
`runEngine.start()` is what moves it out of the run itself.

`app.json` **must** gain the `expo-sensors` plugin entry with a written
`motionPermission` string. It has no plugin entry today, and the plugin is what
writes `NSMotionUsageDescription` — without which iOS **terminates the app** on
first altimeter use, directly contradicting §6.2.

Denial degrades silently: `start()` no-ops, no samples, the run unaffected —
ADR 0008 §5's rule applied to a second sensor. Promoting the ask to an onboarding
step belongs to the render slice, when there is a user-visible feature to justify
it.

## 7. The export

### 7.1 Format and precision

One `.txt` file: a JSON header line, then CSV sections. `.txt` because a
multi-section file is not valid CSV.

```
# runbro-export/1
{"schema":1,"exportedAt":"...","run":{...},"device":{...},"counts":{...}}

## segments
seq,kind,plannedDurationS,actualDurationS,distanceM,wasSkipped

## points
seq,at,lat,lng,altitudeM,accuracyM,altitudeAccuracyM,speedMps,segmentSeq

## altitude
seq,at,sensorTimestampS,pressureHpa,relativeAltitudeM,epoch,segmentSeq

## log
seq,at,kind,detailJson

## events
at,type
```

**Precision is load-bearing and therefore mandated, not left to taste:**

| rounding of `pressureHpa` | equivalent altitude quantum |
|---|---|
| none (`String(n)`, shortest round-trip) | exact |
| 2 dp | 0.08 m |
| **1 dp** | **0.83 m — comparable to the barometer's entire precision advantage over GPS** |
| 0 dp | 8.33 m — worse than GPS |

`toFixed` is **forbidden** for `pressureHpa`, `relativeAltitudeM`, `lat` and
`lng`. `Number.prototype.toString()` is shortest-round-trip and therefore
lossless, and `domain/run-export.ts`'s test asserts round-trip equality. A
well-intentioned `toFixed(1)` would otherwise silently cost the slice its
purpose.

**Parse invariants**, stated because they are load-bearing and unwritten
otherwise: `detailJson` is *always* `JSON.stringify` output and never
hand-assembled (so embedded newlines are escaped as `\n` and a `##` inside a
field cannot forge a section header); the header JSON is stringified without
indentation; the file ends with exactly one `\n`. The export test covers
`detailJson` containing `,`, `"`, `\n` and `##`.

The header carries device model, iOS version, app version, runtime/update id,
barometer availability, motion-permission status, timezone offset, per-section
row counts, and the drop counters. It does **not** carry a "requested update
interval": that would log a value provably without effect (§1).

`domain/run-export.ts` is a **pure** function from loaded rows to that string,
tested under `bun test`. All I/O lives in `services/run-export.ts`.

### 7.2 File lifecycle and privacy

Written to `Paths.cache` via `expo-file-system`'s `File` API, then
`Sharing.shareAsync(file.uri, { UTI: 'public.plain-text', mimeType: 'text/plain' })`
(no config plugin needed — `expo-sharing`'s plugin is for *incoming* shares).
Cache rather than documents: iOS may evict it, exports regenerate on demand, and
the app's footprint does not grow.

Two mechanics that would fail as revision 1 wrote them: **`file.create()` throws
when the file already exists**, and the filename is deterministic per run while
§2 promises re-export — so the second export of a run throws. Use
`create({ overwrite: true })` (or delete-if-exists). And `write()` is
**synchronous**; awaiting it is dead code.

Reads are synchronous on the JS thread (the house pattern —
`db/run-points.ts:8-15`). Reading ~1800 points plus samples and log rows and
building a multi-MB string blocks it, which is harmless from a finished run's
summary and **not** acceptable while a run is live. Constraint: the export is
unreachable while `status` is running or paused.

Filename: `runbro-<yyyymmdd-hhmm>-<short run id>.txt`.

**Every export contains the owner's home address, twice** — all runs start and
end at his house, so the first and last fixes are his front door at ~5 m
accuracy. A **gitignored `field-data/`** directory is added as the safe landing
place. Transfer by AirDrop or Save-to-Files, not Messages or Notes, which can
transform plain text.

### 7.3 Placement

A plain `Card` row at the bottom of the run summary, below `HealthStatusRow`,
following `health-status-row.tsx` as its template: title "Export run data",
subtitle carrying the counts (`1,284 GPS fixes · 412 altitude samples`). Per
ADR 0013 §2 the `testID` goes on the actually-tappable element — an
`Island.Button`, since the summary screen composes only.

Those counts are the **only** in-app confirmation that capture worked, checkable
before a 30-minute run's data is trusted. They must be read **imperatively**, not
via `useLiveQuery` — ADR 0004 §3 forbids reactive reads of `run_points`, and the
existing point read (`useRunTrack` → `loadRunFixes`) is deliberately imperative.

Works on any run, including pre-slice ones, which show an empty altitude section.

## 8. The capture protocol and the scoring function

Revision 1's plan — three runs stratified open sky / tree cover / long — measured
the wrong axis: that is **satellite visibility**, and the barometer does not see
satellites. The barometer's noise axes are temperature excursion, pocket vs hand
(a pocket is a semi-sealed compressible volume: fabric compression at footstrike
and body heat are both pressure artifacts), building envelopes, wind, weather
regime, and vertical range — all held constant or unspecified across those three.

### 8.0 Field-test capture mode — a prerequisite for every capture below

**No capture can be taken as a plan session**, and revision 2 missed this. Three
consequences, none reversible:

- **Coaching cues would fire** — at you, while you stand next to a table for
  fifteen minutes.
- **The training day would be marked complete**, because completion derives from
  recorded runs.
- **A permanent workout would be written to Apple Health.** `run-engine/index.ts:23`
  wraps persistence in `withHealthSync(dbRunPersistence, syncRunToHealth)`
  unconditionally, so every finish syncs.

And **the app has no delete-run UI**: `deletedAt` exists in the schema and
`runNotDeleted` filters on it, but nothing in `src/app` ever writes it. So a
polluting capture cannot be cleaned up afterwards. Captures 1 and 2 are not runs
at all, which makes borrowing a plan day for them incoherent as well as
destructive.

So a capture is a run with a different identity:

- **`sessionKey: 'field-test'`.** The column is plain text and no plan day claims
  that key, so the completion projection has nothing to mark. This is the whole
  mechanism — no new table, no new status.
- **One long single `walk` segment** (60 min), so there are no segment
  transitions to announce and nothing to skip.
- **Cues suppressed** and **Health sync skipped** for `field-test` runs. The
  Health gate goes where the wrapping happens — the composition root — keyed on
  the record's session key, since `withHealthSync` currently has no opt-out.
- **Visible in the Log, deliberately.** The export row lives on the run summary,
  so a hidden capture would be unreachable. It carries a distinct label so it
  cannot be misread as training.
- **Entry point: a plain Settings row gated on `EXPO_PUBLIC_FIELD_TEST`**, set in
  the `preview` profile only, so production never shows it. `__DEV__` cannot be
  used — the existing Settings → Developer section is gated on it
  (`settings/index.tsx:114`) and is therefore invisible in `preview`, which is a
  release build. The idiom to mirror is `EXPO_PUBLIC_E2E` / `isE2EBuild()`
  (`services/e2e.ts`): an env flag inlined by Metro at build time, read at call
  time, free of `__DEV__` so pure-TS `bun test` importers stay clean.

Verify, don't assume: `EXPO_PUBLIC_*` is a *bundle* input rather than a native
one, so adding an `env` block to the `preview` profile is expected not to move the
fingerprint. It is moot for the first build (which is a rebuild regardless), but
it matters for every OTA after it.

This is the only product surface the slice touches, and it is the minimum that
makes the captures takeable at all.

The runner-facing procedure — indoor versus outdoor, what to measure by hand,
what not to touch — lives in
[`docs/field-test-capture-protocol.md`](../../field-test-capture-protocol.md),
because it is followed on a phone in a stairwell, not read from a spec.

### 8.1 The captures

| # | Capture | What it uniquely answers | Cost |
|---|---|---|---|
| 1 | **Stationary, 15 min, phone flat on a table, run active** | jitter σ and drift against a *certain* zero; resamplable to n=50 | no running |
| 2 | **Stairwell, 5× up and down, riser measured with a tape** | the positive magnitude reference — the only term that punishes over-smoothing | ~10 min |
| 3 | **Genuinely flat closed loop, phone pocketed** | phantom gain under real running motion | one run |
| 4 | **Same route as #3, different day/weather** | run-to-run variance; the only repeatability estimate | one run |
| 5 | **Hilly closed loop with a deliberate 5 min pause and one screen-on stretch** | rebase-at-pause, ≥3 `lifecycle` rows, the gap distribution | one run |
| 6 | **One run phone-in-hand, otherwise matching #3** | isolates the pocket artifact | one run |

**1 and 2 are the two that unblock the tuning, and neither is a run.**

### 8.2 Every logged run is bracketed

90 s standing still at the doorstep at the start, and 90 s at the end — *inside*
the run, before pressing end, since §4.3 stops the altimeter at finalize. GPS
speed lets the analysis script find the stationary windows automatically. This is
what converts drift from a confound into a measured covariate (§2.1).

### 8.3 Sequence

1. **Build the export pipeline first, on the existing dev client** — no rebuild
   needed (§11), so the serializer, the share sheet and the summary row are
   verified before any native work.
2. One native `preview` build with the three new modules; install.
3. Grant Motion & Fitness at the first run's start (§6.3).
4. **Capture #1 doubles as the validation run** — export it, AirDrop it, verify
   the pipeline end-to-end here *before* trusting a real run to it. Its 15 minutes
   is why it can serve both purposes: at a 10 s cadence a 31-sample window needs
   310 s just to fill, so the 5-minute walk revision 1 proposed could have
   returned all-nulls and read as a bug.
5. Captures 2–6.
6. Analysis (§8.4), then the render slice.

### 8.4 What the analysis derives

Cadence distribution (both clocks, so sampling gaps separate from delivery gaps);
flat jitter σ from capture #1; drift per run from the doorstep brackets;
`pressureHpa` continuity across every `relativeAltitudeM` discontinuity; whether
sample gaps align with `fix_batch`/`tick` gaps or stand alone.

### 8.5 The scoring function

```
score(config) = |gain − truthGain| + |loss − truthLoss| + λ · phantomGain
```

where `truthGain`/`truthLoss` come from capture #2 (exact, tape-measured) and
capture #1 (exactly zero), and `phantomGain` from captures #1 and #3. Runs
**validate**; they do not score.

A regression test asserts the chosen config beats `{ medianWindow: 121,
hysteresisM: 60 }` — the degenerate config revision 1's score would have
selected — so the inversion cannot silently return.

`|gain − loss|` and `net == 0` are retained **only as drift diagnostics**, never
as tuning scores.

A zero-code cross-check: Apple Health's **Flights Climbed** for each run's
window. iOS computes it from the same barometer with Apple's own algorithm,
quantised at ~3.05 m — not independent of the sensor, but independent of our
reducer. (It cannot be logged: `floorsAscended` is not bridged by `expo-sensors`,
which resolves `PedometerResult` as `{ steps }` only.)

### 8.6 The deliverable may not be a `(medianWindow, hysteresisM)` pair

`elevationStep` reads only `sample.altitudeM`; `AltitudeSample.timestamp` exists
in the type and is **never used**. So a 5-minute gap sits inside the median
window as though it were 5 samples, and the window's real duration is unknown
until the cadence is measured (§1). If the cadence comes back irregular or slow,
the honest outcome is to change the *primitive* — a time-based window, or
resample-to-fixed-cadence then median. Both are pure `domain/` changes and
therefore OTA-shippable. Named here so the tuning session does not force a bad
pair rather than admit the primitive is wrong. The cadence histogram is an
explicit gating deliverable.

## 9. Testing

**`bun test`:**

- `domain/run-export.ts` — fixtures to exact expected string; float round-trip
  equality; the empty-altitude-section case; `detailJson` containing `,`, `"`,
  `\n`, `##`; exactly one trailing newline.
- `run-log.ts` — `seq` monotonic across drops, drop counters, buffer and batch
  caps.
- Engine tests with a **fake `ElevationSource`** (the fake `LocationTracker` to
  mirror is inline at `engine.test.ts:161`, *not* in `services/test-helpers.ts`,
  which exports only `fakeStorage`): readings reach `flush`; a throwing source
  cannot fail a flush; non-finite and `undefined` values never reach the buffer;
  `stop()` fires on both finalize and reset; a resumed run starts capture and its
  `seq`/`epoch` continue rather than restart.

**Dev client, before any rebuild:** the whole export path (§8.3.1).

**Simulator:** no barometer, so `isAvailable()` is false — the natural place to
verify the degraded paths: a run completes with zero samples, the export produces
a valid file with an empty altitude section, the share sheet opens. Note
`expo-battery` does **not** work on the simulator (physical iOS devices only), so
`battery` rows are device-only; §6.2's fire-and-forget covers their absence.

**Device:** the captures in §8.1 are the verification.

**E2E:** `complete-session.yaml` unaffected. The fingerprint change makes the next
`e2e-refresh` a full 15–20 minute rebuild rather than a ~1 minute repack.

## 10. Risks

| Risk | Mitigation |
|---|---|
| An instrumentation row aborts the GPS transaction | No composite PK on the new tables (§5.1); sanitize at buffer time; per-table batch caps |
| A resumed run captures nothing, or collides | Start in `restore()`; seed `seq`/`epoch` from stored max (§4.3, §5.1) |
| A silent altimeter rebase corrupts a whole run | Pressure continuity as primary detector; one permanent adapter listener; process token (§4.2) |
| A gap's cause is undeterminable | Both clocks, `fix_batch`, `tick`, drop counters (§4.1, §6.1) |
| Missing `NSMotionUsageDescription` terminates the app | `app.json` plugin entry with a written string, called out in §6.3 and §12 |
| The tuning returns a confident wrong answer | §8.5's scoring function plus the anti-degenerate regression test |
| First real run captures nothing, wasting a session | §8.3.4's validation capture; the summary row's counts as a pre-flight check |
| A capture pollutes the training record, Apple Health, or the plan — irreversibly, since there is no delete-run UI | Field-test capture mode: an unclaimed `sessionKey`, cues suppressed, Health sync skipped (§8.0) |
| Export leaks a home address into git | Gitignored `field-data/`; §7.2 |
| Export blocks the JS thread mid-run | Unreachable while a run is live (§7.2) |
| Barometer duty cycle costs battery | `CMAltimeter` is low-power and no new GPS duty cycle is added; `battery` rows make the cost measurable rather than argued |

## 11. Build and release mechanics

**Three** new native modules, not four: `expo-sensors`, `expo-sharing` and
`expo-battery`. **`expo-file-system` is already installed and linked** — it is a
dependency of the `expo` package itself (57.0.1, `ios/Podfile.lock:191`), so it
only needs promoting to a direct dependency.

That correction buys real sequencing: **the entire export pipeline can be built
and exercised on the current dev-client build with no rebuild** (§8.3.1).

The three genuinely new modules move the `@expo/fingerprint` hash, so **no OTA
can deliver this slice** — it needs one `eas build --profile preview`, installed
on the device. Everything after that is JS-only: the tuning constants, the
reducer, the render slice's chart all keep the same fingerprint, so
`eas update --branch preview` lands straight on the phone the owner runs with.
The expensive step happens exactly once, and this slice pays it.

`COREPACK_ENABLE_AUTO_PIN=0` for every Expo command; never commit a
`packageManager` field.

## 12. Every file this touches

Revision 1 named five of these. The rest are what a required-field change and a
new port actually reach:

**New:** `services/elevation/{port,adapter.ios,index,use-motion-permission}.ts`,
`services/run-engine/run-log.ts`, `domain/run-export.ts`,
`services/run-export.ts`, `components/run-export-row.tsx`,
`services/field-test.ts` (the flag plus the synthetic session — §8.0),
`components/field-test-row.tsx`, the generated migration, and
`docs/field-test-capture-protocol.md`.

**Modified:**

1. `app.json` — the `expo-sensors` plugin entry (**mandatory**, §6.3)
2. `package.json` — three new deps; `expo-file-system` promoted to direct
3. `.gitignore` — `field-data/`
4. `src/db/schema.ts` — two tables, three columns, the ADR 0004 exemption comment
5. `src/services/run-store/port.ts` — `flush()` grows samples + log arrays
6. `src/services/run-store/index.ts` — the transaction body and column mapper
7. `src/domain/geo.ts` — `LocationFix.altitudeAccuracy` (optional)
8. `src/services/location-tracker/adapter.ios.ts` — `toFix` reads
   `coords.altitudeAccuracy`
9. `src/services/run-engine/types.ts` — `BufferedRunPoint`, `CompletedRunRecord`
10. `src/db/save-run.ts` — writes the two new `runs` columns, on both paths
11. `src/db/run-points.ts` — `loadBufferedRunPoints` row mapper
12. `src/services/run-engine/resumable.ts` — `parseFix` tolerates snapshots
    lacking the new field
13. `src/services/run-engine/engine.ts` — wiring, `elevationOps`, `restore()`,
    `reset()`, drain condition (finalize-time entries must actually flush:
    `drainPendingPoints` currently loops only while `pendingPoints.length > 0`,
    so `pedometer` and tail entries would be dropped every run)
14. `src/services/run-engine/index.ts` — inject the port, subscribe
    `onFix`/`AppState`/battery, Motion retry
15. `src/app/runs/[runId]/index.tsx` — render `RunExportRow`
16. A sibling of `use-run-track.ts` — the imperative counts for §7.3
17. `eas.json` — `EXPO_PUBLIC_FIELD_TEST` in the `preview` profile (§8.0)
18. `src/app/(tabs)/settings/index.tsx` — the gated Field test row
19. `src/app/(tabs)/log/…` — the distinct label for `field-test` runs (§8.0)

## 13. Deferred to the render slice

- **The gap policy.** ADR 0015 requires that a total spanning a suspension gap be
  *declined* rather than under-reported, since `CMAltimeter` cannot backfill. The
  threshold stays undesigned deliberately: it should come from the observed gap
  distribution. This slice makes gaps visible; the next makes them policy.
- **`BAROMETER_ELEVATION_CONFIG`**, or a changed window primitive (§8.6).
- **Totals, the elevation line, the live trend readout**, and a promoted
  onboarding permission step.
- **Absolute altitude.** `CMAltimeter.startAbsoluteAltitudeUpdates` (iOS 15+)
  exposes per-sample `accuracy` *and* `precision`, unbridged by `expo-sensors`,
  and would feed `domain/elevation.ts` unchanged — softening ADR 0015's
  assumption that absolute elevation needs an off-device DEM. Excluded here
  because a local native module becomes a permanent fingerprint input, destroying
  the OTA tuning loop §11 buys. Note it is **change-driven**
  (*"whenever a change in elevation is detected"*), so §6.1's "silence means
  something stopped" reasoning would not transfer.

## 14. ADR impact

- **ADR 0015** — amend on completion: item 7's spike discharged by field data;
  item 5's columns land here as `run_altitude_samples`; record the measured
  cadence, that cadence is not tunable through `expo-sensors`, the epoch/pressure
  rebase finding, and the closure-error magnitudes from §2.1.
- **ADR 0003** — one new port (`ElevationSource`), the seventh.
  `services/run-export.ts` is deliberately **not** a port: ADR 0003's operative
  constraint is *containment* ("nothing outside `services/` may import…"), which a
  bare service satisfies. The honest precedents are `services/e2e.ts` and
  `active-plan.ts` (bare top-level services), not `health/open-health-app.ts`,
  which sits inside a directory that already has a port. Consequence to accept:
  the export is committed to a single cross-platform implementation with no
  platform fork.
- **ADR 0004** — additive, generated migration; the §5.1 exemption from §5's
  every-table rule is claimed explicitly, as `run_points` does.
- **ADR 0007** — the event log gains a persisted home at finalize.
  `ElevationState` is still **never snapshotted**.
- **ADR 0013** — `run-export-row.tsx` is a domain component at
  `src/components/` root binding a service, templated on
  `health-status-row.tsx`, with `testID` on the tappable element.
- **ADR 0021** — unaffected; the smoother is unchanged.

## 15. Review history

Revision 1 was reviewed by three adversaries with independent context and
disjoint mandates. Recorded because the findings were expensive to establish and
would otherwise be rediscovered:

**Fatal.** The scoring function was rank-inverted (§2.1's table). Revision 1
would have selected a config reporting zero elevation and scored it perfectly.

**Critical.** Composite PKs on the instrumentation tables would have aborted the
GPS transaction for the remainder of any crash-resumed run (§5.1).
`Barometer.requestPermissionsAsync()` is a hardcoded `granted: true` fake, so
`motion_permission` would have lied in the one field designed to explain its own
emptiness (§6.3). There was no aliveness trace at all, because CoreLocation
batches deliveries and stores fix-determination time (§6.1).

**Factual errors in revision 1, all verified from installed source:**
`BarometerMeasurement` *does* carry a monotonic `timestamp`, and
`relativeAltitude` is optional (§4.1). `setUpdateInterval` is an iOS no-op (§1).
The epoch cannot be implemented as described, because the altimeter starts and
stops on JS listener-count transitions (§4.2). `tracker.start()` is called in
`restore()`, not `resume()` (§4.3). `Pedometer.getStepCountAsync` takes `Date`
objects, not the ISO strings the schema stores (§6). `expo-file-system` was
already installed (§11). `file.create()` throws when the file exists (§7.2).
`altitudeAccuracy` is negative-when-invalid (§5.2). `services/test-helpers.ts`
has no fake tracker (§9). `smoothFix`'s velocity gate does not reject a point
(§6.1). The `~1800 fix_rejected` estimate was wrong by two orders of magnitude
(§5.4).

**Verified sound and not to be undone:** `BarometerModule` has **no**
`OnAppEntersBackground` hook, unlike `PedometerModule` — so pocketing the phone
does not rebase `relativeAltitude`, the design's biggest implicit bet.
`flushOnce` re-arms unconditionally, so samples land every 5 s even with zero GPS
fixes. The relative altimeter API is time-driven, so silence is evidence.
Logging `pressureHpa` alongside altitude is the single most valuable decision in
the design. `runs.event_log_json` is a real data-loss fix on its own merits. The
migration mechanics are clean, and the guard hook is not violated.
