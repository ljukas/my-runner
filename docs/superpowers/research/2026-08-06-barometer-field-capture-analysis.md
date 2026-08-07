# Barometer field capture — the first hardware measurements

Date: 2026-08-06 (extended 2026-08-07 with captures 1 and 2)
Status: **measured.** Discharges [ADR 0015](../../adr/0015-run-elevation-on-device-barometer.md)
item 7 and the cadence gate in
[the field-logging spec](../specs/2026-08-03-run-barometer-field-logging-design.md) §8.6.

**Read §6a and §6b before acting on §3.** Captures 1 and 2 are now in, and they
overturn this document's own first conclusion: §3 argued the reducer's parameter
pair survives, and §6b shows it does not. The render slice's deliverable is a
changed primitive, not a tuned pair.

Four captures on a physical iPhone (iOS 26.5.2), analysed with
`scripts/analyze-field-capture.ts`: two ordinary plan sessions on 2026-08-05/06 —
the first real barometer readings this app ever recorded, every prior verification
having run on a barometer-less simulator — then protocol captures 1 and 2 on
2026-08-07. Derived metrics are committed per capture in
[`docs/field-captures/`](../../field-captures/); the exports themselves stay in
gitignored `field-data/` because each contains the runner's home address.

## 1. What these two captures are, and what they are not

| | `d8190994` | `19615682` |
|---|---|---|
| Session key | `w4d1` | `w2d1` |
| Started | 2026-08-05 18:32 | 2026-08-06 06:28 |
| Wall clock | 1890 s (31.5 min) | 1725 s (28.8 min) |
| Distance | 4053 m | 3225 m |
| Altitude samples | 1774 | 1620 |
| Dropped | 0 | 0 |
| App state | never backgrounded | **backgrounded 97.8%** |

**Both are ordinary plan sessions, not `field-test` captures.** That is fine — they
were real training runs, so marking the day complete and writing the workout to Apple
Health was correct behaviour, not the pollution [the spec](../specs/2026-08-03-run-barometer-field-logging-design.md)
§8.0 warns about. But it has one consequence that governs everything below: **neither
carries the ground truth the tuning needs.** No stationary bracket, no tape-measured
vertical, no deliberately flat route.

So they settle how the *instrument* behaves. They cannot choose `medianWindow` or
`hysteresisM`, and nothing here should be read as if they could.

The pair happens to be well matched for instrument work: run 1 never left the
foreground, run 2 spent almost all of itself backgrounded. Any delivery difference
between the two regimes would show as a difference between these two files.

## 2. Measured constants

The numbers a later session should cite rather than re-derive.

| Quantity | Run 1 | Run 2 | Notes |
|---|---|---|---|
| **Delivery cadence (median)** | **1.065 s** | **1.064 s** | p05–p95 spread of 2 ms |
| Implied rate | 0.939 Hz | 0.940 Hz | |
| Coverage of wall clock | 99.9% | 99.9% | |
| Receipt gaps > 2 s | **0** | **0** | also 0 at 5/10/30/60 s |
| Sensor noise σ (per sample) | 0.0094 m | 0.0190 m | 2nd-difference estimate |
| Pressure quantum | 0.00008 hPa | 0.00008 hPa | ≈ 0.7 mm equivalent |
| `epoch` values | `[1]` | `[2]` | constant within each run |
| Rebases detected | **0** | **0** | no `relativeAltitudeM` step > 1 m |
| Pressure ↔ relAlt max deviation | 0.165 m | 0.183 m | |
| Barometric relief spanned | 27.88 m | 28.13 m | |
| Barometric closure error | −0.72 m | −2.04 m | mean of 60 samples each end |
| GPS start→end displacement | 2.6 m | 9.2 m | |
| GPS `altitudeAccuracy` median | 3.00 m | 3.00 m | p95 4.71 / 5.30 m; none invalid |
| Wall-vs-sensor clock drift | +1180 ms | +1192 ms | over the run, ≈ 630 ppm |
| `tick` heartbeat median | 5.02 s | 5.02 s | max 5.04 / 5.03 s |

