# Barometer field capture — the first hardware measurements

Date: 2026-08-06
Status: **measured.** Discharges [ADR 0015](../../adr/0015-run-elevation-on-device-barometer.md)
item 7 and the cadence gate in
[the field-logging spec](../specs/2026-08-03-run-barometer-field-logging-design.md) §8.6.
The tuning itself stays open — captures 1 and 2 are still outstanding.

Two run exports were taken on a physical iPhone (iOS 26.5.2) on 2026-08-05 and
2026-08-06 and analysed with `scripts/analyze-field-capture.ts`. They are the first
real barometer readings this app has ever recorded: every prior verification ran on
the simulator, which has no barometer, and ADR 0015's 2026-08-04 amendment says so
explicitly. Derived metrics are committed per capture in
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

**Consequence: spec §8.6's escape hatch does not need to fire.** It reserved the right
to change the window *primitive* — a time-based window, or resample-then-median — if
the cadence came back slow or irregular. It came back fast and near-perfectly regular,
so the existing sample-counting primitive in `src/domain/elevation.ts` stands, and the
render slice's deliverable can be an ordinary `(medianWindow, hysteresisM)` pair.

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

## 7. What these captures still cannot decide

The tuning. Spec §8.5 scores a configuration as
`|gain − truthGain| + |loss − truthLoss| + λ · phantomGain`, and every input is
missing:

1. **No certain zero.** No stationary window of even 60 s exists in either run, so
   there is no jitter-against-truth and no `phantomGain` term. Nothing here punishes
   over-smoothing — which is exactly the rank inversion that made spec revision 1
   select a configuration reporting zero elevation forever.
2. **No exactly-known nonzero.** Without capture 2's tape-measured stairwell there is
   no `truthGain`/`truthLoss`.
3. **No doorstep brackets**, so drift cannot be subtracted as a covariate per run —
   only estimated end-to-end, as in §6.
4. **No flat route.** Both runs carry ~28 m of real relief, so neither can stand in
   for capture 3.
5. **No 5-minute pause.** Run 2's only pause is 2.4 s at the finish. The rebase-at-pause
   test is unexercised — though run 2's four background transitions are a stronger
   version of the same question, and it passed.

**Captures 1 and 2 remain the blocking work, in that order.** What has changed is that
the harness they depend on is now proven on real hardware, so taking them is no longer
a risk of discovering the instrument was broken all along.

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
| 1 — stationary | | | | | | | | | certain zero, jitter, n=50 resample |
| 2 — stairwell | | | | | | | | | the magnitude reference |
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
