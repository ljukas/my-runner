# Field-test capture protocol — barometer elevation

The barometer's tuning cannot be chosen from a desk. `ElevationConfig`'s
`medianWindow` / `hysteresisM` depend on the flat-ground jitter and the drift
magnitude of real `CMAltimeter` hardware, neither of which the simulator has and
neither of which is documented. This is that measurement. (The third unknown the
tuning rests on — the delivery cadence — was measured on 2026-08-06 without these
captures; see immediately below.)

Design: [2026-08-03 barometer field-logging spec](superpowers/specs/2026-08-03-run-barometer-field-logging-design.md).
Decision it serves: [ADR 0015](adr/0015-run-elevation-on-device-barometer.md). Its
open item 7 — whether the barometer keeps delivering on a locked phone — **was
closed on 2026-08-06** by two ordinary training runs, not by these captures. What
is left, and all these captures are now for, is the **tuning**: `medianWindow` and
`hysteresisM`.

**The harness is proven, and two things below are now measured rather than
guessed** ([capture analysis](superpowers/research/2026-08-06-barometer-field-capture-analysis.md)):

- **Delivery cadence is 1.065 s (~0.94 Hz)** — four times denser than
  `CMAltimeter`'s documented "every few seconds". This sizes capture 2 directly, so
  capture 1 no longer gates it.
- **Delivery is unaffected by backgrounding** — 99.9% of nominal cadence across 28
  minutes pocketed, no gap over 1.14 s, no rebase. The keepalive worry in capture 1
  below is now a sanity check, not an open risk.

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
home address), and fill in one row of the log table. Then run the analyzer, which
checks the capture is complete and usable and writes its committable metrics:

```sh
bun scripts/analyze-field-capture.ts field-data/<export>.txt --json docs/field-captures
```

It prints the sample count, cadence, gaps, `epoch` values and rebase count — so a
capture that failed is caught at the Mac in seconds rather than at analysis time.

---

## The two that unblock everything, and neither is a run

Captures 1 and 2 are what make the tuning decidable at all: 1 is a *certain*
zero, 2 is a *certain* nonzero. Without 2 in particular, nothing in the scoring
punishes over-smoothing, and the sweep would happily choose a configuration that
reports zero elevation forever (spec §2.1) — a failure the 2026-08-06 validation
runs reproduced on real data, where `w61 h30` and `w121 h60` both reported 0.00 m
of gain and loss on a run containing 28 m of real relief.

**Capture 1 is done (2026-08-07). Capture 2 is the one thing still blocking the
tuning** — and capture 1 sharpened why it cannot be skipped: scored on its own,
capture 1 is minimised by a reducer that reports nothing at all, so a sweep
against it *alone* would pick the degenerate configuration outright. The
stairwell's exact nonzero is the only term pulling the other way.

### ~~Capture 1~~ — **TAKEN 2026-08-07.** Stationary · **indoors** · 40–45 min · no walking