## 3. The cadence — the gate everything else was waiting on

Spec §8.6 makes the cadence histogram "an explicit gating deliverable," and §1 builds
its central worry on `CMAltimeter.h`'s documented *"every few seconds"*: at one sample
per 4 s a 31-sample median window would span 124 s — 229 m of ground at running pace —
and would smear real terrain rather than reject noise.

**Measured, the cadence is 1.065 s, and it is astonishingly regular** — a 2 ms spread
between the 5th and 95th percentiles across 30 minutes, identical in both runs and in
both app states. At that rate:

- a 31-sample window spans **33 s**, not 124 s;
- a 121-sample window spans **129 s**, so even the widest grid entry is tractable;
- the GPS-era tuning's *window duration* assumption was approximately right, having
  been measured against 1 Hz fixes.

**Consequence: spec §8.6's escape hatch does not fire *for this reason*.** It reserved
the right to change the window *primitive* — a time-based window, or
resample-then-median — if the cadence came back slow or irregular. It came back fast
and near-perfectly regular, so nothing about the **cadence** invalidates a
sample-counting window.

> **Superseded in part by §6a and §6b.** This section originally concluded that the
> render slice's deliverable could therefore be an ordinary
> `(medianWindow, hysteresisM)` pair. Captures 1 and 2 show it cannot: §8.6's escape
> hatch fires after all, for a reason this section could not see — median filtering
> targets a kind of noise the barometer does not have, and any window wide enough to
> matter erases real terrain. The sample-counting *mechanism* is sound; the median
> filter is the wrong instrument.

This also removes the reason the spec had for deriving capture 2's length from capture
1 (§8.3.5). The cadence is known now, so **capture 2 can be sized immediately**: 5 ×
the widest candidate window is 5 × 121 = 605 samples, and at 1.065 s that is **645 s ≈
11 minutes** of continuous stairwell repetitions. The protocol's ≥150-sample floor
(160 s) is not the binding constraint; 11 minutes is.

## 4. Background delivery — ADR 0015 item 7, closed

Item 7 has been open since 2026-07-13. It asks whether the barometer keeps delivering
during a locked-phone run under [ADR 0008](../../adr/0008-background-execution-location-heartbeat.md)'s
location heartbeat, and made shipping the on-device path conditional on a device
verification passing.

Run 2 spent 1688 s of its 1725 s backgrounded, across four separate windows:

| Window | Duration | Samples | Expected | Max gap |
|---|---|---|---|---|
| t+8 → 262 s | 253 s | 238 | 238 | 1.14 s |
| t+264 → 708 s | 444 s | 417 | 417 | 1.08 s |
| t+710 → 1243 s | 534 s | 501 | 501 | 1.09 s |
| t+1266 → 1723 s | 457 s | 429 | 429 | 1.07 s |

**1585 samples against 1586 expected — 99.9% of nominal cadence, with no gap ever
exceeding 1.14 s.** Not degraded delivery: delivery indistinguishable from the
foreground run. Run 1, which never backgrounded, has the same 1.065 s cadence and the
same zero gaps, so the two regimes are measurably identical.

Item 7's fallback — "if it cannot run backgrounded, gain is reconstructed from
foreground samples plus the GPS fallback" — is not needed on this hardware.

Two supporting facts from the same file: the `tick` heartbeat held a 5.02 s median
with a 5.03 s maximum throughout, and `fix_batch` receipt lag stayed at a 0.09 s
median, so the JS thread was being scheduled promptly the whole time rather than
catching up in bursts. The ADR 0008 heartbeat carried both sensors.

## 5. No rebase, including across background transitions

The design's largest implicit bet (spec §15) was that `BarometerModule.swift` has no
`OnAppEntersBackground` hook — unlike `PedometerModule.swift` — so pocketing the phone
does not restart `CMAltimeter` and rebase `relativeAltitude` to a fresh zero. It was
read from source, never observed.

