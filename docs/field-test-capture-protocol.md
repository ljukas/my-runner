# Field-test capture protocol — barometer elevation

The barometer's tuning cannot be chosen from a desk. `ElevationConfig`'s
`medianWindow` / `hysteresisM` depend on the delivery cadence, the flat-ground
jitter and the drift magnitude of real `CMAltimeter` hardware, none of which the
simulator has and none of which is documented. This is that measurement.

Design: [2026-08-03 barometer field-logging spec](superpowers/specs/2026-08-03-run-barometer-field-logging-design.md).
Decision it serves: [ADR 0015](adr/0015-run-elevation-on-device-barometer.md),
whose open item 7 this discharges.

**None of these captures is a training session.** Take every one of them in
**Field test capture** mode (Settings → Field test), never by starting a plan
day. A plan session would fire coaching cues at you while you stand next to a
table, mark that training day complete, and write a permanent workout into Apple
Health — and the app has no way to delete a run afterwards.

---

## Pre-flight, once

- [ ] A `preview` build carrying the barometer slice is installed
      (`eas build -p ios -e preview`). The dev client will not do: this must be
      the app you actually run with.
- [ ] **Motion & Fitness** granted. The prompt appears at the first run's start.
      Check Settings → Privacy & Security → Motion & Fitness.
- [ ] Location: *While Using the App*, Precise Location **ON**.
- [ ] **Low Power Mode OFF** for every capture — it throttles background work and
      would make a delivery gap unattributable.
- [ ] Battery ≥ 60 %.
- [ ] A tape measure (millimetres) for capture 2.
- [ ] Somewhere to note things by hand — the table at the bottom of this file, or
      anything you can transcribe later.

After **every** capture: export it (run summary → **Export run data**), AirDrop
it to the Mac, drop it in `field-data/` (gitignored — these files contain your
home address), and fill in one row of the log table.

---

## The two that unblock everything, and neither is a run

Captures 1 and 2 are what make the tuning decidable at all: 1 is a *certain*
zero, 2 is a *certain* nonzero. Without 2 in particular, nothing in the scoring
punishes over-smoothing, and the sweep would happily choose a configuration that
reports zero elevation forever (spec §2.1). Take these two first, and **in this
order** — capture 1 measures the delivery cadence, and the cadence is what tells
you how long capture 2 has to be.

### Capture 1 — Stationary · **indoors** · 40–45 min · no walking

Ground truth: exactly 0 m gain, 0 m loss. Also the only clean read of
sensor jitter, and a long pure-noise record that can be resampled to the 50 seeds
this repo's measurement discipline requires.

- [ ] Phone **flat on a table**, screen up, and **do not touch it** for the full
      40–45 minutes. No picking it up to check.
- [ ] Pick a room with a **stable envelope**: interior room, no open window, away
      from an HVAC vent or a fan, and **no one opening exterior doors**. Building
      pressure differentials are worth up to ~2 m of apparent altitude, which is
      the size of the parameter being measured.
- [ ] Do not move between rooms or floors before or after — start and end the
      capture in the same place the phone is sitting.
- [ ] 40 minutes is the minimum, not a target. Longer is strictly better, up to
      the ceiling below.
- [ ] **Read the sample count before you leave the room.** End the capture, and
      on the summary that appears read the **altitude-sample count** — do not wait
      until you are at the Mac. This capture is 40+ minutes indoors with the
      screen locked, and the app stays alive only through ADR 0008's When-In-Use
      location keepalive: a GPS mechanism being asked to work indoors on poor
      reception. If it drops, the capture returns near-nothing — and this is also
      the capture that validates the whole pipeline, so one silent failure costs
      both. A count in the low tens after 40 minutes means the keepalive died;
      retake it, closer to a window. Catching that in the room costs one retake;
      catching it at the Mac costs the afternoon.
- [ ] Record: start time, room, and roughly the indoor temperature.
- [ ] **Also write down the sample count and the capture's wall-clock length.**
      Their ratio is the first cadence estimate, and capture 2 is sized from it.

Why 40 and not 5: at a 10 s delivery cadence a 31-sample median window needs
310 s just to *fill*. A 5-minute capture could return nothing but nulls and read
as a bug rather than a result. And 40 costs nothing here — the phone is on a
table — while quadrupling the noise record, which matters because the analysis
resamples this one capture to 50 seeds and ~90 samples would make that a heavily
overlapping bootstrap of barely-independent draws.

**The ceiling is 60 minutes.** `fieldTestSession()` is a single 3600 s segment, so
a capture auto-completes at one hour whether you are ready or not. 40–45 leaves
room to notice and act; do not aim at 59.

**Also do this during capture 1.** Three native-adapter behaviours were left to
device verification rather than a mocked-SDK unit test (ADR 0003 item 7 forbids
mocking Expo SDK internals to test an adapter) and have never run against real
hardware. Two of the three are checkable from the export; the third genuinely
isn't:

