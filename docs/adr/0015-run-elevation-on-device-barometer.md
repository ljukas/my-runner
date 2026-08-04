# 15. Run elevation: on-device barometer-first behind an Elevation port, network DEM excluded from the default

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0020](0020-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-13

## Status

Proposed — draft for review. Flip to `Accepted` on approval. Numbered 0015 because
0014 is taken by the in-flight text-first-Maestro-selectors ADR on another branch.
**Amended 2026-08-03** with measurements from the run-elevation-and-pace-chart
slice — see [Amendment (2026-08-03)](#amendment-2026-08-03). **Amended 2026-08-04**
with what the run-barometer-field-logging slice settled — see
[Amendment (2026-08-04)](#amendment-2026-08-04).

## Context

Elevation is a candidate companion to the Stage 4 route map (ADR 0010): once a run
is recorded from GPS, showing how much the runner climbed is natural paid-app
parity. Before committing, the feature was researched through the feasibility and
local-first lenses — full evidence and citations in
[`docs/superpowers/research/2026-07-13-run-elevation-data.md`](../superpowers/research/2026-07-13-run-elevation-data.md).
The findings that constrain this decision:

- **The runner-meaningful metric is elevation *gain/loss* (a relative delta), not
  absolute altitude.** That distinction decides everything: a relative delta is
  available cheaply on-device; absolute elevation is not.
- **The device can produce gain/loss on its own.** `expo-sensors` `Barometer`
  gives `relativeAltitude` (metres) on iOS via CoreMotion `CMAltimeter`;
  `expo-location` gives GPS `altitude`. Both are first-party Expo modules already
  compatible with the stack — no custom native code, no new alpha dependency.
- **GPS altitude is too noisy to sum.** Smartphone vertical error is ~2× horizontal
  (~15–50 m); summing per-sample deltas systematically *inflates* cumulative gain.
  The barometer is imprecise in absolute terms (weather drift) but precise for
  *changes* (~1 m) — the right tool for gain/loss.
- **Barometer hardware is asymmetric.** Every iPhone since the iPhone 6 (2014) has
  one; on Android they are relatively rare, so the feature must feature-detect
  (`Barometer.isAvailableAsync()`) and fall back to GPS.
- **You cannot get elevation "from the map."** MapKit, expo-maps (alpha), and the
  Google Maps SDK expose terrain only as a *visual render* — there is no queryable
  per-coordinate elevation API on either platform.
- **Off-device sources conflict with the ethos or are infeasible.** Free keyless
  elevation APIs (Open-Meteo, OpenTopoData) are network-dependent, carry "no uptime
  guarantee", and impose attribution; the reliable ones (Google, Mapbox) require
  accounts, keys, and billing — against the no-backend/no-accounts line in
  `AGENTS.md`. Bundling a global DEM is infeasible (smallest usable is ~12 GB at
  90 m, tens–hundreds of GB at 30 m) and no React Native library reads one
  on-device.
- **Storage is additive.** `runs` today has only a `summary_polyline` placeholder
  (`src/db/schema.ts`); there is no elevation column and no `run_points` table yet,
  so adding elevation touches no existing data (ADR 0004).
- **Elevation is a platform-touching capability**, so ADR 0003 already dictates its
  shape: a port with per-platform adapters, pure math in `domain/`.

## Decision

**Capture elevation gain/loss on-device behind an `Elevation` port (ADR 0003),
barometer-first with a GPS-altitude fallback. Absolute elevation and every
network/DEM source are excluded from the default; a network DEM enrichment is
deferred as an explicit, opt-in future adapter only.** Accepted now to fix the
approach; implemented when elevation ships in/after Stage 4 (like ADR 0010's maps
decision, taken before Stage 4).

1. **What we capture:** per-run **elevation gain and loss** (relative deltas), not
   absolute altitude. This is the only metric reliably available on-device and the
   one runners care about.
2. **Source hierarchy, feature-detected at runtime:** iOS barometer
   (`relativeAltitude`) is primary; where `Barometer.isAvailableAsync()` is false
   (most Android), fall back to **smoothed** GPS altitude — never raw per-sample
   summing.
3. **Port & adapters (ADR 0003):** `services/elevation/port.ts` exposes a small,
   platform-free interface (shape TBD at build time, e.g.
   `isAvailable()` / `start()` / `stop()` / `onSample(cb)` yielding a running
   gain/loss, or a summary read at run end). `adapter.ios.ts` wraps
   `expo-sensors` + `expo-location`; `adapter.android.ts` lands with the Android
   pass. Nothing outside `services/` imports `expo-sensors`.
4. **Math lives in `domain/`:** converting samples to gain/loss and smoothing GPS
   altitude is a pure helper (e.g. `domain/elevation.ts`), unit-tested under
   `bun test` with fake samples — mirroring ADR 0010's `domain/geo.ts` camera-fit
   precedent and ADR 0003's testing split (fakes for logic, device verification for
   adapters).
5. **Storage (ADR 0004):** additive — an `elevation_gain_m` (and `elevation_loss_m`)
   summary on `runs`, and/or `altitude`/`pressure` columns on the future
   `run_points` table when it is designed. No change to existing rows.
6. **Network DEM excluded from the default, retained as a deferred option:** a
   future opt-in "absolute elevation profile" could add a network adapter behind the
   *same* port (Open-Meteo keyless, or OpenTopoData fallback), cached per area, and
   must degrade gracefully to on-device gain/loss when offline. It is not part of
   this decision and not on any default/offline path.
7. **Background behavior is a build-time gate:** whether the barometer keeps
   delivering updates during a locked-phone run under the ADR 0008 location
   heartbeat is unverified (the expo-sensors iOS module stops updates on
   background per its source). Implementation must verify this on-device
   (Milestone-style spike); if it cannot run backgrounded, gain is reconstructed
   from foreground samples plus the GPS fallback. The port hides which path won.

## Consequences

- **Fully local-first:** no account, no token, no backend, no third party — only
  first-party Expo modules. Unlike ADR 0010's react-native-maps fallback, this
  needs **no official-tooling exception**.
- **Relative-only in v1:** no absolute elevation-vs-sea-level profile. Accepted —
  gain/loss is the metric; the deferred DEM adapter reopens absolute elevation
  later without reshaping anything (a pure adapter swap behind the port, exactly the
  ADR 0003 flexibility).
- **Android quality varies** with hardware; the GPS fallback is the floor, and a
  future DEM enrichment would even it out if users ask for it.
- **The barometer background risk is contained** behind the port and a device
  verification gate — the decision to ship the on-device path requires that spike to
  pass, but needs no new architectural debate.
- **Cost:** one more port + adapter pair and a small `domain/` helper; the port must
  resist method bloat like the other five (ADR 0003).
- **Deferring costs nothing:** the ADR fixes the approach without forcing elevation
  to be built; if it is dropped, no data is stranded (nothing is written yet).

## Alternatives considered

- **GPS altitude as the primary source** — rejected: vertical noise (~15–50 m)
  inflates summed gain; usable only as a smoothed fallback where no barometer
  exists.
- **Elevation "from the map" (MapKit / expo-maps / Google Maps SDK)** — rejected:
  no per-coordinate terrain-elevation API exists on either platform; the SDKs render
  terrain, they don't return its height.
- **A network elevation API as the source** (Open-Meteo, OpenTopoData, USGS,
  Google, Mapbox) — rejected as default: network dependency and, for the reliable
  providers, accounts/keys/billing/attribution — against the local-first, no-accounts
  ethos. Kept only as a deferred, opt-in enrichment adapter behind the same port.
- **Bundled / offline global DEM** — rejected: ~12 GB (90 m) to hundreds of GB
  (30 m), orders of magnitude beyond a shippable app, and no React Native library
  reads a DEM on-device. Per-area tile caching is storage-small but needs a network
  fetch for each new area, so it is not truly offline and reintroduces an external
  dependency.
- **Defer elevation entirely** — viable and not precluded: this ADR fixes *how*
  elevation is captured if built, not *that* it must be. The build commitment
  remains a separate call.

## Amendment (2026-08-03)

Written during the run-elevation-and-pace-chart slice, which built the
source-agnostic reducer this ADR specifies (§4.2) and pointed it at GPS
altitude first, since GPS is what the app already records. This ADR asserted
GPS altitude is "too noisy to sum"; that assumption was **measured** rather
than trusted, over 1800-sample runs (30 min at 1 Hz), against the
[design spec](../superpowers/specs/2026-08-02-run-elevation-and-pace-chart-design.md)
§3.5 and §3.6.

**Every figure below was re-measured on 2026-08-03**, after the warm-up anchor
defect was fixed, over the **50 seeds** spec §9.2 now requires (the first pass
used 5, which passed on seed luck). The flat-ground fixture is the committed
`flatWithNoise` in `src/domain/elevation.test.ts`, so these are reproducible;
the real-climb column is from the original padded-ramp measurement and is not.

**§3.5 — the totals, by window/hysteresis setting:**

| Vertical noise | Window / hysteresis | Phantom gain on flat ground | Real 40 m climb (gain/loss) |
|---|---|---|---|
| ±10 m | 8 / 3 | **549.5 m** | 167 / 163 |
| ±10 m | 31 / 10 | 0.00 m | 41.5 / 31.5 |
| ±25 m | 31 / 10 | **92.5 m** | 83.7 / 69.3 |
| ±25 m | 61 / 30 | 0.00 m | 30.7 / **0.0** |

A window/hysteresis pair tuned to reject ±10 m open-sky noise (31/10) still
banks ~92 m of phantom gain once noise reaches ±25 m. Widening the window to
suppress *that* (61/30) reports **zero loss on a real 40 m descent** — the
setting that rejects bad-condition noise erases real terrain. There is no
single pair safe in both regimes, because the reducer has no way to know which
regime a given run is in.

**§3.6 — the line, which turned out to be the *unprotected* output.** The
hysteresis threshold above guards only the banked `gainM`/`lossM` totals;
`seriesM` (what a chart would draw) receives median smoothing and no threshold
at all:

| Ground truth | Span the line draws | Banked gain |
|---|---|---|
| Flat, ±5 m noise | 4.8 m (worst 5.7) | 0.00 m |
| Flat, ±10 m noise | **9.5 m** (worst 11.5) | 0.00 m |
| Flat, ±25 m noise | 23.8 m (worst 28.6) | 92.5 m |
| A real 20 m hill | 19.5 m | — |

The ±10 m row is the whole argument in one line. The banked total reports
**0.00 m — correctly, the ground is flat** — while the line drawn from the very
same samples carries 9.5 m of relief, about half a real 20 m hill and rendered
at full height by an auto-fitting y-axis. The *protected* output is honest
exactly where the *unprotected* one is not, so deferring the totals while
keeping the line would have shipped the more dishonest half. At ±25 m the
fabricated terrain (23.8 m) exceeds that real hill outright.

**Conclusion, stated plainly: no single window/threshold pair is safe across
noise regimes, for either the totals or the line.** This is why the slice
deferred elevation whole — line and totals together — to the barometer, a
source at ~1 m precision where the same reducer (§4.2) can be honest about
both. It is a direct vindication of this ADR's barometer-first decision, not a
reason to revisit it; what strained was the GPS-first *ordering* a later spec
proposed on top of it, never this decision.

**Item 5's columns** (`elevation_gain_m` / `elevation_loss_m` on `runs`, and
the per-point altitude/pressure columns on `run_points`) **move to the
barometer slice.** They are not cancelled — nothing GPS-derived was ever
trustworthy enough to store, so there is nothing to migrate away from.

**Item 7 stays open** — this slice produced no device evidence for background
barometer delivery — but new research narrows what "open" means. The
[Apple Watch companion research](../superpowers/research/2026-08-03-apple-watch-companion.md)
(findings C1–C4) reads `expo-sensors`' own iOS source and finds the premise
behind item 7 unsupported: `ios/BarometerModule.swift` has no
`OnAppEntersBackground` block at all. Only `PedometerModule.swift` pauses and
resumes on background/foreground transitions; the Barometer, Accelerometer,
Gyroscope and DeviceMotion modules do not, and the JS wrapper
(`src/DeviceSensor.ts`) adds no `AppState` handling of its own. So "the module
stops updates on background" — the blocker item 7 names — may simply not
exist; the open question narrows from *viability* to *device confirmation*
under ADR 0008's location heartbeat, plus the actual delivery cadence
(`CMAltimeter`'s header says "every few seconds", sparser than the 1 Hz this
ADR's reducer was tuned against).

That research also surfaces a hard constraint this ADR did not previously
carry: **`CMAltimeter` has no backfill API.** Unlike `CMPedometer`, which
replays accumulated activity after a background gap, the altimeter exposes no
history query of any kind. If the process is ever suspended mid-run, GPS
distance survives — points are already persisted — but altitude gained during
that window is gone permanently. The barometer slice must detect such a gap
and decline to report a total across it, rather than silently under-reporting
one.

## Amendment (2026-08-04)

Written at the close of the run-barometer-field-logging slice, which built the
capture path this ADR's item 7 called for — barometer readings and per-run
diagnostics recorded during a real run, on real hardware, written in the run's
own database transaction, exportable as one text file. **Elevation is still not
rendered anywhere** — `src/domain/elevation.ts` remains unconsumed. What follows
is what that slice settled, so it does not have to be rediscovered when the
render slice picks the tuning back up.

**Item 7's spike is discharged — by field logging, not a spike screen.** The
original plan (§7) was a throwaway screen exercising the barometer in isolation.
That was replaced with the opposite of a spike: instrumentation inside the real
app, capturing real runs. This is the stronger form of the same evidence,
because a spike held in the hand while looking at a screen measures none of the
conditions that decide whether background delivery works — pocketed, screen
locked, 30+ minutes, a phone that has been carried and jostled, real CoreMotion
hardware rather than a simulator that has none. Item 7 is closed as "the harness
to answer it exists and has been run on real hardware," not as "the answer is
known" — the answer is what [`docs/field-test-capture-protocol.md`](../field-test-capture-protocol.md)'s
captures will produce.

**Item 5's storage landed differently than either ADR text proposed.** Not
`elevation_gain_m`/`elevation_loss_m` summary columns on `runs` (this ADR's
original §5), and not per-point altitude/pressure columns folded into
`run_points` (the 2026-08-03 amendment's stated destination). Instead: a
dedicated `run_altitude_samples` table (`runId`, `seq`, `at`, `sensorTimestampS`,
`pressureHpa`, `relativeAltitudeM`, `epoch`, `segmentSeq`) plus a generic
`run_log` table (`runId`, `seq`, `at`, `kind`, `detailJson`) that also carries
lifecycle, sensor-availability, battery and drop-count entries — not an
elevation-specific table. Neither table has been given a gain/loss summary
column, on `runs` or anywhere else, **because no total is computed yet**: the
reducer this ADR specifies (§4.2) is not wired to this data. Storing a total
before the tuning exists would mean storing a number nobody has chosen.

**Three API facts, verified from installed `expo-sensors` source, each
contradicting what the docs and this ADR's own prose imply:**

| Claim | What's actually installed | Where verified |
|---|---|---|
| `Barometer` exposes permission checks | It doesn't. `BarometerModule.swift`'s `definition()` registers only `isAvailableAsync` and `setUpdateInterval` — no `getPermissionsAsync`/`requestPermissionsAsync`. `DeviceSensor.getPermissionsAsync()` falls back to a hardcoded `{ granted: true, canAskAgain: true, ... }` (`defaultPermissionsResponse`) whenever `this._nativeModule.getPermissionsAsync` is `undefined` — so `Barometer.getPermissionsAsync()` silently reports granted and **never prompts**. The real requester is `Pedometer`: `PedometerModule.swift` registers both `AsyncFunction("getPermissionsAsync")` and `AsyncFunction("requestPermissionsAsync")`, which is what actually surfaces the Motion & Fitness dialog. | `node_modules/expo-sensors/ios/BarometerModule.swift`, `ios/PedometerModule.swift`, `src/DeviceSensor.ts` |
| `setUpdateInterval` tunes delivery cadence | It's a no-op on iOS: `AsyncFunction("setUpdateInterval") { (_: Double) in /* Nothing we can do */ }`. `CMAltimeter` has no interval knob at all — cadence is whatever CoreMotion decides ("every few seconds", sparser than 1 Hz). This is a **hard constraint on the reducer's window sizing, not a tuning parameter available to the app.** | `node_modules/expo-sensors/ios/BarometerModule.swift` |
| `BarometerMeasurement` lacks a per-sample timestamp | It has one: `{ pressure: number; relativeAltitude?: number; timestamp: number }` — `timestamp` is `CMLogItem.timestamp`, CoreMotion's boot-relative monotonic clock, in seconds, always present. `relativeAltitude` is the one that's optional. Both facts matter for the same reason: this ADR's reducer (§4.2) was tuned and measured against 1 Hz GPS; at "every few seconds," a 31-sample median window spans **over two minutes** of wall-clock time, not the ~31 seconds the original tuning assumed. | `node_modules/expo-sensors/build/Barometer.d.ts` |

**The rebase detector is `pressureHpa` continuity, not the epoch counter.**
`adapter.ios.ts` maintains `epoch` as a JS module-scope counter, bumped only
inside the adapter's own `start()`/`stop()`. But `expo-sensors`' `OnStartObserving`/
`OnStopObserving` hooks — which actually start and stop `CMAltimeter`, and are
exactly where `relativeAltitude` rebases to a fresh zero reference — fire on
**native listener-count transitions** (0→1 starts it, 1→0 stops it), a mechanism
owned by Expo Modules Core's event-emitter runtime, not by the adapter calling
`start()`/`stop()` directly. A restart the adapter did not itself initiate — a
dev Fast Refresh re-subscribing, or any other code path that touches the native
listener count — rebases `relativeAltitude` while `epoch` stays exactly where it
was, because nothing ran the code that increments it. And across a process
death, the asymmetry runs the other way: `epoch` resets to its initial value in
the new process (it's a JS variable with no persistence), while barometric
pressure is a real atmospheric quantity that doesn't reset just because the app
did — so a genuine process boundary can show as pressure-continuous even though
the counter restarted. `epoch` is therefore a **corroborating hint** — it lines
up with a real rebase when the adapter's own lifecycle caused it — but the
authoritative signal is `pressureHpa` continuity across a `relativeAltitudeM`
discontinuity: physical pressure cannot jump at a sensor rebase, so a continuous
`pressureHpa` alongside a discontinuous `relativeAltitudeM` at the same `seq` is
what actually proves "the reference reset here," independent of which JS code
path caused it or whether it crossed a process boundary.

**The closure-error magnitudes, and why a horizontally closed loop is not
barometrically closed.** Every capture in the field-test protocol starts and
ends at the same doorstep, so GPS reports `net displacement ≈ 0`. That does
**not** mean the barometer reads the same pressure at both ends — per the design
spec's [§2.1](../superpowers/specs/2026-08-03-run-barometer-field-logging-design.md#21-the-closed-loop-measures-drift-not-tuning--corrected):

| Source | Magnitude over a 30-minute run |
|---|---|
| Synoptic weather drift | 0.4–2.1 m calm, 4.2–8.3 m active, ~12.5 m across a frontal passage |
| MEMS thermal drift (warm house → cold street → pocket rewarming) | 1.0–2.5 m, monotone during warm-up — mimics a slow climb exactly where the median window is still filling |
| Indoor↔outdoor envelope ΔP (HVAC, wind stack effect) | 0.4–2.1 m |
| Vertical position at the doorstep (a flight up/down before starting) | ~3 m per storey |

Realistic closure error is **1–3 m on a calm day, 5–15 m on an active one** —
against a candidate `hysteresisM` of 1–3 m, i.e. the very parameter being chosen
is 1–5× smaller than the noise the "closed loop" was meant to cancel. A perfect
`gain == loss` invariant is not achievable and must not be treated as a
correctness signal. This is exactly why the protocol mandates a 90-second
stationary bracket at both the start and the end of every logged run, *inside*
the run: it converts drift from an unmeasurable confound into a measured,
subtractable covariate, rather than asking the loop to close on its own.

**One permanent limit, not fixable by more logging:** the export cannot
distinguish "the JS thread was busy" from "the process was OS-suspended." Both
produce an identical signature — a gap in delivered samples with no error, no
event, nothing to log — because a thread cannot observe its own
non-scheduling: the code that would write "I was blocked" cannot run while it
is blocked. Any future analysis of a delivery gap has to treat these two causes
as indistinguishable from the data alone.