**Observed: zero `relativeAltitudeM` discontinuities greater than 1 m in either run**,
including across all four of run 2's background transitions and its
`inactive`/`active` blips. The corroborating check is stronger than a jump count:
`relativeAltitudeM` tracks `−ΔP / 0.12 hPa·m⁻¹` to within 0.18 m across the entire
28 m span of both runs, and a rebase cannot preserve that relationship.

Two secondary conclusions:

- **The pressure-continuity detector works, and `relativeAltitudeM` carries no
  independent information.** It is a deterministic transform of `pressureHpa`. Logging
  both is still right — that redundancy *is* the detector — but a future consumer
  should treat pressure as the primary series.
- **Both `epoch` checks in the protocol are discharged.** `epoch` is constant within
  each run (`[1]`, then `[2]`), and the two files carry an *identical* `processToken`
  (`msgfbvp3-…`), whose `Date.now()` prefix decodes to 2026-08-05T18:32:02Z — seven
  seconds before run 1 started. So one app process spanned both runs twelve hours
  apart, and `epoch` incremented by exactly one across them. That is precisely the
  protocol's "two captures in the same app launch" check, satisfied incidentally.

## 6. Sensor noise, drift, and repeatability

**Noise: σ ≈ 0.9–1.9 cm per sample**, estimated from second differences (real terrain
is smooth at 1 Hz, so the white component is what is left). Against GPS vertical error
of ±10–25 m this is three orders of magnitude better, and it vindicates ADR 0015's
premise that the barometer is precise for *changes* even while imprecise absolutely.
Treat it as a lower bound on effective noise: vertical body motion at running cadence
aliases into a 1 Hz series and is not separable here.

**Closure: −0.72 m and −2.04 m** on loops that closed geodetically to 2.6 m and 9.2 m.
Both sit inside the 1–3 m calm-day band the spec's §2.1 table predicted, so those
magnitudes were right and the doorstep-bracket requirement is justified rather than
over-cautious. These closure figures are *not* a tuning score — §2.1 proves
`|gain − loss|` measures `hysteresisM` plus drift and carries no accuracy information.

**Repeatability: sd 0.55 m.** The two runs start from the same doorstep and share
about half their ground, giving 73 shared 25 m cells spanning 26.2 m of real relief.
Comparing barometric altitude cell-by-cell across the two days, after removing each
run's own linear drift, gives a mean difference of −0.19 m and **sd 0.55 m** (raw,
undrifted: mean +0.41, sd 0.62). Two different days, different weather, twelve hours
apart, and the barometer reproduces the same terrain to about half a metre.

This is a partial, unplanned version of capture 4, and it is weaker than the real
thing in one specific way: both measurements come from the same sensor by the same
method, so a shared systematic bias would cancel and go unseen. It bounds the *random*
component, not accuracy. The comparison is reproducible via
`scripts/analyze-field-capture.ts … --compare`.

## 6a. Capture 1 (2026-08-07) — and the finding that reframes the tuning

Capture 1 was taken correctly: `sessionKey: field-test`, 54.2 minutes with the
phone flat on a desk, **3052 altitude samples against 3052 expected, zero drops,
zero gaps, 100.0% coverage**, `epoch` constant, no rebase, and 98.9% of it
backgrounded. It confirms the 1.065 s cadence a third time.

Two results from it matter more than the confirmation.

### The white noise is 3.2 mm, and the median filter is nearly useless

Stationary on a desk, with no body motion to alias, the per-sample white noise is
**σ = 0.0032 m**. That is the sensor's true noise floor — the runs' 0.9–1.9 cm
was inflated by running motion.

But the capture does not sit still at 3 mm. After removing a linear trend the
residual has **sd 0.202 m and a peak-to-peak of 1.50 m** — **63× the white
component**. The error is *low-frequency wander*, and a median filter is a
spike-rejector, so it barely touches it:

| median window | span | residual sd | vs unfiltered |
|---|---|---|---|
| w1 (none) | 1.1 s | 0.2019 m | — |
| w5 | 5.3 s | 0.2014 m | −0.2% |
| w15 | 16.0 s | 0.1934 m | −4.2% |
| w31 | 33.0 s | 0.1796 m | −11.0% |
| w61 | 65.0 s | 0.1696 m | −16.0% |
| w121 | 128.9 s | 0.1618 m | −19.8% |

**A 129-second median window buys a 20% noise reduction.** The reducer's
`medianWindow` was sized against GPS, whose error *is* largely per-sample; on the
barometer it is close to a free parameter. That inverts the tuning problem: the
burden falls almost entirely on `hysteresisM`, and `medianWindow` should be
chosen for lag, not for noise.

This is spec §8.6's "the deliverable may not be a `(medianWindow, hysteresisM)`
pair" arriving — but for the opposite reason to the one it anticipated. §8.6
expected a slow or irregular cadence to break the sample-counting window. The
cadence is fine. What is wrong is that **median filtering addresses a kind of
noise this sensor does not have.**

### The drift is real weather, and hysteresis only postpones it

Over the 54 minutes the barometer fell **5.05 m**, monotonically — **9 of 9
five-minute bins fell** — as pressure rose 1001.06 → 1001.60 hPa, a rate of
**0.68 hPa/hour**. Monotone at that scale is synoptic weather, not sensor wander;
the phone genuinely did not move, so all 5 m is atmospheric.

The consequence is visible in the phantom-gain grid, and it is not what the
scoring function assumes:

| config | phantom gain | phantom loss |
|---|---|---|
| w1 h0 | 18.94 | 24.07 |
| w5 h1 | 0.00 | **5.05** |
| w15 h3 / w31 h3 / w61 h3 | 0.00 | **3.00–3.07** |
| w31 h10, w61 h30, w121 h60 | 0.00 | 0.00 |

Every non-zero figure below `h10` is drift being banked as descent. And the
mechanism generalises badly: because `elevationStep` re-anchors on every banked
move, **hysteresis does not reject drift, it only delays it.** Once accumulated
drift exceeds `hysteresisM` it banks and re-anchors, so a long enough run banks
arbitrary drift at any threshold. `h10` reads 0.00 here only because the total
drift (5.05 m) never reached 10 m.

Extrapolating at this rate, a 30-minute run drifts ~2.8 m — so on a genuinely
flat run, `h3` would fabricate roughly 0–3 m, which is the whole of the error
capture 3 is meant to measure.

**What this argues for the render slice:** drift is slow and monotone, which
makes it *separable* in a way white noise never is. The honest fix is to estimate
and subtract it — which is exactly what the protocol's doorstep brackets exist to
enable — rather than asking a threshold to absorb it. That is a stronger reason
for the brackets than the protocol currently gives.

**One caveat on generality.** 0.68 hPa/hour is a brisk pressure rise, so this is
an *active-day* drift figure, not a calm-day one. It brackets the bad end. A
second stationary capture on a settled day would bound the other, and until one
exists the scoring should treat 5 m/hour as a worst case rather than the norm.

### Two incidental findings

- **A stationary phone recorded 858 m of distance.** Indoors, over 54 minutes,
  GPS wandered enough to accumulate 858 m of path while never leaving a 16.8 m
  radius, with `altitudeAccuracy` median 18.88 m against 3.00 m outdoors. It does
  not affect elevation, and no plan session is taken indoors at a desk, so
  nothing here is broken — but it is worth knowing that accumulated distance is
  not a reliable stationarity test, which is why the analyzer uses displacement.
- **Auto-detecting a zero-truth capture from GPS is unreliable**, for the same
  reason. `--zero-truth` exists so the operator can declare what only they know.

## 6b. Capture 2 (2026-08-07) — the median window destroys real terrain

Taken in `field-test` mode: 5.6 minutes, 318 samples, zero drops, zero gaps, no
rebase. A single flight of **12 steps**, walked up and down repeatedly.

**The repetition count was not written down, so it was recovered from the trace**
— and unambiguously: 32 clean one-way legs, i.e. **16 complete up-down
repetitions**, each leg ~9.9 s, amplitude sd only 7%. The peak/trough structure
is so regular that the count is not in doubt.