- [ ] **`epoch` stays at exactly one value for the whole capture.** Open the
      export's `## altitude` section and check every row's `epoch` column is
      identical from the first sample to the last. `epoch` only changes when
      the adapter's `start()` actually (re)registers the native listener, and
      nothing in this app calls `start()` a second time while a run is already
      active — so a constant `epoch` is the expected signature of "a stray
      double-`start()` never silently re-armed the sensor mid-run." This can't
      *prove* the idempotence guard is correct (ordinary use never re-enters
      `start()` to trigger it), but a jump partway through one capture would
      prove it broken.
- [ ] **`epoch` goes up by exactly one across two captures taken in the same
      app launch.** If convenient, take a second, short field-test capture
      immediately after this one — *without force-quitting the app in
      between* — even a one-minute stationary capture is enough. Compare the
      two exports: the second one's `epoch` column should read exactly one
      higher than the first's, throughout. (Force-quitting between captures
      does not test this — a fresh process resets `epoch` to its initial
      value instead, a different fact recorded in
      [ADR 0015's 2026-08-04 amendment](adr/0015-run-elevation-on-device-barometer.md#amendment-2026-08-04).)
- [ ] **Not checkable from any export — recorded here so it isn't forgotten.**
      Whether unsubscribing the last JS listener leaves the native barometer
      running cannot be observed this way: the app's run engine subscribes to
      altitude readings exactly once, for its own lifetime, and never
      unsubscribes, so no capture can ever exercise that code path. Confirming
      it needs a dev-tool check instead — during a Metro-connected debug
      session, call the unsubscribe function `elevationSource.onReading()`
      returns, then confirm altitude readings are still arriving afterward.
      That's a future dev-time task, not part of this capture protocol.

### Capture 2 — Stairwell · **indoors** · sized in *samples*, not minutes · the magnitude reference

Ground truth: `steps × riser height`, exact to the centimetre. This is the only
capture that tells us whether a configuration can still *see* real terrain — the
single nonzero truth in the scoring function (spec §8.5), and the one capture
nothing else can substitute for.

**Take capture 1 first, and let its result size this one.** The reducer emits
*nothing* until its median window fills, and the fill time is measured in
samples, not seconds. At a 10 s cadence a 31-sample window does not produce its
first output until t+310 s — which, in a 10-minute capture, is over half the
recording, covering the stationary bracket and the first two repetitions. Its
measured gain would come back at roughly half the truth, and the sweep would then
penalise `w31` for **warm-up truncation** while reading it as over-smoothing —
the exact confusion §2.1 was rewritten to eliminate. So:

- [ ] From capture 1's export, compute the **median inter-sample interval** (the
      `at` column's consecutive differences in the `## altitude` section).
- [ ] Size capture 2 to at least **5× the widest candidate window** in samples —
      with 121 as the widest config in the sweep's grid, that is ≥605 samples,
      and at the median interval you just measured it converts to a duration.
      Whatever that number is, it is longer than ten minutes at any plausible
      cadence.

Then, in the stairwell:

- [ ] **Measure one riser with the tape**, in millimetres — the vertical face of a
      single step. Write it down. Do not estimate it, and do not use "about
      3 metres a floor".
- [ ] Count the steps in one flight, and the flights per repetition.
- [ ] Walk **at least 10 repetitions**: all the way up, all the way down, at a
      steady pace. Do not skip steps and do not take the lift for the descent.
- [ ] **The capture is not done until its altitude-sample count reads ≥150.** That
      count is on the summary, which only exists once the run finalizes, so it
      cannot gate the last repetition — overshoot the repetitions deliberately,
      end, then read it. Under 150 and this capture cannot serve as the magnitude
      reference: **retake it with more repetitions**, do not append a second one
      (a second capture is a separate run against a fresh altimeter reference, so
      the two do not concatenate). 150 is the floor below which the widest windows
      have nothing left after warm-up; if capture 1's cadence puts 5× the widest
      window above 150, that larger number wins.
- [ ] Use an **ordinary internal stairwell**. Avoid a fire-escape stairwell —
      those are often mechanically pressurised, which is exactly the artifact we
      cannot separate from terrain. If any door was propped open, note it.
- [ ] Stand still 60 s at the bottom before starting up, and 60 s at the bottom
      after finishing, inside the capture.
- [ ] Record: riser height in mm, steps per flight, flights per repetition,
      repetitions completed.

---

## The runs · all **outdoors** · all closed loops

Every one of these starts and finishes at your front door, which is what makes
`net displacement == 0` true geodetically. Note that this does **not** make the
barometer's reading close — weather and thermal drift are worth 1–3 m on a calm
day and 5–15 m on an active one, which is why the doorstep brackets below are not
optional.

### Every run, without exception

- [ ] **Stand still for 90 s at the doorstep before you start moving** — with the
      run already started.
- [ ] **Stand still for 90 s at the doorstep when you get back, before you press
      end.** The altimeter stops the moment the run finalizes, so a bracket taken
      afterwards records nothing.
- [ ] Note the weather: temperature, and whether pressure is rising, falling or
      steady (any weather app shows the trend). A frontal passage is worth ~12 m
      of apparent altitude — it does not spoil the capture, but it must be known.
- [ ] Note where the phone was: **which pocket**, or in the hand.
- [ ] Afterwards, open **Apple Health → Flights Climbed** for the run's window and
      write the number down. iOS computes it from the same barometer with Apple's
      own algorithm, so it is not an independent sensor — but it is independent of
      *our* reducer, and it brackets the answer.

### Capture 3 — Flat closed loop · phone pocketed

The phantom-gain test under real running motion. Pick the **flattest** route you
have; the flatter the better, because the ground truth here is "approximately
nothing" and any real terrain weakens it.

### Capture 4 — Capture 3 again · different day, different weather

Same route, same pocket, same everything — only the day changes. This is the
**only** repeatability estimate available, and it is what tells us whether a
tuning generalises or was fitted to one afternoon.

### Capture 5 — Hilly closed loop · with a deliberate pause and a screen-on stretch

The route with the most climb you have. Two things to do mid-run:

- [ ] **Pause the run for a full 5 minutes** somewhere, standing still, then
      resume. This is the rebase test: pause is where a silent altimeter reset
      would hide.
- [ ] For about 2 minutes, take the phone out and **look at the screen** while
      moving, then pocket it again. That produces the foreground/background
      transitions that make the background-delivery question answerable.

### Capture 6 — Capture 3's route again · phone in the hand

Everything matching capture 3 except the phone stays in your hand the whole way.
A pocket is a semi-sealed compressible volume — fabric compression at footstrike
and body heat are both real pressure artifacts, and this is the only capture that
isolates them.

---

## Reading the exports: three things that lie if taken at face value

The first two are raw sensor values the app deliberately does not clean up,
because a clamped invalid reading is indistinguishable from a real one.

- **A negative `speedMps` means "unknown", not "moving backwards".**
  CoreLocation reports a negative `speed` whenever it cannot determine one, the
  same way it reports a negative `altitudeAccuracyM` for an invalid altitude. The
  doorstep brackets above are found by looking for the 90-second stationary
  windows, so a filter like `abs(speedMps) < 0.5` would classify a
  perfectly-still sample reporting `-1` as moving and lose the bracket. Treat
  `speedMps < 0` as missing, and locate the brackets from **lat/lng displacement
  between consecutive points** instead.
- **`anySamplesRecorded: false` in the header does not mean "no barometer".** It
  means this run recorded no altitude sample, for any reason — including denied
  Motion & Fitness. The run's real hardware answer is its `sensor` row in the
  `## log` section, which carries `available`, `permission` and a process token.
  Check that row before concluding a capture is unusable.
- **A `kind` in the `## log` section does not imply one payload shape.** The
  engine writes log rows through a single generic `note(kind, detail)` — there is
  no per-kind type, so `detailJson`'s keys are whatever the call site passed.
  Two kinds already carry two shapes each: `battery` is `{ level, lowPowerMode }`
  once at start and `{ lowPowerMode }` on every change after, and `pedometer` is
  `{ steps }` normally but `{ steps: null, timedOut: true }` when the read stalled.
  Parse defensively per row; do not assume a kind's first row defines its schema.

## What "done" looks like

Six exported files in `field-data/`, the log table below filled in, and the
hand-measured numbers from captures 1 and 2 recorded. The analysis then derives
the delivery-cadence distribution, jitter, per-run drift, and the rebase check —
and scores the configuration grid against captures 1 and 2 as ground truth
(spec §8.5). Only then does the render slice get a number.

Take captures 1 and 2 first, in that order — capture 1's measured cadence is what
sizes capture 2 — and expect roughly two hours indoors across the two. They are
the ones the whole exercise rests on.

## Log

| # | Capture | Date | Weather / temp | Phone | Export filename | Flights Climbed | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Stationary 40–45 min | | indoor temp: | on table | | — | room: __ · samples: __ · minutes: __ · median interval: __ s |
| 2 | Stairwell ≥10× | | — | in hand | | | riser: __ mm · steps/flight: __ · flights/rep: __ · reps: __ · samples: __ (≥150) |
| 3 | Flat loop, pocket | | | pocket: | | | |
| 4 | Flat loop, repeat | | | pocket: | | | |
| 5 | Hilly loop + pause | | | pocket: | | | pause: __ min |
| 6 | Flat loop, in hand | | | hand | | | |
