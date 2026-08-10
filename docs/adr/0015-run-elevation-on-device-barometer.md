# 15. Run elevation: on-device barometer-first behind an Elevation port, network DEM excluded from the default

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0020](0020-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-13

## Status

Proposed — draft for review. Flip to `Accepted` on approval. Numbered 0015 because
0014 is taken by the in-flight text-first-Maestro-selectors ADR on another branch.
**Amended 2026-08-03** with measurements from the run-elevation-and-pace-chart
slice — see [Amendment (2026-08-03)](#amendment-2026-08-03). **Amended 2026-08-04**
with what the run-barometer-field-logging slice settled — see
[Amendment (2026-08-04)](#amendment-2026-08-04). **Amended 2026-08-06** with the
first real-hardware measurements, which close item 7 — see
[Amendment (2026-08-06)](#amendment-2026-08-06).

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
   **Closed 2026-08-06:** measured on device — delivery is unaffected by
   backgrounding, so the fallback is not needed. See
   [Amendment (2026-08-06)](#amendment-2026-08-06).

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
diagnostics recorded during a run, in the same database transaction as that
run's GPS points, exportable as one text file. **Elevation is still not
rendered anywhere** — `src/domain/elevation.ts` remains unconsumed.

**Every verification in that slice ran on the iOS simulator, which has no
barometer.** That proves the harness, not the sensor: the capture path was
driven end to end on the simulator (a capture starts, records, finalizes, is
labelled distinctly in the Log, and exports a file), and the sample buffering,
the shared flush transaction and the export format are covered by `bun test`.
What it cannot prove is anything only the hardware produces — **no real
barometer reading has ever been recorded by this app, and its delivery cadence
has never been measured.** The first real-hardware execution is the owner's
captures per [`docs/field-test-capture-protocol.md`](../field-test-capture-protocol.md).
What follows is what that slice settled, so it does not have to be rediscovered
when the render slice picks the tuning back up.

**Item 7's spike is superseded — by field logging, not a spike screen.** The
original plan (§7) was a throwaway screen exercising the barometer in isolation.
That was replaced with the opposite of a spike: instrumentation inside the real
app, capturing real runs. That is the stronger form of the same evidence,
because a spike held in the hand while looking at a screen measures none of the
conditions that decide whether background delivery works — pocketed, screen
locked, 30+ minutes, a phone that has been carried and jostled, real CoreMotion
hardware rather than a simulator that has none. **Item 7 nevertheless stays
open.** What the slice delivered is the harness to answer it, built and verified
on the simulator; it has never run on a device, so neither background delivery
nor cadence is answered yet. The answer is what
[`docs/field-test-capture-protocol.md`](../field-test-capture-protocol.md)'s
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
| `BarometerMeasurement` lacks a per-sample timestamp | It has one: `{ pressure: number; relativeAltitude?: number; timestamp: number }` — `timestamp` is `CMLogItem.timestamp`, CoreMotion's boot-relative monotonic clock, in seconds, always present. `relativeAltitude` is the one that's optional. Both facts matter for the same reason: this ADR's reducer (§4.2) was tuned and measured against 1 Hz GPS; at "every few seconds," a 31-sample median window spans **over two minutes** of wall-clock time, not the ~31 seconds the original tuning assumed — a figure that follows from `CMAltimeter`'s header wording, not from a measurement, since the real interval is one of the first things capture 1 produces. | `node_modules/expo-sensors/build/Barometer.d.ts` |

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

## Amendment (2026-08-06)

Written after the first two field captures on real hardware — an iPhone on iOS
26.5.2, two ordinary plan sessions of 31.5 and 28.8 minutes. Full analysis in
[the capture analysis](../superpowers/research/2026-08-06-barometer-field-capture-analysis.md);
per-capture metrics in [`docs/field-captures/`](../field-captures/).

**This supersedes the 2026-08-04 amendment's central caveat.** That amendment
recorded that "no real barometer reading has ever been recorded by this app, and
its delivery cadence has never been measured." Both are now false. It remains
correct about everything else, including that every verification *at that time*
ran on a simulator with no barometer.

**Item 7 is closed. Background delivery works, unchanged.** One capture spent
1688 s of its 1725 s backgrounded — pocketed, screen locked — across four
separate windows, and recorded **1585 altitude samples against 1586 expected:
99.9% of nominal cadence, with no gap ever exceeding 1.14 s.** The other capture
never left the foreground and shows the same cadence and the same zero gaps, so
the two regimes are measurably identical. `expo-sensors` keeps `CMAltimeter`
delivering under [ADR 0008](0008-background-execution-location-heartbeat.md)'s
When-In-Use heartbeat, and item 7's fallback — reconstructing gain from
foreground samples plus GPS — is not needed on this hardware. The heartbeat
carried both sensors: the `tick` row held a 5.02 s median throughout and
`fix_batch` receipt lag a 0.09 s median, so the JS thread was scheduled promptly
rather than catching up in bursts.

**The delivery cadence is ~1 Hz, not "every few seconds".** Measured at a
**1.065 s median with a 2 ms spread between the 5th and 95th percentiles**,
identical across both captures and both app states. `CMAltimeter.h`'s wording
and this ADR's own prose implied something four times sparser, and the
2026-08-04 amendment drew the consequence that a 31-sample median window "spans
over two minutes of wall-clock time." **It spans 33 s.** The reducer's
sample-counting window primitive therefore stands, and the field-logging spec's
§8.6 escape hatch — switching to a time-based window or resample-then-median —
does not need to fire. The render slice's deliverable can be an ordinary
`(medianWindow, hysteresisM)` pair after all.

**No rebase was observed, including across background transitions.** Zero
`relativeAltitudeM` discontinuities greater than 1 m in either capture, across
four background transitions. The corroborating evidence is stronger than the
jump count: `relativeAltitudeM` tracks `−ΔP / 0.12 hPa·m⁻¹` to within 0.18 m
over the full 28 m span of both runs, which no rebase can preserve. This
confirms on hardware what the previous amendment could only read from source —
`BarometerModule.swift` has no `OnAppEntersBackground` hook, so pocketing the
phone does not restart the altimeter. It also confirms the pressure-continuity
detector works, and establishes that `relativeAltitudeM` is a deterministic
transform of `pressureHpa` carrying no independent information; the redundancy
is the detector, and pressure is the primary series.

`epoch` behaved exactly as the previous amendment's model predicts: constant
within each run, and incremented by exactly one across two runs sharing a
`processToken` — one app process spanned both captures, twelve hours apart.

**Sensor noise is σ ≈ 0.9–1.9 cm per sample** (second-difference estimate;
a lower bound, since vertical body motion aliases into a 1 Hz series). Pressure
resolution is 0.00008 hPa, about 0.7 mm equivalent — quantisation is nowhere
near a limiting factor. Against GPS vertical error of ±10–25 m this is three
orders of magnitude better and settles this ADR's barometer-first premise as
measured rather than argued.

**The closure-error magnitudes in the previous amendment's table hold.**
Two geodetically closed loops (2.6 m and 9.2 m start-to-end) closed
barometrically to **−0.72 m and −2.04 m**, inside the predicted 1–3 m calm-day
band. The doorstep-bracket requirement is justified, not over-cautious. These
are drift diagnostics only — the field-logging spec §2.1 proves `|gain − loss|`
measures `hysteresisM` plus drift and carries no accuracy information, and both
captures reproduce that identity on real data.

**GPS `altitudeAccuracy` is better than the 2026-08-03 amendment could
simulate.** It is present and valid on every point of both runs, median 3.00 m,
p95 4.7–5.3 m — better than that amendment's optimistic ±10 m column. This does
not revive GPS altitude as a source (its raw span reads 76 m against the
barometer's 28 m on the same run), but it means the ±25 m regime describes a
worse world than this phone runs in, and any future GPS-fallback tuning should
be measured rather than inherited from those simulations.

**What is still open: the tuning itself.** Neither capture carries ground truth —
both are plan sessions with no stationary bracket, no tape-measured vertical and
no flat route — so no configuration can be scored yet. The protocol's captures 1
(stationary, a certain zero) and 2 (stairwell, an exact nonzero) remain the
blocking work, and item 5's gain/loss storage stays unwritten until they select a
configuration. What has changed is that the capture harness is now proven end to
end on real hardware, so taking them no longer risks discovering the instrument
was broken all along.

### Capture 1 (2026-08-07): the median window is the wrong instrument

The protocol's capture 1 — 54 minutes stationary on a desk, in `field-test` mode,
3052 samples with zero drops and zero gaps — was taken the following day and
changes what the reducer should be. Detail in
[the capture analysis](../superpowers/research/2026-08-06-barometer-field-capture-analysis.md#6a-capture-1-2026-08-07--and-the-finding-that-reframes-the-tuning).

**Per-sample white noise is σ = 0.0032 m — and it is not the problem.** After
removing a linear trend, the residual has sd 0.202 m and a 1.50 m peak-to-peak:
**63× the white component.** The error that survives is low-frequency wander, and
a median filter is a spike-rejector. Measured on this capture, widening the
window from *none* to 121 samples (129 s) reduces the residual only from 0.202 m
to 0.162 m — **a 20% gain for a two-minute window.**

`medianWindow` was sized in this ADR's §4 against GPS, whose error genuinely is
largely per-sample. On the barometer it is close to a free parameter, and should
be chosen for acceptable lag rather than for noise rejection. **This is the
field-logging spec's §8.6 escape hatch coming due — but for the opposite reason
to the one it named.** §8.6 expected a slow or irregular cadence to invalidate a
sample-counting window; the cadence is fine. What is actually wrong is that
median filtering targets a kind of noise this sensor does not have.

**Drift, not noise, is the dominant error — and hysteresis only postpones it.**
The stationary phone's barometer fell 5.05 m monotonically (9 of 9 five-minute
bins) as pressure rose 0.68 hPa/hour. Because `elevationStep` re-anchors on every
banked move, accumulated drift banks as soon as it exceeds `hysteresisM` and the
anchor follows it, so **a long enough run banks arbitrary drift at any
threshold**; the shipped `h10` reads 0.00 m on this capture only because the
total never reached 10 m. At `h3` the same capture fabricates 3.00 m of descent.

That reframes the remedy. Drift is slow and monotone, which makes it *separable*
in a way white noise is not: it can be estimated and subtracted. The protocol's
90-second doorstep brackets are what enable that, and this is a considerably
stronger argument for them than "a measured covariate" — they are the mechanism
that addresses the dominant error term. The render slice should treat drift
correction as part of the reducer's job rather than expecting a threshold to
absorb it.

**Generality caveat:** 0.68 hPa/hour is a brisk rise, so 5 m/hour is an
active-day figure and should be treated as a worst case until a second stationary
capture on a settled day bounds the calm end.

### Capture 2 (2026-08-07): the deliverable is not a `(window, hysteresis)` pair

The stairwell capture — 318 samples, `field-test` mode, a single 12-step flight
walked up and down **16 times** (the repetition count was not recorded but is
unambiguous in the trace: 32 clean legs, amplitude sd 7%) — settles the question
§8.6 of the field-logging spec left open.

**Every median window of 15 samples or more reports 0.00 m gain on sixteen
ascents of a real staircase**, including this ADR's shipped `w31 h10`:

| config | gain | loss |
|---|---|---|
| w1 h0 | 35.41 | 35.41 |
| w5 h1 | 18.67 | 18.03 |
| w15 h1 · w31 h3 · **w31 h10** · w61 h1 | **0.00** | **0.00** |

A stair leg takes ~9.3 samples, so a 15-sample window spans longer than a whole
leg: the median of any window centred on a peak already contains both adjoining
troughs and the oscillation is erased before hysteresis sees it.

**Taken with capture 1, this forecloses the parameter pair.** The two captures
impose incompatible requirements that no `medianWindow` reconciles:

| requirement | measured in | forces |
|---|---|---|
| See a ~2.1 m flight of stairs | capture 2 | `hysteresisM ≤ 1` |
| Reject 5 m of monotone weather drift | capture 1 | `hysteresisM ≥ 5` |

Widening the window does not mediate: capture 1 shows it buys ~20% of noise, and
capture 2 shows it destroys the terrain a small threshold exists to catch.

**So the render slice's deliverable is a changed primitive, not a tuned pair** —
the outcome the field-logging spec's §8.6 reserved, now forced by measurement.
The direction follows from drift being slow and monotone, therefore *separable*:
estimate and subtract it, then run a small hysteresis that can still see terrain.
Hysteresis was being asked to reject a monotone trend, which it structurally
cannot do — it re-anchors on every banked move, so it only postpones drift. This
also promotes the protocol's 90-second doorstep brackets from a diagnostic to the
mechanism the reducer depends on.

**A second finding: the sensor under-reads a fast climb by 21%, dynamically.**
The flight reads **2.103 m** by barometer (sd 0.152 m over 33 legs) against
**2.664 m** by tape. The ground truth stands — it is a *spiral* staircase, where
a 222 mm riser is ordinary, and 12 × 222 mm is a textbook storey height. Air
density does not explain the gap either: iOS's conversion comes out at
0.1191 hPa/m (the standard atmosphere, implying 14.4 °C), and for 2.664 m to have
produced the recorded 0.2505 hPa the stairwell air would need to be at **91 °C**.
The conversion is right; the pressure readings do not keep up.

The shortfall splits into ~0.143 m of sampling loss (the apex falls between
1.065 s samples) and ~0.417 m of lag, a first-order fit giving **τ ≈ 2 s** —
consistent with the observed duration/amplitude correlation (r = 0.63) and
plausible for `CMAltimeter`'s internal filtering.

If that holds, the error is confined to fast excursions: ~15% at this stairwell's
10 s legs, ~2% at 30 s, ~0.5% at 60 s. **Real running terrain would be
essentially unaffected, and this stairwell is a harsher magnitude test than any
run** — which matters because the spec's §8.5 uses capture 2 as `truthGain`, and
a 21%-attenuated reference would bias the sweep toward under-smoothing. It is a
one-point fit pending a settling capture (bottom/top/bottom brackets plus a few
quick reps, ~6 minutes), which measures τ directly and cancels drift.

This does not disturb the ordering above — 0.00 m is 0.00 m at any scale — but
item 5's stored totals should not be calibrated against capture 2 until that
settling capture lands.

### The settling capture (2026-08-10): lag confirmed; score against the signal, not the tape

The settling capture was taken, and an **air-to-air heat pump on the top floor
was running** — visible in the data as 0.46 m step changes between consecutive
samples and a top-bracket sd of 0.278 against 0.14–0.23 at the bottom.
Atmospheric pressure does not step; a cycling pump does. It contaminated exactly
the bracket the measurement depended on, so the estimator became the plateau
immediately adjacent to each transition instead:

| measurement | pace | height | % of 2.664 m |
|---|---|---|---|
| Descent, with dwell | ~11 s | 2.647 m | 99% |
| Ascent, with dwell | ~10.6 s | 2.360 m | 89% |
| Capture 2 legs | 9.9 s | 2.103 m | 79% |
| Quick reps | 7.4 s | 1.851 m | 69% |

**Monotone in dwell and pace — lag confirmed**, with the two dwelled measurements
bracketing the tape truth rather than falling short of it systematically.
**It is not a slow time constant, though:** on arrival the reading reaches its
value within ~2 s and holds it for 12 s at sd 0.018. The attenuation is that a
fast traverse *reverses before the reading completes*, not that the sensor takes
a minute to catch up. The exact figure stays unpinned because of the pump; a
repeat with it switched off would close that, and nothing depends on it.

**The consequence that matters is for scoring: a reducer cannot recover what the
sensor never recorded.** Scoring a configuration against the tape's 42.62 m
(16 × 2.664) would penalise it for instrument attenuation that no `medianWindow`
or `hysteresisM` affects. Capture 2's scoring target is therefore the
**barometric content** of the signal — 16 × 2.103 = **33.6 m** — with the gap to
the tape recorded separately as a known instrument limit.

**Real terrain is unaffected.** At 10.6 s the reading is already 89–99% complete,
and a hill is climbed over 30–120 s. The attenuation belongs to this stairwell
test, which sits near the sensor's response limit, not to the terrain the app
measures.

### Replication (six captures, 2026-08-05 → 2026-08-10)

Two further verification runs (`w4d2`, `w4d1`; 30.5 and 30.0 min) replicate every
instrument finding. Across all captures now recorded: **cadence 1.065 s with no
variation past the third decimal on six captures; ~100% delivery on three
backgrounded runs; zero rebases in any capture ever taken.** Their closures
(−1.36 m, −0.29 m) are far gentler than capture 1's −5.05 m over 54 minutes,
confirming that figure as an active-day worst case rather than the norm.

**Run-to-run repeatability is sd ≈ 0.4–0.6 m** over ~27 m of relief, now from
three independent same-route pairs (0.55, 0.58, 0.36 m) rather than one. That is
the honest precision a rendered total should be understood to carry.