### The result: every window ≥ 15 samples reports 0.00 m

Scored against the recovered 16 repetitions:

| config | gain | loss | vs 42.62 m truth (222 mm riser) |
|---|---|---|---|
| w1 h0 | 35.41 | 35.41 | 83% |
| w5 h0.5 | 25.35 | 24.68 | 59% |
| w5 h1 | 18.67 | 18.03 | 44% |
| w15 h1 | **0.00** | **0.00** | **0%** |
| w31 h3 | **0.00** | **0.00** | **0%** |
| **w31 h10 (shipped GPS pair)** | **0.00** | **0.00** | **0%** |
| w61 h1 | **0.00** | **0.00** | **0%** |

**A stair leg takes ~9.3 samples. A 15-sample median window spans 16 s — longer
than a whole leg — so the median of any window centred on a peak already contains
both adjoining troughs, and the oscillation is erased before hysteresis ever sees
it.** The shipped `w31 h10` reports zero elevation for sixteen ascents of a real
staircase.

This is the over-smoothing punishment §8.5 needs, and it is far sharper than
expected. Combined with §6a it settles the shape of the answer:

- **§6a:** widening the median window buys ~20% noise reduction.
- **§6b:** widening it past ~10 samples destroys real terrain outright.

There is no version of "widen the window" that helps. The viable region is
`medianWindow ≤ 5` and `hysteresisM ≤ 1`.

### The tension the two captures create, and why the primitive must change

§6a and §6b pull in opposite directions and the median window cannot mediate:

| requirement | from | forces |
|---|---|---|
| See a 2.1 m flight | capture 2 | `hysteresisM ≤ 1` |
| Reject 5 m of weather drift | capture 1 | `hysteresisM ≥ 5` |

These are incompatible, and no `medianWindow` reconciles them — §6b shows
widening it erases the terrain that `hysteresisM ≤ 1` exists to catch.

**So the deliverable is not a `(medianWindow, hysteresisM)` pair.** Spec §8.6
reserved exactly this outcome, and it is now forced by measurement rather than
suspected. The way out follows from §6a's other finding: drift is *slow and
monotone*, so it is separable — estimate and subtract it, then run a small
hysteresis that can still see terrain. Hysteresis was being asked to do a job
(reject a monotone trend) that it structurally cannot do, since it re-anchors on
every banked move and therefore only postpones drift.

### The sensor under-reads a fast climb by 21% — and it is dynamic, not physics

The measured amplitude per flight is **2.103 m** (raw, sd 0.152 m across 33
legs). The tape says 12 risers × 222 mm = **2.664 m**. The barometer reads
**79%**.

**The ground truth is sound.** The stairwell is a *spiral* staircase, where a
222 mm riser is ordinary rather than the steep outlier it would be on a straight
residential flight — and 12 × 222 mm = 2.664 m is a textbook storey height, which
corroborates the tape independently. (An earlier draft of this section guessed the
tape was wrong because 2.103 m over 12 risers implies 175 mm, the straight-stair
norm. That inference was reasonable and wrong: it assumed a stair geometry nobody
had established.)

**Air density cannot explain it either.** iOS's own conversion comes out at
**0.1191 hPa/m** across these legs — the standard atmosphere, implying 14.4 °C.
For the true 2.664 m to have produced the pressure swing actually recorded
(0.2505 hPa per leg), the stairwell air would have to be at **91 °C**. The
conversion is right; the *pressure readings themselves* do not keep up with the
climb.

So the shortfall is the sensor's dynamic response, and it decomposes:

| component | size |
|---|---|
| Sampling — the apex falls between 1.065 s samples | ~0.143 m |
| **Sensor/OS lag** | **~0.417 m** |
| total shortfall | 0.561 m |

Fitting a first-order lag to the residual gives **τ ≈ 2 s**, consistent with the
duration/amplitude correlation already noted (r = 0.63) and plausible for
`CMAltimeter`'s internal filtering.

