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
reports zero elevation forever (spec §2.1). Take these two first.

### Capture 1 — Stationary · **indoors** · 15 min · no walking

Ground truth: exactly 0 m gain, 0 m loss. Also the only clean read of
sensor jitter, and a long pure-noise record that can be resampled to the 50 seeds
this repo's measurement discipline requires.

- [ ] Phone **flat on a table**, screen up, and **do not touch it** for the full
      15 minutes. No picking it up to check.
- [ ] Pick a room with a **stable envelope**: interior room, no open window, away
      from an HVAC vent or a fan, and **no one opening exterior doors**. Building
      pressure differentials are worth up to ~2 m of apparent altitude, which is
      the size of the parameter being measured.
- [ ] Do not move between rooms or floors before or after — start and end the
      capture in the same place the phone is sitting.
- [ ] 15 minutes is the minimum, not a target. Longer is strictly better.
- [ ] Record: start time, room, and roughly the indoor temperature.

Why 15 and not 5: at a 10 s delivery cadence a 31-sample median window needs
310 s just to *fill*. A 5-minute capture could return nothing but nulls and read
as a bug rather than a result.

### Capture 2 — Stairwell · **indoors** · ~10 min · the magnitude reference

Ground truth: `steps × riser height`, exact to the centimetre. This is the only
capture that tells us whether a configuration can still *see* real terrain.

- [ ] **Measure one riser with the tape**, in millimetres — the vertical face of a
      single step. Write it down. Do not estimate it, and do not use "about
      3 metres a floor".
- [ ] Count the steps in one flight, and the flights per repetition.
- [ ] Walk **5 repetitions**: all the way up, all the way down, at a steady pace.
      Do not skip steps and do not take the lift for the descent.
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

## What "done" looks like

Six exported files in `field-data/`, the log table below filled in, and the
hand-measured numbers from captures 1 and 2 recorded. The analysis then derives
the delivery-cadence distribution, jitter, per-run drift, and the rebase check —
and scores the configuration grid against captures 1 and 2 as ground truth
(spec §8.5). Only then does the render slice get a number.

Take captures 1 and 2 first; they can be done in an hour, indoors, and they are
the ones the whole exercise rests on.

## Log

| # | Capture | Date | Weather / temp | Phone | Export filename | Flights Climbed | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Stationary 15 min | | indoor temp: | on table | | — | room: |
| 2 | Stairwell 5× | | — | in hand | | | riser: __ mm · steps/flight: __ · flights/rep: __ |
| 3 | Flat loop, pocket | | | pocket: | | | |
| 4 | Flat loop, repeat | | | pocket: | | | |
| 5 | Hilly loop + pause | | | pocket: | | | pause: __ min |
| 6 | Flat loop, in hand | | | hand | | | |