> **Done, and it is a keeper** — 54.2 min, 3052 samples, zero drops, zero gaps.
> Keep this section for the retake case below. Two results from it are recorded in
> [ADR 0015](adr/0015-run-elevation-on-device-barometer.md#capture-1-2026-08-07-the-median-window-is-the-wrong-instrument):
> the sensor's white noise is 3.2 mm and the **median window buys almost nothing**,
> while the real error is **−5.05 m of monotone weather drift** over the capture.
>
> **Worth one retake on a settled day, eventually.** 0.68 hPa/hour is a brisk
> pressure rise, so the drift figure is an active-day worst case. A calm-day
> stationary capture would bound the other end. Not blocking — capture 2 is.
>
> When analysing it, pass `--zero-truth`: GPS cannot tell that a phone was
> stationary, and this one accumulated 858 m of indoor jitter while never leaving
> a 16.8 m radius.

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
      reception. If it drops, the capture returns near-nothing. **At the measured
      1.065 s cadence, 40 minutes is ~2250 samples and 45 minutes is ~2535** — so
      you know what a healthy count looks like before you read it. Anything in the
      low tens means the keepalive died; retake it, closer to a window. Catching
      that in the room costs one retake; catching it at the Mac costs the
      afternoon. (Outdoors this mechanism is now measured at 99.9% delivery across
      28 backgrounded minutes; indoors on poor reception is the untested case, and
      the only reason this check survives.)
- [ ] Record: start time, room, and roughly the indoor temperature.
- [ ] **Also write down the sample count and the capture's wall-clock length.**
      Their ratio should reproduce the 1.065 s cadence. A materially different
      number is itself a finding — it would mean the cadence is not the hardware
      constant the two validation runs suggest, and the window arithmetic
      everywhere below would need redoing.

Why 40 and not 5: at a 10 s delivery cadence a 31-sample median window needs
310 s just to *fill*. A 5-minute capture could return nothing but nulls and read
as a bug rather than a result. And 40 costs nothing here — the phone is on a
table — while quadrupling the noise record, which matters because the analysis
resamples this one capture to 50 seeds and ~90 samples would make that a heavily
overlapping bootstrap of barely-independent draws.

**The ceiling is 60 minutes.** `fieldTestSession()` is a single 3600 s segment, so
a capture auto-completes at one hour whether you are ready or not. 40–45 leaves
room to notice and act; do not aim at 59.

**Three native-adapter behaviours were left to device verification** rather than a
mocked-SDK unit test (ADR 0003 item 7 forbids mocking Expo SDK internals to test an
adapter). **Two of the three were discharged on 2026-08-06** by the validation runs,
and need nothing from you here — the analyzer re-checks both on every capture
anyway, so a regression would surface without being looked for:

- [x] ~~**`epoch` stays at exactly one value for the whole capture.**~~ **Verified.**
      Both validation runs carry a single `epoch` throughout (`[1]` and `[2]`). A
      constant `epoch` is the signature of "a stray double-`start()` never silently
      re-armed the sensor mid-run"; it can't *prove* the idempotence guard correct,
      since ordinary use never re-enters `start()`, but a mid-capture jump would
      have proved it broken. The analyzer reports `epochs` per capture.
- [x] ~~**`epoch` goes up by exactly one across two captures in one app launch.**~~
      **Verified, incidentally.** The two validation runs share an identical
      `processToken`, whose `Date.now()` prefix decodes to seven seconds before the
      first one started — so one process spanned both, twelve hours apart — and
      `epoch` reads 1 then 2. No second short capture is needed. (Force-quitting
      between captures would not have tested this: a fresh process resets `epoch`
      to its initial value instead, per
      [ADR 0015's 2026-08-04 amendment](adr/0015-run-elevation-on-device-barometer.md#amendment-2026-08-04).)
- [ ] **Still open. Not checkable from any export — recorded here so it isn't forgotten.**
      Whether unsubscribing the last JS listener leaves the native barometer
      running cannot be observed this way: the app's run engine subscribes to
      altitude readings exactly once, for its own lifetime, and never
      unsubscribes, so no capture can ever exercise that code path. Confirming
      it needs a dev-tool check instead — during a Metro-connected debug
      session, call the unsubscribe function `elevationSource.onReading()`
      returns, then confirm altitude readings are still arriving afterward.
      That's a future dev-time task, not part of this capture protocol.

### Capture 2 — Stairwell · **indoors** · ≥11 min of repetitions · the magnitude reference

Ground truth: `steps × riser height`, exact to the centimetre. This is the only
capture that tells us whether a configuration can still *see* real terrain — the
single nonzero truth in the scoring function (spec §8.5), and the one capture
nothing else can substitute for.

**Sizing, now that the cadence is measured.** The reducer emits *nothing* until
its median window fills, and the fill time is counted in samples, not seconds. The
requirement is **5× the widest candidate window** — 121 is the widest config in the
sweep's grid, so **≥605 samples**, which at the measured 1.065 s cadence is:

> **≥ 645 s ≈ 11 minutes of continuous repetitions**, plus the two 60-second
> brackets below. Call it 13 minutes inside the capture.

This was the one number capture 1 was supposed to produce before capture 2 could
be taken; it no longer is. The measured cadence also shrinks the hazard that drove
the rule: at 1.065 s a 121-sample window fills in 129 s rather than the 1210 s a
10 s cadence would have needed, so warm-up truncation eats a small opening slice
rather than half the recording. The 5× margin stays anyway — it is cheap here, and
it is what keeps the sweep from penalising a wide window for **warm-up truncation**
while reading it as over-smoothing, the exact confusion spec §2.1 was rewritten to
eliminate.

Then, in the stairwell:

- [ ] **Measure one riser with the tape**, in millimetres — the vertical face of a
      single step. Write it down. Do not estimate it, and do not use "about
      3 metres a floor".
- [ ] Count the steps in one flight, and the flights per repetition.
- [ ] Walk **at least 10 repetitions, and keep going until 11 minutes of
      repetitions have passed** — whichever is more. All the way up, all the way
      down, at a steady pace. Do not skip steps and do not take the lift for the
      descent. The duration is the binding constraint, not the rep count: the
      ground truth is `reps × steps × riser`, so extra reps cost nothing but need
      counting.
- [ ] **The capture is not done until its altitude-sample count reads ≥605.** That
      count is on the summary, which only exists once the run finalizes, so it
      cannot gate the last repetition — overshoot the repetitions deliberately,
      end, then read it. Under 605 and this capture cannot serve as the magnitude
      reference: **retake it with more repetitions**, do not append a second one
      (a second capture is a separate run against a fresh altimeter reference, so
      the two do not concatenate). 605 is 5× the widest candidate window, and it
      supersedes the 150-sample floor this protocol carried while the cadence was
      unknown.
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

Six exported files in `field-data/`, six summaries in `docs/field-captures/`, the
log table below filled in, and the hand-measured numbers from captures 1 and 2
recorded.

Three of the things the analysis was meant to derive are already in hand from the
2026-08-06 validation runs — **the delivery-cadence distribution, the rebase check
and per-run drift magnitudes** — so what these six add is the part that needs
ground truth: **jitter against a certain zero, the magnitude reference, and the
scoring of the configuration grid** (spec §8.5). Only then does the render slice
get a number.

Take captures 1 and 2 first — either order — and expect roughly an hour and a
quarter indoors across the two. They are the ones the whole exercise rests on.

## Log

Already taken, and not part of the six — two ordinary training runs that happened
to carry barometer data, which is what closed ADR 0015 item 7 and measured the
cadence. Recorded here so the six below are not confused with them:

| Capture | Date | Mode | Samples | Cadence | Backgrounded | Rebases | Closure |
|---|---|---|---|---|---|---|---|
| validation | 2026-08-05 | plan `w4d1` | 1774 | 1.065 s | 0% | 0 | −0.72 m |
| validation | 2026-08-06 | plan `w2d1` | 1620 | 1.064 s | 97.8% | 0 | −2.04 m |

The six:

| # | Capture | Date | Weather / temp | Phone | Export filename | Flights Climbed | Notes |
|---|---|---|---|---|---|---|---|
| ~~1~~ | ~~Stationary~~ **DONE** | 2026-08-07 | rising 0.68 hPa/h | on desk | `runbro-20260807-0513-940b8bb0.txt` | — | 54.2 min · 3052 samples · 1.065 s · σ=3.2 mm · **drift −5.05 m** · median filter ≈ useless |
| 2 | Stairwell ≥11 min | | — | in hand | | | riser: __ mm · steps/flight: __ · flights/rep: __ · reps: __ · samples: __ (≥605) |
| 3 | Flat loop, pocket | | | pocket: | | | |
| 4 | Flat loop, repeat | | | pocket: | | | |
| 5 | Hilly loop + pause | | | pocket: | | | pause: __ min |
| 6 | Flat loop, in hand | | | hand | | | |