**If τ ≈ 2 s holds, the error is specific to fast excursions and nearly absent
from running terrain:**

| climb duration | predicted attenuation |
|---|---|
| 10 s (this stairwell) | ~15% |
| 30 s | ~2% |
| 60 s | ~0.5% |

That would make **this stairwell a harsher magnitude test than any real run** —
near the sensor's response limit rather than representative of it. It matters
because §8.5 uses capture 2 as `truthGain`: scoring a configuration against a
21%-attenuated reference would bias the whole sweep toward under-smoothing.

**This is a one-point fit, not an established constant.** It is settled by a
**settling capture**, which is cheap and does not require walking the stairs
properly again — lag vanishes at steady state by definition:

> Bottom, still, 90 s → up → **top, still, 90 s** → down → bottom, still, 90 s →
> then 3 quick up-down reps → still, 30 s. About six minutes.

The bottom-top-bottom shape is what makes it work: drift runs at 5–11 m/hour, so
a five-minute capture drifts 0.4–0.9 m — the same size as the effect being
measured — and two bottom brackets let it be interpolated out. The three quick
reps at the end put the *moving* and *settled* amplitudes in one capture under
identical drift, so the comparison depends on nothing external. The exponential
approach after stopping at the top yields τ directly.

None of this disturbs §6b's ordering: a 15-sample window reports 0.00 m at any
absolute scale. It bears on `truthGain`'s calibration, not on which
configurations are viable.

### Was 318 samples enough? Yes — the ≥605 rule was superseded by its own evidence

The protocol demanded ≥605 samples, derived as 5× the widest candidate window
(121). **That grid is now known to be invalid:** §6a showed wide windows buy
almost nothing and §6b shows they report zero on real stairs. The widest *viable*
window is ~5 samples, needing ~25; this capture has 318, a 12× margin over the
region that matters.

The missing 60-second brackets cost less than feared, too: drift was recovered
from the trough envelope at −11.2 m/hour, and over 5.6 minutes that is ~0.86 m
against a ~35 m signal, i.e. 2–3%.

**The capture is a keeper.** Its one real gap is the riser question above, and
that is answerable with a tape rather than a retake.

## 7. What these captures still cannot decide

The tuning. Spec §8.5 scores a configuration as
`|gain − truthGain| + |loss − truthLoss| + λ · phantomGain`. Capture 1 supplies
the `phantomGain` term; the rest is still missing:

1. ~~**No certain zero.**~~ **Supplied by capture 1** (§6a) — though with the large
   caveat that its 5 m of monotone weather drift means the term measures *drift
   rejection* at least as much as noise rejection, and on an active day.
2. ~~**No exactly-known nonzero.**~~ **Supplied by capture 2** (§6b), with one
   qualification: the repetition count was recovered from the trace (16, unambiguous)
   but the per-flight height is 2.103 m by barometer against 2.664 m by tape, and the
   two have not been reconciled. So the *ordering* of configurations is settled —
   every window ≥15 samples reports 0.00 m — while `truthGain` itself is known only
   to about ±20%.
3. **No doorstep brackets**, so drift cannot be subtracted as a covariate per run —
   only estimated end-to-end, as in §6. §6a and §6b together make this the
   **central** problem rather than a refinement: drift is the dominant error, and
   §6b proves neither a wider window nor a larger threshold can absorb it without
   erasing terrain.
4. **No flat route.** Both runs carry ~28 m of real relief, so neither can stand in
   for capture 3.
5. **No 5-minute pause.** Run 2's only pause is 2.4 s at the finish. The rebase-at-pause
   test is unexercised — though run 2's four background transitions are a stronger
   version of the same question, and it passed.

**Nothing is blocking the analysis any more.** Captures 1 and 2 are both in, and
together they show the deliverable is not a `(medianWindow, hysteresisM)` pair (§6b).
What the render slice needs next is a *design* decision — drift estimation and
subtraction — not another capture. Captures 3–6 remain valuable as validation of
whatever that design produces, and two small measurements would tighten the
ground truth: a re-measured riser, and a stationary capture on a calm day.

For illustration only — **not a score** — the shipped reducer over run 2:

| config | window | gain | loss | \|g−l\| |
|---|---|---|---|---|
| w31 h3 | 33.0 s | 27.64 | 28.10 | 0.45 |
| w31 h10 (shipped GPS pair) | 33.0 s | 10.13 | 20.14 | 10.01 |
| w61 h30 | 64.9 s | 0.00 | 0.00 | 0.00 |
| w121 h60 | 128.7 s | 0.00 | 0.00 | 0.00 |

Two things worth noting even without truth. The `|gain − loss| ≈ hysteresisM` identity
spec §2.1 derived algebraically is visible on real data (10.01 against a hysteresis of
10). And the degenerate configurations report **0.00 gain and 0.00 loss on a run
containing 28 m of real relief** — the failure mode §2.1 exists to prevent, reproduced
on a real hill.

## 8. GPS vertical accuracy, incidentally

`altitudeAccuracy` — the column [the spec](../specs/2026-08-03-run-barometer-field-logging-design.md)
§5.2 added precisely so the noise regime of a run would be identifiable — is present
and valid on **every** point of both runs, with a median of 3.00 m and a p95 of
4.7–5.3 m.

ADR 0015's 2026-08-03 amendment could only simulate ±10 m and ±25 m regimes. Real
open-sky urban running is apparently better than its optimistic case. That does not
revive GPS altitude (its raw span reads 76 m against the barometer's 28 m, and it
reports 0.0 m at points), but it means the amendment's ±25 m column describes a worse
world than the one this phone runs in, and a future GPS-fallback tuning should be
measured, not assumed from it.

## 9. Capture ledger

Extend as captures arrive. Full metrics per row live in
[`docs/field-captures/`](../../field-captures/).

| Capture | File | Date | Mode | Samples | Cadence | Bg % | Rebases | Closure | Purpose served |
|---|---|---|---|---|---|---|---|---|---|
| — (validation) | `…-d8190994` | 2026-08-05 | plan `w4d1` | 1774 | 1.065 s | 0% | 0 | −0.72 m | cadence; foreground control |
| — (validation) | `…-19615682` | 2026-08-06 | plan `w2d1` | 1620 | 1.064 s | 97.8% | 0 | −2.04 m | **item 7**; no-rebase; repeatability |
| **1 — stationary** | `…-940b8bb0` | 2026-08-07 | **`field-test`** | 3052 | 1.065 s | 98.9% | 0 | **−5.05 m** | certain zero; σ=3.2 mm; **median filter ≈ useless (§6a)** |
| **2 — stairwell** | `…-f3b38786` | 2026-08-07 | **`field-test`** | 318 | 1.064 s | 57.0% | 0 | −0.57 m | 16 reps × 12 steps; **w≥15 reports 0.00 m**; sensor reads 79% of a 10 s climb (§6b) |
| 3 — flat loop | | | | | | | | | phantom gain under motion |
| 4 — flat repeat | | | | | | | | | repeatability |
| 5 — hilly + pause | | | | | | | | | rebase-at-pause, gap distribution |
| 6 — flat, in hand | | | | | | | | | isolates the pocket artifact |

## 10. Reproducing this

```sh
# per-capture report, and the committable summary
bun scripts/analyze-field-capture.ts field-data/<export>.txt --json docs/field-captures

# captures 3 vs 4 — the repeatability estimate
bun scripts/analyze-field-capture.ts field-data/<c3>.txt field-data/<c4>.txt --compare
```

The analyzer imports the real `elevationRollup` from `src/domain/elevation.ts` rather
than reimplementing it, so its reducer grid cannot drift from what ships. It is
deliberately **not** a `package.json` script: every entry but `android`/`ios` is a
native-fingerprint source (`fingerprint.config.js`), so adding one would invalidate the
cached `e2e-simulator` build and cost the next `e2e-refresh` a full rebuild for a
docs-only tool.
